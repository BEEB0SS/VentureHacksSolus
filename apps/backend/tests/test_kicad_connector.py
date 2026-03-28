"""Tests for KiCad connector — S-expression parsing."""
import os
from packages.shared_types.src.models import EntityType

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")

class TestKicadSchematicParsing:
    def test_parse_schematic_finds_components(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        path = os.path.join(FIXTURES, "test_motor.kicad_sch")
        result = KiCadConnector.parse_schematic(path)
        names = {c["name"] for c in result["components"]}
        assert "U1" in names
        assert "R1" in names
        assert "R2" in names

    def test_parse_schematic_extracts_properties(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        path = os.path.join(FIXTURES, "test_motor.kicad_sch")
        result = KiCadConnector.parse_schematic(path)
        u1 = next(c for c in result["components"] if c["name"] == "U1")
        assert u1["value"] == "DRV8825"
        assert "HTSSOP" in u1["footprint"]

    def test_parse_schematic_classifies_type(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        path = os.path.join(FIXTURES, "test_motor.kicad_sch")
        result = KiCadConnector.parse_schematic(path)
        u1 = next(c for c in result["components"] if c["name"] == "U1")
        assert u1["entity_type"] == EntityType.ELECTRICAL_PART

class TestKicadPCBParsing:
    def test_parse_pcb_finds_nets(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        path = os.path.join(FIXTURES, "test_motor.kicad_pcb")
        result = KiCadConnector.parse_pcb(path)
        net_names = {n["name"] for n in result["nets"]}
        assert "VCC" in net_names
        assert "MOTOR_L" in net_names

    def test_parse_pcb_finds_footprints(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        path = os.path.join(FIXTURES, "test_motor.kicad_pcb")
        result = KiCadConnector.parse_pcb(path)
        refs = {f["name"] for f in result["components"]}
        assert "U1" in refs
        assert "R1" in refs

    def test_parse_pcb_component_net_connections(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        path = os.path.join(FIXTURES, "test_motor.kicad_pcb")
        result = KiCadConnector.parse_pcb(path)
        u1 = next(c for c in result["components"] if c["name"] == "U1")
        assert len(u1["connected_nets"]) > 0

class TestKicadFullSync:
    def test_sync_returns_snapshot_data(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        sch_path = os.path.join(FIXTURES, "test_motor.kicad_sch")
        pcb_path = os.path.join(FIXTURES, "test_motor.kicad_pcb")
        snapshot = KiCadConnector.sync(schematic_path=sch_path, pcb_path=pcb_path)
        assert "U1" in snapshot
        assert "R1" in snapshot
        assert "VCC" in snapshot
        assert snapshot["U1"]["type"] == "electrical_part"

    def test_sync_schematic_only(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        sch_path = os.path.join(FIXTURES, "test_motor.kicad_sch")
        snapshot = KiCadConnector.sync(schematic_path=sch_path)
        assert "U1" in snapshot
