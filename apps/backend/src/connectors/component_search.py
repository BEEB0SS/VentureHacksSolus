"""
Component Search — Scrape FindChips.com for electronic component search results.

No API key required. Returns normalized product dicts with multi-distributor
pricing and stock data for the agent layer.
"""

import logging
import re
from typing import Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class ComponentSearchError(Exception):
    """Raised when component search fails."""


def _parse_price(text: str) -> float:
    """Parse a price string like '$5.5900' into a float."""
    if not text:
        return 0.0
    cleaned = re.sub(r"[^\d.]", "", text.strip())
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return 0.0


def _parse_stock(text: str) -> int:
    """Parse stock text like '3453' or '8334In Stock' into an int."""
    if not text:
        return 0
    match = re.match(r"([\d,]+)", text.replace(",", ""))
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return 0
    return 0


def _extract_part_number(cell) -> str:
    """Extract the clean part number from a td-part cell.

    The cell text looks like 'DetailsTMC2209-LA-TDISTI #10AH1336'.
    The actual part number is between 'Details' and 'DISTI'.
    """
    text = cell.get_text(strip=True)
    # Try to extract between "Details" and "DISTI"
    match = re.search(r"Details(.+?)DISTI", text)
    if match:
        return match.group(1).strip()
    # Fallback: look for a link with the part number
    link = cell.find("a", class_=re.compile(r"part-link|detail", re.I))
    if link:
        return link.get_text(strip=True)
    # Last resort: strip known prefixes/suffixes
    text = re.sub(r"^Details", "", text)
    text = re.sub(r"DISTI\s*#.*$", "", text)
    return text.strip()


def _extract_price_breaks(cell) -> list[dict]:
    """Extract price break tiers from the td-price cell.

    Structure: <ul class="price-list"><li><span class="label">QTY</span>
    <span class="value" data-baseprice="PRICE">$PRICE</span></li>...
    """
    breaks = []
    for li in cell.find_all("li"):
        label = li.find("span", class_="label")
        value = li.find("span", class_="value")
        if label and value:
            qty_text = label.get_text(strip=True).replace(",", "")
            try:
                qty = int(qty_text)
            except ValueError:
                continue
            # Prefer data-baseprice attribute, fall back to text
            price_str = value.get("data-baseprice", "") or value.get_text(strip=True)
            price = _parse_price(price_str)
            if qty and price:
                breaks.append({"qty": qty, "unit_price": price})
    return breaks


def _extract_price_range(cell) -> tuple[str, float]:
    """Extract price range string and best unit price from td-price-range cell.

    Text format: '$2.8359 / $5.2000'
    """
    text = cell.get_text(strip=True)
    prices = re.findall(r"\$([\d.]+)", text)
    if prices:
        float_prices = [float(p) for p in prices]
        best_price = min(float_prices)
        return text, best_price
    return "", 0.0


def search_components(keywords: str, max_results: int = 10) -> list[dict]:
    """Search FindChips for components matching keywords. Returns normalized product dicts."""
    url = f"https://www.findchips.com/search/{requests.utils.quote(keywords)}"
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise ComponentSearchError("Search rate limited, try again in a minute")
        logger.error("Component search request failed: %s", exc)
        return []
    except Exception as exc:
        logger.error("Component search request failed: %s", exc)
        return []

    return _parse_findchips(resp.text, max_results)


def _parse_findchips(html: str, max_results: int) -> list[dict]:
    """Parse FindChips HTML into normalized product dicts, deduped across distributors."""
    soup = BeautifulSoup(html, "html.parser")
    sections = soup.find_all("div", class_="distributor-results")

    # Collect all offers grouped by manufacturer part number
    by_mpn: dict[str, dict] = {}

    for section in sections:
        # Extract distributor name
        title_el = section.find(class_="distributor-title")
        distributor = ""
        if title_el:
            # Text is like "DigiKeyECIA (NEDA) Member • Authorized Distributor"
            raw = title_el.get_text(strip=True)
            # Take text before "ECIA" or "•" or first non-alpha cluster
            match = re.match(r"^([\w\s&.]+?)(?:ECIA|•|Member|Authorized)", raw)
            distributor = match.group(1).strip() if match else raw.split("•")[0].strip()

        table = section.find("table")
        if not table:
            continue

        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all("td")
            if not cells:
                continue

            # Map cells by class
            cell_map: dict[str, object] = {}
            for cell in cells:
                classes = cell.get("class", [])
                for cls in classes:
                    cell_map[cls] = cell

            part_cell = cell_map.get("td-part")
            mfg_cell = cell_map.get("td-mfg")
            desc_cell = cell_map.get("td-desc")
            stock_cell = cell_map.get("td-stock")
            price_cell = cell_map.get("td-price")
            range_cell = cell_map.get("td-price-range")

            if not part_cell:
                continue

            mpn = _extract_part_number(part_cell)
            if not mpn or len(mpn) < 3:
                continue

            manufacturer = mfg_cell.get_text(strip=True) if mfg_cell else ""
            description = desc_cell.get_text(strip=True) if desc_cell else ""
            # Clean description: remove "Min Qty:..." suffixes
            description = re.sub(r"Min Qty:\d+.*$", "", description).strip()

            stock = _parse_stock(stock_cell.get_text(strip=True)) if stock_cell else 0
            price_breaks = _extract_price_breaks(price_cell) if price_cell else []
            price_range_str, best_price = _extract_price_range(range_cell) if range_cell else ("", 0.0)

            unit_price = price_breaks[0]["unit_price"] if price_breaks else best_price

            offer = {
                "distributor": distributor,
                "stock": stock,
                "unit_price": unit_price,
                "price_breaks": price_breaks,
                "price_range": price_range_str,
            }

            key = mpn.upper()
            if key in by_mpn:
                existing = by_mpn[key]
                existing["offers"].append(offer)
                existing["quantity_available"] += stock
                # Keep best (lowest) price
                if unit_price and (not existing["unit_price"] or unit_price < existing["unit_price"]):
                    existing["unit_price"] = unit_price
                    existing["price_range"] = price_range_str
                    existing["pricing"] = price_breaks
            else:
                by_mpn[key] = {
                    "manufacturer_part_number": mpn,
                    "manufacturer": manufacturer,
                    "description": description,
                    "detailed_description": description,
                    "unit_price": unit_price,
                    "datasheet_url": "",
                    "product_url": "",
                    "photo_url": "",
                    "quantity_available": stock,
                    "product_status": "",
                    "category": "",
                    "parameters": {},
                    "distributor_part_number": "",
                    "pricing": price_breaks,
                    "price_range": price_range_str,
                    "offers": [offer],
                }

    return list(by_mpn.values())[:max_results]
