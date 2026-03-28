"""Tests for the DiscoveryEngine — merge, dedup, boosting."""

import os
from packages.shared_types.src.models import (
    Entity, EntityType, RelationType, Relation,
    CandidateRelation, SourceConnection, SourceType,
)


class TestMergeAndDedup:
    def test_dedup_against_existing_relations(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="ESP32"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="MPU6050"))
        engine.create_relation(Relation(
            source_entity_id=e1.id, target_entity_id=e2.id,
            relation_type=RelationType.CONNECTED_TO,
        ))
        candidate = CandidateRelation(
            source_entity_id=e1.id, target_entity_id=e2.id,
            source_entity_name="ESP32", target_entity_name="MPU6050",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([candidate])
        assert report.duplicates_skipped == 1
        assert report.new_relations == 0

    def test_cross_modal_boosting(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        c1 = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.85, discovered_by="python_ast", evidence="from AST",
        )
        c2 = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="from PCB",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([c1, c2])
        assert report.boosted == 1
        assert report.relations[0].confidence == 1.0
        assert "AST" in report.relations[0].evidence
        assert "PCB" in report.relations[0].evidence

    def test_symmetric_dedup(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        c1 = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test",
        )
        c2 = CandidateRelation(
            source_entity_id="b", target_entity_id="a",
            source_entity_name="Y", target_entity_name="X",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test reverse",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([c1, c2])
        assert report.new_relations == 1

    def test_min_confidence_filter(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        c_high = CandidateRelation(
            source_entity_id="a", target_entity_id="b",
            source_entity_name="X", target_entity_name="Y",
            relation_type=RelationType.DEPENDS_ON,
            confidence=0.9, discovered_by="python_ast", evidence="test",
        )
        c_low = CandidateRelation(
            source_entity_id="c", target_entity_id="d",
            source_entity_name="W", target_entity_name="Z",
            relation_type=RelationType.CONFIGURED_BY,
            confidence=0.4, discovered_by="config_file", evidence="test",
        )
        disco = DiscoveryEngine(project_id)
        report = disco._merge_and_dedup([c_high, c_low], min_confidence=0.6)
        assert report.new_relations == 1
        assert report.relations[0].confidence == 0.9


class TestBatchAdd:
    def test_auto_add_creates_relations(self, project_id):
        from apps.backend.src.discovery_engine import DiscoveryEngine
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="ChipA"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="ChipB"))
        candidate = CandidateRelation(
            source_entity_id=e1.id, target_entity_id=e2.id,
            source_entity_name="ChipA", target_entity_name="ChipB",
            relation_type=RelationType.CONNECTED_TO,
            confidence=0.95, discovered_by="kicad_netlist", evidence="test",
        )
        disco = DiscoveryEngine(project_id)
        disco._batch_add_relations([candidate])
        rels = engine.list_relations()
        assert len(rels) == 1
        assert rels[0].source_entity_id == e1.id
        assert rels[0].target_entity_id == e2.id
        assert candidate.added is True
