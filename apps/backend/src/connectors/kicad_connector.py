"""
KiCad Connector — Parse .kicad_sch and .kicad_pcb files.

Pure Python S-expression tokenizer + recursive parser.
No external dependencies.
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional

from packages.shared_types.src.models import EntityType


# ──────────────────────────────────────────────
# S-Expression Tokenizer & Parser
# ──────────────────────────────────────────────

_TOKEN_RE = re.compile(r"""
    \s+              |   # whitespace (skip)
    (\()             |   # open paren
    (\))             |   # close paren
    ("(?:[^"\\]|\\.)*") |  # quoted string
    ([^\s()]+)           # atom
""", re.VERBOSE)


def _tokenize(text: str) -> list[str]:
    """Split S-expression text into tokens."""
    tokens: list[str] = []
    for m in _TOKEN_RE.finditer(text):
        if m.group(1):
            tokens.append("(")
        elif m.group(2):
            tokens.append(")")
        elif m.group(3):
            tokens.append(m.group(3))
        elif m.group(4):
            tokens.append(m.group(4))
    return tokens


def _parse(tokens: list[str], pos: int = 0) -> tuple[Any, int]:
    """Recursively parse tokens into nested lists."""
    if tokens[pos] == "(":
        lst: list[Any] = []
        pos += 1
        while pos < len(tokens) and tokens[pos] != ")":
            val, pos = _parse(tokens, pos)
            lst.append(val)
        pos += 1  # skip closing ')'
        return lst, pos
    else:
        # Strip surrounding quotes from strings
        tok = tokens[pos]
        if tok.startswith('"') and tok.endswith('"'):
            tok = tok[1:-1]
        return tok, pos + 1


def _parse_sexpr(text: str) -> Any:
    """Parse an S-expression string into nested Python lists."""
    tokens = _tokenize(text)
    if not tokens:
        return []
    result, _ = _parse(tokens, 0)
    return result


# ──────────────────────────────────────────────
# Tree Helpers
# ──────────────────────────────────────────────

def _find_nodes(tree: list, tag: str, *, stop_recurse_on_match: bool = False) -> list[list]:
    """
    Find all sub-lists whose first element equals *tag*.

    When stop_recurse_on_match is True, do NOT recurse into a matched node's
    children.  This avoids KiCad multi-unit symbol duplicates where a top-level
    ``symbol`` contains nested ``symbol`` sub-units.
    """
    results: list[list] = []
    if not isinstance(tree, list):
        return results
    if tree and tree[0] == tag:
        results.append(tree)
        if stop_recurse_on_match:
            return results
    for child in tree:
        if isinstance(child, list):
            results.extend(_find_nodes(child, tag, stop_recurse_on_match=stop_recurse_on_match))
    return results


def _get_property(node: list, prop_name: str) -> Optional[str]:
    """Extract the value of a named ``property`` from a node."""
    for child in node:
        if isinstance(child, list) and len(child) >= 3 and child[0] == "property" and child[1] == prop_name:
            return child[2]
    return None


# ──────────────────────────────────────────────
# Component Classification
# ──────────────────────────────────────────────

_PREFIX_MAP: dict[str, EntityType] = {
    "U": EntityType.ELECTRICAL_PART,
    "IC": EntityType.ELECTRICAL_PART,
    "R": EntityType.ELECTRICAL_PART,
    "C": EntityType.ELECTRICAL_PART,
    "L": EntityType.ELECTRICAL_PART,
    "D": EntityType.ELECTRICAL_PART,
    "Q": EntityType.ELECTRICAL_PART,
    "J": EntityType.INTERFACE,
    "SW": EntityType.INTERFACE,
    "M": EntityType.MECHANICAL_PART,
    "H": EntityType.MECHANICAL_PART,
}

_PREFIX_RE = re.compile(r"^([A-Z]+)")


def _classify_component(reference: str) -> EntityType:
    """Classify a component by its reference designator prefix."""
    m = _PREFIX_RE.match(reference)
    if m:
        prefix = m.group(1)
        # Try full prefix first (e.g. "IC", "SW"), then first char
        if prefix in _PREFIX_MAP:
            return _PREFIX_MAP[prefix]
        if prefix[0] in _PREFIX_MAP:
            return _PREFIX_MAP[prefix[0]]
    return EntityType.ELECTRICAL_PART


# ──────────────────────────────────────────────
# KiCadConnector
# ──────────────────────────────────────────────

class KiCadConnector:
    """Parse KiCad schematic and PCB files into structured data."""

    @staticmethod
    def parse_schematic(path: str) -> dict[str, Any]:
        """
        Parse a .kicad_sch file.

        Returns::

            {"components": [{"name", "value", "footprint", "lib_id", "entity_type"}, ...]}
        """
        with open(path, "r") as f:
            text = f.read()

        tree = _parse_sexpr(text)
        components: list[dict[str, Any]] = []

        # Top-level ``symbol`` nodes that have a ``lib_id`` are placed components.
        # Use stop_recurse_on_match to avoid descending into nested sub-symbols.
        for sym in _find_nodes(tree, "symbol", stop_recurse_on_match=True):
            # Only placed components have a ``lib_id`` child node
            lib_id_nodes = [c for c in sym if isinstance(c, list) and c[0] == "lib_id"]
            if not lib_id_nodes:
                continue

            lib_id = lib_id_nodes[0][1] if len(lib_id_nodes[0]) > 1 else ""
            ref = _get_property(sym, "Reference") or ""
            value = _get_property(sym, "Value") or ""
            footprint = _get_property(sym, "Footprint") or ""

            if not ref:
                continue

            components.append({
                "name": ref,
                "value": value,
                "footprint": footprint,
                "lib_id": lib_id,
                "entity_type": _classify_component(ref),
            })

        return {"components": components}

    @staticmethod
    def parse_pcb(path: str) -> dict[str, Any]:
        """
        Parse a .kicad_pcb file.

        Returns::

            {
                "components": [{"name", "value", "footprint_lib", "connected_nets", "entity_type"}, ...],
                "nets": [{"id", "name"}, ...]
            }
        """
        with open(path, "r") as f:
            text = f.read()

        tree = _parse_sexpr(text)

        # --- Nets ---
        nets: list[dict[str, Any]] = []
        for net_node in _find_nodes(tree, "net"):
            # Top-level nets: (net <id> <name>)
            if len(net_node) >= 3 and not isinstance(net_node[1], list):
                net_name = net_node[2]
                if net_name:  # skip unnamed net 0
                    nets.append({"id": net_node[1], "name": net_name})

        # --- Footprints (components) ---
        components: list[dict[str, Any]] = []
        for fp in _find_nodes(tree, "footprint"):
            ref = _get_property(fp, "Reference") or ""
            value = _get_property(fp, "Value") or ""
            footprint_lib = fp[1] if len(fp) > 1 and isinstance(fp[1], str) else ""

            if not ref:
                continue

            # Collect nets from pads
            connected_nets: list[str] = []
            for pad in _find_nodes(fp, "pad"):
                for child in pad:
                    if isinstance(child, list) and child[0] == "net" and len(child) >= 3:
                        net_name = child[2]
                        if net_name and net_name not in connected_nets:
                            connected_nets.append(net_name)

            components.append({
                "name": ref,
                "value": value,
                "footprint_lib": footprint_lib,
                "connected_nets": connected_nets,
                "entity_type": _classify_component(ref),
            })

        return {"components": components, "nets": nets}

    @staticmethod
    def sync(
        schematic_path: Optional[str] = None,
        pcb_path: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Sync schematic and/or PCB into a flat snapshot dict keyed by name.

        Suitable for passing to ``create_snapshot()``.
        """
        snapshot: dict[str, Any] = {}

        if schematic_path and os.path.exists(schematic_path):
            sch = KiCadConnector.parse_schematic(schematic_path)
            for comp in sch["components"]:
                snapshot[comp["name"]] = {
                    "type": comp["entity_type"].value,
                    "value": comp["value"],
                    "footprint": comp["footprint"],
                    "lib_id": comp["lib_id"],
                    "source": "schematic",
                }

        if pcb_path and os.path.exists(pcb_path):
            pcb = KiCadConnector.parse_pcb(pcb_path)
            for comp in pcb["components"]:
                if comp["name"] in snapshot:
                    # Merge PCB data into existing schematic entry
                    snapshot[comp["name"]]["connected_nets"] = comp["connected_nets"]
                    snapshot[comp["name"]]["footprint_lib"] = comp["footprint_lib"]
                else:
                    snapshot[comp["name"]] = {
                        "type": comp["entity_type"].value,
                        "value": comp["value"],
                        "footprint_lib": comp["footprint_lib"],
                        "connected_nets": comp["connected_nets"],
                        "source": "pcb",
                    }
            for net in pcb["nets"]:
                snapshot[net["name"]] = {
                    "type": "net",
                    "net_id": net["id"],
                    "source": "pcb",
                }

        return snapshot
