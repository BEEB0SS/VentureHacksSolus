"""Tests for the Python AST analyzer."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType, SourceType,
)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")


def _make_index():
    """Build a minimal EntityIndex for test matching."""
    from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex
    entities = [
        Entity(id="e-motor-ctrl", entity_type=EntityType.SOFTWARE_MODULE,
               name="motor_controller.py", source_ref="src/motor_controller.py"),
        Entity(id="e-sensor-rdr", entity_type=EntityType.SOFTWARE_MODULE,
               name="sensor_reader.py", source_ref="src/sensor_reader.py"),
        Entity(id="e-drv8825", entity_type=EntityType.ELECTRICAL_PART,
               name="DRV8825", metadata={"ref": "U2", "addr": ""}),
        Entity(id="e-mpu6050", entity_type=EntityType.ELECTRICAL_PART,
               name="MPU6050", metadata={"ref": "U3", "addr": "0x68"}),
        Entity(id="e-vl53l0x", entity_type=EntityType.ELECTRICAL_PART,
               name="VL53L0X", metadata={"ref": "U4", "addr": "0x29"}),
        Entity(id="e-cmd-vel", entity_type=EntityType.INTERFACE,
               name="/cmd_vel"),
        Entity(id="e-odom", entity_type=EntityType.INTERFACE,
               name="/odom"),
        Entity(id="e-imu-data", entity_type=EntityType.INTERFACE,
               name="/imu/data"),
        Entity(id="e-scan", entity_type=EntityType.INTERFACE,
               name="/scan"),
    ]
    return EntityIndex(entities)


class TestRosTopicDiscovery:
    def test_finds_subscription(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        subs = [r for r in results if r.relation_type == RelationType.SUBSCRIBES_TO]
        assert any(r.target_entity_id == "e-cmd-vel" for r in subs)

    def test_finds_publisher(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        pubs = [r for r in results if r.relation_type == RelationType.PUBLISHES]
        assert any(r.target_entity_id == "e-odom" for r in pubs)

    def test_confidence_is_085(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        topic_results = [r for r in results if r.relation_type in (RelationType.PUBLISHES, RelationType.SUBSCRIBES_TO)]
        assert all(r.confidence == 0.85 for r in topic_results)


class TestHardwareRefDiscovery:
    def test_finds_hex_address_match(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "sensor_reader.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-sensor-rdr", index)
        hw_results = [r for r in results if r.relation_type == RelationType.READS_FROM]
        target_ids = {r.target_entity_id for r in hw_results}
        assert "e-mpu6050" in target_ids  # 0x68
        assert "e-vl53l0x" in target_ids  # 0x29

    def test_finds_name_reference(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        hw_results = [r for r in results if r.relation_type == RelationType.CONFIGURED_BY]
        target_ids = {r.target_entity_id for r in hw_results}
        assert "e-drv8825" in target_ids  # DRV8825 in variable names


class TestAllFieldsPresent:
    def test_candidate_has_all_fields(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_controller.py")
        results = PythonAstAnalyzer.analyze_file(path, "e-motor-ctrl", index)
        assert len(results) > 0
        r = results[0]
        assert r.source_entity_id == "e-motor-ctrl"
        assert r.discovered_by == "python_ast"
        assert r.evidence != ""
        assert r.source_entity_name == "motor_controller.py"


class TestBadFile:
    def test_nonexistent_file_returns_empty(self):
        from apps.backend.src.analyzers.python_ast_analyzer import PythonAstAnalyzer
        index = _make_index()
        results = PythonAstAnalyzer.analyze_file("/nonexistent.py", "e-x", index)
        assert results == []
