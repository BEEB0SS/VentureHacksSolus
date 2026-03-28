"""Tests for the config file analyzer."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType,
)
from apps.backend.src.analyzers.python_ast_analyzer import EntityIndex

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")


def _make_index():
    """Build EntityIndex matching the motor_params.yaml fixture."""
    entities = [
        Entity(id="e-drv8825", entity_type=EntityType.ELECTRICAL_PART,
               name="DRV8825", metadata={"ref": "U2"}),
        Entity(id="e-nema17", entity_type=EntityType.MECHANICAL_PART,
               name="NEMA17", metadata={"ref": "M1"}),
        Entity(id="e-mpu6050", entity_type=EntityType.ELECTRICAL_PART,
               name="MPU6050", metadata={"ref": "U3", "addr": "0x68"}),
        Entity(id="e-vl53l0x", entity_type=EntityType.ELECTRICAL_PART,
               name="VL53L0X", metadata={"ref": "U4", "addr": "0x29"}),
        Entity(id="e-cmd-vel", entity_type=EntityType.INTERFACE, name="/cmd_vel"),
        Entity(id="e-odom", entity_type=EntityType.INTERFACE, name="/odom"),
        Entity(id="e-imu-data", entity_type=EntityType.INTERFACE, name="/imu/data"),
        Entity(id="e-scan", entity_type=EntityType.INTERFACE, name="/scan"),
        Entity(id="e-config", entity_type=EntityType.DOCUMENT,
               name="motor_params.yaml", source_ref="config/motor_params.yaml"),
    ]
    return EntityIndex(entities)


class TestYamlEntityReferences:
    def test_finds_entity_name_reference(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-drv8825" in target_ids   # "DRV8825" in YAML
        assert "e-nema17" in target_ids    # "NEMA17" in YAML

    def test_finds_address_reference(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-mpu6050" in target_ids   # "0x68" in YAML

    def test_finds_topic_reference(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-cmd-vel" in target_ids   # "/cmd_vel" in YAML
        assert "e-imu-data" in target_ids  # "/imu/data" in YAML

    def test_relation_type_is_configured_by(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        assert all(r.relation_type == RelationType.CONFIGURED_BY for r in results)

    def test_confidence_is_07(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        path = os.path.join(FIXTURES, "motor_params.yaml")
        results = ConfigFileAnalyzer.analyze_file(path, "e-config", index)
        assert all(r.confidence == 0.7 for r in results)


class TestBadFile:
    def test_nonexistent_file_returns_empty(self):
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        results = ConfigFileAnalyzer.analyze_file("/nonexistent.yaml", "e-x", index)
        assert results == []

    def test_json_file(self, tmp_path):
        """Test that JSON files are also parsed."""
        from apps.backend.src.analyzers.config_file_analyzer import ConfigFileAnalyzer
        index = _make_index()
        json_file = tmp_path / "config.json"
        json_file.write_text('{"driver": "DRV8825", "topic": "/cmd_vel"}')
        results = ConfigFileAnalyzer.analyze_file(str(json_file), "e-config", index)
        target_ids = {r.target_entity_id for r in results}
        assert "e-drv8825" in target_ids
        assert "e-cmd-vel" in target_ids
