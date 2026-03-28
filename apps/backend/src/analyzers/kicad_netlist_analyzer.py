"""
KiCad Netlist Analyzer — discover relations from shared PCB nets.

Discovers: connected_to (shared signal nets), drives (driver→motor).
Filters out power/ground nets to avoid combinatorial explosion.
"""

import re
from itertools import combinations

from apps.backend.src.connectors.kicad_connector import KiCadConnector
from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex
from packages.shared_types.src.models import (
    RelationType, CandidateRelation,
)


_POWER_NET_RE = re.compile(r"^(VCC|VDD|V\d|GND|VBAT|\+\d+V|-\d+V|3V3|5V|12V)", re.IGNORECASE)


def _classify_net(name: str) -> str:
    """Classify a net by name pattern."""
    upper = name.upper()
    if _POWER_NET_RE.match(name):
        return "power"
    if any(k in upper for k in ("SDA", "SCL", "I2C")):
        return "I2C"
    if any(k in upper for k in ("MOSI", "MISO", "SCK", "SPI")):
        return "SPI"
    if any(k in upper for k in ("TX", "RX", "UART")):
        return "UART"
    if any(k in upper for k in ("MOTOR", "STEP", "DIR")):
        return "motor_control"
    return "signal"


class KicadNetlistAnalyzer:
    """Analyze KiCad PCB files for component connectivity."""

    @staticmethod
    def analyze_pcb(
        pcb_path: str,
        index: EntityIndex,
    ) -> tuple[list[CandidateRelation], list[str]]:
        """Analyze a .kicad_pcb file. Returns (candidate relations, warnings)."""
        warnings: list[str] = []
        try:
            pcb_data = KiCadConnector.parse_pcb(pcb_path)
        except (FileNotFoundError, PermissionError, Exception):
            return [], []

        components = pcb_data.get("components", [])

        # Map component reference → entity ID via index
        ref_to_entity: dict[str, str] = {}
        ref_to_name: dict[str, str] = {}
        for comp in components:
            ref = comp["name"]  # e.g., "U1"
            entity = index.by_ref.get(ref)
            if entity:
                ref_to_entity[ref] = entity.id
                ref_to_name[ref] = entity.name

        # Build net → [component refs] map
        net_components: dict[str, list[str]] = {}
        for comp in components:
            ref = comp["name"]
            if ref not in ref_to_entity:
                continue
            for net_name in comp.get("connected_nets", []):
                if net_name:
                    net_components.setdefault(net_name, []).append(ref)

        candidates: list[CandidateRelation] = []

        for net_name, refs in net_components.items():
            net_type = _classify_net(net_name)

            # Skip power nets — but warn about it
            if net_type == "power":
                if len(refs) >= 2:
                    warnings.append(f"Skipped power net '{net_name}' (connects {len(refs)} components)")
                continue

            # Skip nets with only one component
            if len(refs) < 2:
                continue

            # Motor control nets: look for driver→motor drives relation
            if net_type == "motor_control":
                drivers = [r for r in refs if r.startswith("U")]
                motors = [r for r in refs if r.startswith("M")]
                for d in drivers:
                    for m in motors:
                        if d in ref_to_entity and m in ref_to_entity:
                            candidates.append(CandidateRelation(
                                source_entity_id=ref_to_entity[d],
                                target_entity_id=ref_to_entity[m],
                                source_entity_name=ref_to_name.get(d, d),
                                target_entity_name=ref_to_name.get(m, m),
                                relation_type=RelationType.DRIVES,
                                confidence=0.95,
                                discovered_by="kicad_netlist",
                                evidence=f"{ref_to_name.get(d, d)} and {ref_to_name.get(m, m)} share motor net '{net_name}' on PCB",
                            ))

            # Signal nets: pairwise connected_to
            sorted_refs = sorted(set(refs))
            for a, b in combinations(sorted_refs, 2):
                if a in ref_to_entity and b in ref_to_entity:
                    candidates.append(CandidateRelation(
                        source_entity_id=ref_to_entity[a],
                        target_entity_id=ref_to_entity[b],
                        source_entity_name=ref_to_name.get(a, a),
                        target_entity_name=ref_to_name.get(b, b),
                        relation_type=RelationType.CONNECTED_TO,
                        confidence=0.95,
                        discovered_by="kicad_netlist",
                        evidence=f"{ref_to_name.get(a, a)} and {ref_to_name.get(b, b)} share {net_type} net '{net_name}' on PCB",
                    ))

        # Dedup: same pair + same relation_type → keep first
        seen = set()
        deduped = []
        for c in candidates:
            key = (min(c.source_entity_id, c.target_entity_id),
                   max(c.source_entity_id, c.target_entity_id),
                   c.relation_type)
            if key not in seen:
                seen.add(key)
                deduped.append(c)

        return deduped, warnings
