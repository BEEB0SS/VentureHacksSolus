"""Tests for the context engine — entity CRUD."""

from packages.shared_types.src.models import (
    Entity, EntityType, Relation, RelationType,
    Project, SourceConnection, SourceType,
    Snapshot, ChangeEvent, ChangeType,
)


class TestProjectCRUD:
    def test_create_project(self, fresh_db):
        from apps.backend.src.context_engine import ContextEngine
        p = ContextEngine.create_project(Project(name="MyBot", description="Test"))
        assert p.id
        assert p.name == "MyBot"

    def test_list_projects(self, fresh_db):
        from apps.backend.src.context_engine import ContextEngine
        ContextEngine.create_project(Project(name="Bot1"))
        ContextEngine.create_project(Project(name="Bot2"))
        projects = ContextEngine.list_projects()
        assert len(projects) == 2

    def test_get_project(self, fresh_db):
        from apps.backend.src.context_engine import ContextEngine
        p = ContextEngine.create_project(Project(name="MyBot"))
        found = ContextEngine.get_project(p.id)
        assert found is not None
        assert found.name == "MyBot"

    def test_get_project_not_found(self, fresh_db):
        from apps.backend.src.context_engine import ContextEngine
        assert ContextEngine.get_project("nonexistent") is None


class TestEntityCRUD:
    def test_create_entity(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e = engine.create_entity(Entity(
            entity_type=EntityType.ELECTRICAL_PART,
            name="DRV8825",
            description="Stepper motor driver",
            metadata={"package": "HTSSOP-28", "voltage": "8.2-45V"},
        ))
        assert e.id
        assert e.project_id == project_id
        assert e.name == "DRV8825"

    def test_get_entity(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e = engine.create_entity(Entity(
            entity_type=EntityType.SOFTWARE_MODULE,
            name="motor_controller.py",
        ))
        found = engine.get_entity(e.id)
        assert found is not None
        assert found.name == "motor_controller.py"

    def test_get_entity_not_found(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        assert engine.get_entity("nonexistent") is None

    def test_list_entities(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="main.py"))
        entities = engine.list_entities()
        assert len(entities) == 2

    def test_list_entities_by_type(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="main.py"))
        engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="TMC2209"))
        elec = engine.list_entities(entity_type=EntityType.ELECTRICAL_PART)
        assert len(elec) == 2
        assert all(e.entity_type == EntityType.ELECTRICAL_PART for e in elec)

    def test_update_entity(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        updated = engine.update_entity(e.id, name="TMC2209", description="New driver")
        assert updated.name == "TMC2209"
        assert updated.description == "New driver"

    def test_delete_entity(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        assert engine.delete_entity(e.id) is True
        assert engine.get_entity(e.id) is None

    def test_delete_entity_not_found(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        assert engine.delete_entity("nonexistent") is False


class TestRelationCRUD:
    def _make_two_entities(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="motor_controller.py"))
        return engine, e1, e2

    def test_create_relation(self, project_id):
        engine, e1, e2 = self._make_two_entities(project_id)
        r = engine.create_relation(Relation(
            source_entity_id=e1.id, target_entity_id=e2.id, relation_type=RelationType.DRIVES,
        ))
        assert r.id
        assert r.project_id == project_id
        assert r.source_entity_id == e1.id
        assert r.target_entity_id == e2.id

    def test_list_relations(self, project_id):
        engine, e1, e2 = self._make_two_entities(project_id)
        engine.create_relation(Relation(source_entity_id=e1.id, target_entity_id=e2.id, relation_type=RelationType.DRIVES))
        engine.create_relation(Relation(source_entity_id=e2.id, target_entity_id=e1.id, relation_type=RelationType.READS_FROM))
        rels = engine.list_relations()
        assert len(rels) == 2

    def test_delete_relation(self, project_id):
        engine, e1, e2 = self._make_two_entities(project_id)
        r = engine.create_relation(Relation(source_entity_id=e1.id, target_entity_id=e2.id, relation_type=RelationType.DRIVES))
        assert engine.delete_relation(r.id) is True
        assert len(engine.list_relations()) == 0

    def test_delete_relation_not_found(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        assert engine.delete_relation("nonexistent") is False


class TestFullGraph:
    def test_get_full_graph(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="motor_ctrl"))
        engine.create_relation(Relation(source_entity_id=e1.id, target_entity_id=e2.id, relation_type=RelationType.DRIVES))
        graph = engine.get_full_graph()
        assert len(graph["entities"]) == 2
        assert len(graph["relations"]) == 1

    def test_get_full_graph_empty(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        graph = engine.get_full_graph()
        assert graph["entities"] == []
        assert graph["relations"] == []


class TestSourceConnections:
    def test_create_source(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(
            source_type=SourceType.KICAD, name="Motor Controller PCB",
            config={"path": "/home/user/kicad/motor.kicad_sch"},
        ))
        assert src.id
        assert src.project_id == project_id
        assert src.source_type == SourceType.KICAD

    def test_list_sources(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        engine.create_source(SourceConnection(source_type=SourceType.GITHUB, name="Repo"))
        sources = engine.list_sources()
        assert len(sources) == 2


class TestSnapshotDiff:
    def test_create_snapshot(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        snap = engine.create_snapshot(src.id, {
            "DRV8825": {"type": "electrical_part", "package": "HTSSOP-28", "voltage": "8.2-45V"},
            "NEMA17": {"type": "mechanical_part", "torque": "0.44Nm"},
        })
        assert snap.id
        assert snap.source_connection_id == src.id

    def test_diff_detects_added(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        snap_old = engine.create_snapshot(src.id, {"DRV8825": {"type": "electrical_part"}})
        snap_new = engine.create_snapshot(src.id, {"DRV8825": {"type": "electrical_part"}, "TMC2209": {"type": "electrical_part"}})
        changes = engine.diff_snapshots(snap_old.id, snap_new.id)
        added = [c for c in changes if c.change_type == ChangeType.ADDED]
        assert len(added) == 1
        assert added[0].entity_name == "TMC2209"

    def test_diff_detects_removed(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        snap_old = engine.create_snapshot(src.id, {"DRV8825": {"type": "electrical_part"}, "NEMA17": {"type": "mechanical_part"}})
        snap_new = engine.create_snapshot(src.id, {"NEMA17": {"type": "mechanical_part"}})
        changes = engine.diff_snapshots(snap_old.id, snap_new.id)
        removed = [c for c in changes if c.change_type == ChangeType.REMOVED]
        assert len(removed) == 1
        assert removed[0].entity_name == "DRV8825"

    def test_diff_detects_modified(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        snap_old = engine.create_snapshot(src.id, {"DRV8825": {"type": "electrical_part", "voltage": "8.2-45V"}})
        snap_new = engine.create_snapshot(src.id, {"DRV8825": {"type": "electrical_part", "voltage": "4.75-29V"}})
        changes = engine.diff_snapshots(snap_old.id, snap_new.id)
        modified = [c for c in changes if c.change_type == ChangeType.MODIFIED]
        assert len(modified) == 1
        assert modified[0].entity_name == "DRV8825"
        assert "voltage" in modified[0].diff_data

    def test_diff_no_changes(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        data = {"DRV8825": {"type": "electrical_part"}}
        snap_old = engine.create_snapshot(src.id, data)
        snap_new = engine.create_snapshot(src.id, data)
        changes = engine.diff_snapshots(snap_old.id, snap_new.id)
        assert len(changes) == 0

    def test_list_changes(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        snap_old = engine.create_snapshot(src.id, {"A": {"v": 1}})
        snap_new = engine.create_snapshot(src.id, {"A": {"v": 2}, "B": {"v": 1}})
        engine.diff_snapshots(snap_old.id, snap_new.id)
        changes = engine.list_changes()
        assert len(changes) == 2  # 1 modified + 1 added


class TestImpactAnalysis:
    def _build_chain(self, project_id):
        """Build: DRV8825 --drives--> motor_ctrl --depends_on--> ros_node --publishes--> /cmd_vel"""
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="motor_controller.py"))
        e3 = engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="ros_navigation"))
        e4 = engine.create_entity(Entity(entity_type=EntityType.INTERFACE, name="/cmd_vel"))
        engine.create_relation(Relation(source_entity_id=e1.id, target_entity_id=e2.id, relation_type=RelationType.DRIVES))
        engine.create_relation(Relation(source_entity_id=e2.id, target_entity_id=e3.id, relation_type=RelationType.DEPENDS_ON))
        engine.create_relation(Relation(source_entity_id=e3.id, target_entity_id=e4.id, relation_type=RelationType.PUBLISHES))
        return engine, e1, e2, e3, e4

    def test_impact_from_root(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        impacted = engine.impact_analysis(e1.id, depth=3)
        impacted_ids = {e.id for e in impacted}
        assert e2.id in impacted_ids
        assert e3.id in impacted_ids
        assert e4.id in impacted_ids
        assert e1.id not in impacted_ids

    def test_impact_depth_limit(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        impacted = engine.impact_analysis(e1.id, depth=1)
        impacted_ids = {e.id for e in impacted}
        assert e2.id in impacted_ids
        assert e3.id not in impacted_ids

    def test_impact_from_middle(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        impacted = engine.impact_analysis(e2.id, depth=3)
        impacted_ids = {e.id for e in impacted}
        assert e1.id in impacted_ids
        assert e3.id in impacted_ids
        assert e4.id in impacted_ids

    def test_impact_isolated_entity(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="Lone"))
        impacted = engine.impact_analysis(e.id)
        assert len(impacted) == 0


class TestSubgraph:
    def _build_chain(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        e1 = engine.create_entity(Entity(entity_type=EntityType.ELECTRICAL_PART, name="DRV8825"))
        e2 = engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="motor_ctrl"))
        e3 = engine.create_entity(Entity(entity_type=EntityType.SOFTWARE_MODULE, name="ros_nav"))
        e4 = engine.create_entity(Entity(entity_type=EntityType.INTERFACE, name="/cmd_vel"))
        engine.create_relation(Relation(source_entity_id=e1.id, target_entity_id=e2.id, relation_type=RelationType.DRIVES))
        engine.create_relation(Relation(source_entity_id=e2.id, target_entity_id=e3.id, relation_type=RelationType.DEPENDS_ON))
        engine.create_relation(Relation(source_entity_id=e3.id, target_entity_id=e4.id, relation_type=RelationType.PUBLISHES))
        return engine, e1, e2, e3, e4

    def test_subgraph_depth_1(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        sub = engine.get_subgraph(e2.id, depth=1)
        entity_ids = {e["id"] for e in sub["entities"]}
        assert e2.id in entity_ids
        assert e1.id in entity_ids
        assert e3.id in entity_ids
        assert e4.id not in entity_ids

    def test_subgraph_includes_relevant_relations(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        sub = engine.get_subgraph(e2.id, depth=1)
        assert len(sub["relations"]) == 2  # e1->e2, e2->e3
