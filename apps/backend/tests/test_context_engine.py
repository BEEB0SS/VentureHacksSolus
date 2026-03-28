"""Tests for the context engine — entity CRUD."""

from packages.shared_types.src.models import (
    Entity, EntityType, Relation, RelationType,
    Project, SourceConnection, SourceType,
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
