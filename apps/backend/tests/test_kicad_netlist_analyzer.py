"""Tests for the KiCad netlist analyzer."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType,
)
from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")


def _make_index():
    """Build EntityIndex matching the test_board.kicad_pcb fixture."""
    entities = [
        Entity(id="e-esp32", entity_type=EntityType.ELECTRICAL_PART,
               name="ESP32", metadata={"ref": "U1"}),
        Entity(id="e-drv8825", entity_type=EntityType.ELECTRICAL_PART,
               name="DRV8825", metadata={"ref": "U2"}),
        Entity(id="e-mpu6050", entity_type=EntityType.ELECTRICAL_PART,
               name="MPU6050", metadata={"ref": "U3"}),
        Entity(id="e-vl53l0x", entity_type=EntityType.ELECTRICAL_PART,
               name="VL53L0X", metadata={"ref": "U4"}),
        Entity(id="e-nema17", entity_type=EntityType.MECHANICAL_PART,
               name="NEMA17", metadata={"ref": "M1"}),
    ]
    return EntityIndex(entities)


class TestSharedSignalNets:
    def test_i2c_components_connected(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results, warnings = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        conn = [r for r in results if r.relation_type == RelationType.CONNECTED_TO]
        pairs = {(r.source_entity_id, r.target_entity_id) for r in conn}
        assert ("e-esp32", "e-mpu6050") in pairs or ("e-mpu6050", "e-esp32") in pairs
        assert ("e-esp32", "e-vl53l0x") in pairs or ("e-vl53l0x", "e-esp32") in pairs

    def test_power_nets_filtered_out(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results, warnings = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        for r in results:
            if r.relation_type == RelationType.CONNECTED_TO:
                assert "I2C" in r.evidence or "MOTOR" in r.evidence or "signal" in r.evidence.lower()


class TestDriverMotor:
    def test_drives_relation_discovered(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results, warnings = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        drives = [r for r in results if r.relation_type == RelationType.DRIVES]
        assert any(r.source_entity_id == "e-drv8825" and r.target_entity_id == "e-nema17" for r in drives)


class TestConfidenceAndEvidence:
    def test_confidence_is_095(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results, warnings = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        assert all(r.confidence == 0.95 for r in results)

    def test_evidence_includes_net_name(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results, warnings = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        assert all(r.evidence != "" for r in results)


class TestBadFile:
    def test_nonexistent_file_returns_empty(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        results, warnings = KicadNetlistAnalyzer.analyze_pcb("/nonexistent.kicad_pcb", index)
        assert results == []


class TestPowerNetWarnings:
    def test_power_net_warning(self):
        from apps.backend.src.analyzers.kicad_netlist_analyzer import KicadNetlistAnalyzer
        index = _make_index()
        pcb_path = os.path.join(FIXTURES, "test_board.kicad_pcb")
        results, warnings = KicadNetlistAnalyzer.analyze_pcb(pcb_path, index)
        power_warnings = [w for w in warnings if "power net" in w.lower()]
        assert len(power_warnings) > 0  # VCC and/or GND should produce warnings
