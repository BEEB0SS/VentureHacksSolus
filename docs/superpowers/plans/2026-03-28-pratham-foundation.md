# Pratham Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entire foundation layer for Solus — context engine, KiCad connector, GitHub connector, core API routes, WorkspaceTab, and ContextModelTab — so that every other teammate can build on top of it.

**Architecture:** The context engine is an in-memory graph backed by SQLite persistence. It provides entity/relation CRUD, snapshot diffing, and BFS-based impact analysis. Two connectors (KiCad, GitHub) parse external files and feed entities into the graph. A FastAPI APIRouter exposes everything as REST endpoints. Two React/TypeScript frontend tabs consume the API: WorkspaceTab for project/source management, ContextModelTab for the interactive D3 force graph.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, pytest; React 18, TypeScript, Tailwind CSS v4, D3.js

---

## Prerequisite: Package Setup

Before starting any task, ensure the project root has a `pyproject.toml` that makes local packages importable. This replaces all `sys.path.insert` hacks in the codebase.

Create `pyproject.toml` in the project root (if it doesn't exist):

```toml
[project]
name = "solus"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["fastapi", "uvicorn"]

[tool.setuptools.packages.find]
include = ["apps.*", "packages.*"]
```

Then run: `pip install -e .`

This allows all imports like `from packages.shared_types.src.models import ...` and `from apps.backend.src.context_engine import ...` to resolve naturally. **Do NOT use `sys.path.insert` hacks** — they are fragile and break when files move.

**Note:** The `packages/shared_types/` directory was renamed from `shared-types` to `shared_types` because Python cannot import from directories with hyphens in their names.

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/context_engine.py` | Graph engine: entity/relation CRUD, snapshot+diff, BFS impact analysis, subgraph retrieval |
| `apps/backend/src/connectors/kicad_connector.py` | Parse .kicad_sch/.kicad_pcb S-expression files, extract components + nets as entities + relations |
| `apps/backend/src/connectors/github_connector.py` | Walk a local repo dir, classify robotics files (ROS packages, CAD, configs), create entities |
| `apps/backend/src/routes_core.py` | FastAPI APIRouter — all 14 core endpoints |
| `apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx` | Project selector, sources panel, sync buttons, changes timeline |
| `apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx` | D3 force-directed graph, node/edge rendering, impact analysis button |
| `apps/backend/tests/test_context_engine.py` | Tests for the context engine |
| `apps/backend/tests/test_kicad_connector.py` | Tests for KiCad parsing |
| `apps/backend/tests/test_github_connector.py` | Tests for GitHub repo walking |
| `apps/backend/tests/test_routes_core.py` | Integration tests for API routes |
| `apps/backend/tests/conftest.py` | Shared test fixtures (in-memory DB, test project) |

### Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/main.py` | Add `include_router(core_router)` — Teammate 3 owns this file, but Pratham needs it wired for testing. Add it with a comment so Teammate 3 knows. |

### Existing Files (Read-Only References)

| File | Used For |
|------|----------|
| `packages/shared_types/src/models.py` | All dataclass types: Entity, Relation, Project, TeamMember, SourceConnection, Snapshot, ChangeEvent, ChangeImpactReport |
| `apps/backend/src/database.py` | `get_connection()`, `init_db()` — SQLite schema already defined. **Note:** `get_connection()` reads `SOLUS_DB_PATH` from the environment on every call (not cached at import time), so tests can safely set `os.environ["SOLUS_DB_PATH"]` per-fixture. |

---

## Task 1: Test Infrastructure + Context Engine — Entity CRUD

**Files:**
- Create: `apps/backend/tests/__init__.py`
- Create: `apps/backend/tests/conftest.py`
- Create: `apps/backend/tests/test_context_engine.py`
- Create: `apps/backend/src/context_engine.py`

**Context:** The context engine is a class that wraps all graph operations for a single project. It uses the shared SQLite database via `database.py`. All types come from `packages/shared_types/src/models.py`.

- [ ] **Step 1: Create test infrastructure**

Create `apps/backend/tests/__init__.py` (empty file) and `apps/backend/tests/conftest.py`:

```python
"""Shared test fixtures for Solus backend tests."""

import os
import pytest


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    """Give every test a fresh SQLite database.

    Uses a temp file (not :memory:) because each get_connection() call
    opens a new connection, and :memory: creates a separate DB per connection.
    The env var is read dynamically by get_connection() on every call.
    """
    db_path = str(tmp_path / "test.db")
    os.environ["SOLUS_DB_PATH"] = db_path
    from apps.backend.src.database import init_db
    init_db()
    yield db_path


@pytest.fixture
def project_id(fresh_db):
    """Create a test project and return its ID."""
    from apps.backend.src.context_engine import ContextEngine
    from packages.shared_types.src.models import Project
    p = ContextEngine.create_project(Project(name="TestBot", description="A test robot"))
    return p.id
```

- [ ] **Step 2: Write failing tests for entity CRUD**

Create `apps/backend/tests/test_context_engine.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py -v 2>&1 | head -30`
Expected: FAIL — `ImportError: cannot import name 'ContextEngine'`

- [ ] **Step 4: Implement context engine — Project CRUD + Entity CRUD**

Create `apps/backend/src/context_engine.py`:

```python
"""
Solus Context Engine — The graph engine at the heart of the Robotics Context Model.

Provides entity/relation CRUD, snapshot diffing, BFS impact analysis,
and subgraph retrieval. Backed by SQLite via database.py.
"""

import json
from typing import Optional
from collections import deque

from .database import get_connection

from packages.shared_types.src.models import (
    Entity, EntityType, Relation, RelationType,
    Project, TeamMember, SourceConnection, SourceType,
    Snapshot, ChangeEvent, ChangeType, ChangeImpactReport,
    _uid, _now,
)


class ContextEngine:
    """Graph engine scoped to a single project."""

    def __init__(self, project_id: str):
        self.project_id = project_id

    # ── Project CRUD (static — not scoped to a project) ──

    @staticmethod
    def create_project(project: Project) -> Project:
        if not project.id:
            project.id = _uid()
        if not project.created_at:
            project.created_at = _now()
        if not project.updated_at:
            project.updated_at = _now()
        conn = get_connection()
        conn.execute(
            "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (project.id, project.name, project.description, project.created_at, project.updated_at),
        )
        conn.commit()
        conn.close()
        return project

    @staticmethod
    def list_projects() -> list[Project]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        conn.close()
        return [Project(id=r["id"], name=r["name"], description=r["description"],
                        created_at=r["created_at"], updated_at=r["updated_at"]) for r in rows]

    @staticmethod
    def get_project(project_id: str) -> Optional[Project]:
        conn = get_connection()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        conn.close()
        if not row:
            return None
        return Project(id=row["id"], name=row["name"], description=row["description"],
                       created_at=row["created_at"], updated_at=row["updated_at"])

    # ── Team CRUD ──

    def add_team_member(self, member: TeamMember) -> TeamMember:
        member.project_id = self.project_id
        if not member.id:
            member.id = _uid()
        conn = get_connection()
        conn.execute(
            "INSERT INTO team_members (id, project_id, name, role, email) VALUES (?, ?, ?, ?, ?)",
            (member.id, member.project_id, member.name, member.role, member.email),
        )
        conn.commit()
        conn.close()
        return member

    def list_team_members(self) -> list[TeamMember]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM team_members WHERE project_id = ?", (self.project_id,)).fetchall()
        conn.close()
        return [TeamMember(id=r["id"], project_id=r["project_id"], name=r["name"],
                           role=r["role"], email=r["email"]) for r in rows]

    # ── Entity CRUD ──

    def create_entity(self, entity: Entity) -> Entity:
        entity.project_id = self.project_id
        if not entity.id:
            entity.id = _uid()
        if not entity.created_at:
            entity.created_at = _now()
        entity.updated_at = _now()
        conn = get_connection()
        conn.execute(
            """INSERT INTO entities (id, project_id, entity_type, name, description, metadata, source, source_ref, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (entity.id, entity.project_id, entity.entity_type.value if isinstance(entity.entity_type, EntityType) else entity.entity_type,
             entity.name, entity.description, json.dumps(entity.metadata),
             entity.source.value if isinstance(entity.source, SourceType) else entity.source,
             entity.source_ref, entity.created_at, entity.updated_at),
        )
        conn.commit()
        conn.close()
        return entity

    def get_entity(self, entity_id: str) -> Optional[Entity]:
        conn = get_connection()
        row = conn.execute("SELECT * FROM entities WHERE id = ? AND project_id = ?",
                           (entity_id, self.project_id)).fetchone()
        conn.close()
        if not row:
            return None
        return self._row_to_entity(row)

    def list_entities(self, entity_type: Optional[EntityType] = None) -> list[Entity]:
        conn = get_connection()
        if entity_type:
            type_val = entity_type.value if isinstance(entity_type, EntityType) else entity_type
            rows = conn.execute(
                "SELECT * FROM entities WHERE project_id = ? AND entity_type = ? ORDER BY created_at",
                (self.project_id, type_val),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM entities WHERE project_id = ? ORDER BY created_at",
                (self.project_id,),
            ).fetchall()
        conn.close()
        return [self._row_to_entity(r) for r in rows]

    _UPDATABLE_ENTITY_FIELDS = {"name", "description", "entity_type", "metadata", "source", "source_ref"}

    def update_entity(self, entity_id: str, **kwargs) -> Optional[Entity]:
        entity = self.get_entity(entity_id)
        if not entity:
            return None
        for key, value in kwargs.items():
            if key in self._UPDATABLE_ENTITY_FIELDS:
                setattr(entity, key, value)
        entity.updated_at = _now()
        conn = get_connection()
        conn.execute(
            """UPDATE entities SET name=?, description=?, entity_type=?, metadata=?, source=?, source_ref=?, updated_at=?
               WHERE id=? AND project_id=?""",
            (entity.name, entity.description,
             entity.entity_type.value if isinstance(entity.entity_type, EntityType) else entity.entity_type,
             json.dumps(entity.metadata),
             entity.source.value if isinstance(entity.source, SourceType) else entity.source,
             entity.source_ref, entity.updated_at, entity_id, self.project_id),
        )
        conn.commit()
        conn.close()
        return entity

    def delete_entity(self, entity_id: str) -> bool:
        conn = get_connection()
        cursor = conn.execute("DELETE FROM entities WHERE id = ? AND project_id = ?",
                              (entity_id, self.project_id))
        conn.commit()
        deleted = cursor.rowcount > 0
        conn.close()
        return deleted

    @staticmethod
    def _row_to_entity(row) -> Entity:
        return Entity(
            id=row["id"],
            project_id=row["project_id"],
            entity_type=EntityType(row["entity_type"]),
            name=row["name"],
            description=row["description"],
            metadata=json.loads(row["metadata"]) if row["metadata"] else {},
            source=SourceType(row["source"]) if row["source"] else SourceType.MANUAL,
            source_ref=row["source_ref"] or "",
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/tests/ apps/backend/src/context_engine.py
git commit -m "feat: context engine — project + entity CRUD with tests"
```

---

## Task 2: Context Engine — Relation CRUD + Full Graph

**Files:**
- Modify: `apps/backend/tests/test_context_engine.py`
- Modify: `apps/backend/src/context_engine.py`

**Context:** Relations are edges in the graph. Each has a source_entity_id, target_entity_id, and relation_type. The full graph endpoint returns all entities and relations for a project. The `_row_to_entity` helper pattern from Task 1 should be replicated for relations.

- [ ] **Step 1: Write failing tests for relation CRUD + full graph**

Append to `apps/backend/tests/test_context_engine.py`:

```python
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
            source_entity_id=e1.id,
            target_entity_id=e2.id,
            relation_type=RelationType.DRIVES,
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
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py::TestRelationCRUD -v 2>&1 | head -20`
Expected: FAIL — `AttributeError: 'ContextEngine' object has no attribute 'create_relation'`

- [ ] **Step 3: Implement relation CRUD + full graph**

Add to `apps/backend/src/context_engine.py` inside the `ContextEngine` class, after the entity methods:

```python
    # ── Relation CRUD ──

    def create_relation(self, relation: Relation) -> Relation:
        relation.project_id = self.project_id
        if not relation.id:
            relation.id = _uid()
        if not relation.created_at:
            relation.created_at = _now()
        conn = get_connection()
        conn.execute(
            """INSERT INTO relations (id, project_id, source_entity_id, target_entity_id, relation_type, metadata, confidence, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (relation.id, relation.project_id, relation.source_entity_id, relation.target_entity_id,
             relation.relation_type.value if isinstance(relation.relation_type, RelationType) else relation.relation_type,
             json.dumps(relation.metadata), relation.confidence, relation.created_at),
        )
        conn.commit()
        conn.close()
        return relation

    def list_relations(self) -> list[Relation]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM relations WHERE project_id = ? ORDER BY created_at",
                            (self.project_id,)).fetchall()
        conn.close()
        return [self._row_to_relation(r) for r in rows]

    def delete_relation(self, relation_id: str) -> bool:
        conn = get_connection()
        cursor = conn.execute("DELETE FROM relations WHERE id = ? AND project_id = ?",
                              (relation_id, self.project_id))
        conn.commit()
        deleted = cursor.rowcount > 0
        conn.close()
        return deleted

    @staticmethod
    def _row_to_relation(row) -> Relation:
        return Relation(
            id=row["id"],
            project_id=row["project_id"],
            source_entity_id=row["source_entity_id"],
            target_entity_id=row["target_entity_id"],
            relation_type=RelationType(row["relation_type"]),
            metadata=json.loads(row["metadata"]) if row["metadata"] else {},
            confidence=row["confidence"],
            created_at=row["created_at"],
        )

    # ── Graph Queries ──

    def get_full_graph(self) -> dict:
        return {
            "entities": [self._entity_to_dict(e) for e in self.list_entities()],
            "relations": [self._relation_to_dict(r) for r in self.list_relations()],
        }

    @staticmethod
    def _entity_to_dict(entity: Entity) -> dict:
        return {
            "id": entity.id,
            "project_id": entity.project_id,
            "entity_type": entity.entity_type.value if isinstance(entity.entity_type, EntityType) else entity.entity_type,
            "name": entity.name,
            "description": entity.description,
            "metadata": entity.metadata,
            "source": entity.source.value if isinstance(entity.source, SourceType) else entity.source,
            "source_ref": entity.source_ref,
            "created_at": entity.created_at,
            "updated_at": entity.updated_at,
        }

    @staticmethod
    def _relation_to_dict(relation: Relation) -> dict:
        return {
            "id": relation.id,
            "project_id": relation.project_id,
            "source_entity_id": relation.source_entity_id,
            "target_entity_id": relation.target_entity_id,
            "relation_type": relation.relation_type.value if isinstance(relation.relation_type, RelationType) else relation.relation_type,
            "metadata": relation.metadata,
            "confidence": relation.confidence,
            "created_at": relation.created_at,
        }
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/tests/test_context_engine.py apps/backend/src/context_engine.py
git commit -m "feat: context engine — relation CRUD + full graph query"
```

---

## Task 3: Context Engine — Source Connections, Snapshots + Diff

**Files:**
- Modify: `apps/backend/tests/test_context_engine.py`
- Modify: `apps/backend/src/context_engine.py`

**Context:** Source connections represent external data sources (GitHub repo, KiCad project). When synced, a snapshot is taken. Diffing two snapshots produces ChangeEvents that record what was added/modified/removed. This is the backbone of Demo A (Change Propagation).

A snapshot's `data` field is a dict with key = entity name, value = dict of properties. Diffing compares keys (added/removed) and property values (modified).

- [ ] **Step 1: Write failing tests for source connections and snapshot diff**

Append to `apps/backend/tests/test_context_engine.py`:

```python
class TestSourceConnections:
    def test_create_source(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(
            source_type=SourceType.KICAD,
            name="Motor Controller PCB",
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
        snap_old = engine.create_snapshot(src.id, {
            "DRV8825": {"type": "electrical_part"},
        })
        snap_new = engine.create_snapshot(src.id, {
            "DRV8825": {"type": "electrical_part"},
            "TMC2209": {"type": "electrical_part"},
        })
        changes = engine.diff_snapshots(snap_old.id, snap_new.id)
        added = [c for c in changes if c.change_type == ChangeType.ADDED]
        assert len(added) == 1
        assert added[0].entity_name == "TMC2209"

    def test_diff_detects_removed(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        snap_old = engine.create_snapshot(src.id, {
            "DRV8825": {"type": "electrical_part"},
            "NEMA17": {"type": "mechanical_part"},
        })
        snap_new = engine.create_snapshot(src.id, {
            "NEMA17": {"type": "mechanical_part"},
        })
        changes = engine.diff_snapshots(snap_old.id, snap_new.id)
        removed = [c for c in changes if c.change_type == ChangeType.REMOVED]
        assert len(removed) == 1
        assert removed[0].entity_name == "DRV8825"

    def test_diff_detects_modified(self, project_id):
        from apps.backend.src.context_engine import ContextEngine
        engine = ContextEngine(project_id)
        src = engine.create_source(SourceConnection(source_type=SourceType.KICAD, name="PCB"))
        snap_old = engine.create_snapshot(src.id, {
            "DRV8825": {"type": "electrical_part", "voltage": "8.2-45V"},
        })
        snap_new = engine.create_snapshot(src.id, {
            "DRV8825": {"type": "electrical_part", "voltage": "4.75-29V"},
        })
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
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py::TestSourceConnections -v 2>&1 | head -15`
Expected: FAIL — `AttributeError: 'ContextEngine' object has no attribute 'create_source'`

- [ ] **Step 3: Implement source connections, snapshots, and diff**

Add to `apps/backend/src/context_engine.py` inside the `ContextEngine` class:

```python
    # ── Source Connections ──

    def create_source(self, source: SourceConnection) -> SourceConnection:
        source.project_id = self.project_id
        if not source.id:
            source.id = _uid()
        conn = get_connection()
        conn.execute(
            "INSERT INTO source_connections (id, project_id, source_type, name, config, last_synced_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (source.id, source.project_id,
             source.source_type.value if isinstance(source.source_type, SourceType) else source.source_type,
             source.name, json.dumps(source.config), source.last_synced_at, source.status),
        )
        conn.commit()
        conn.close()
        return source

    def list_sources(self) -> list[SourceConnection]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM source_connections WHERE project_id = ?", (self.project_id,)).fetchall()
        conn.close()
        return [SourceConnection(
            id=r["id"], project_id=r["project_id"],
            source_type=SourceType(r["source_type"]),
            name=r["name"], config=json.loads(r["config"]) if r["config"] else {},
            last_synced_at=r["last_synced_at"], status=r["status"],
        ) for r in rows]

    def get_source(self, source_id: str) -> Optional[SourceConnection]:
        conn = get_connection()
        row = conn.execute("SELECT * FROM source_connections WHERE id = ? AND project_id = ?",
                           (source_id, self.project_id)).fetchone()
        conn.close()
        if not row:
            return None
        return SourceConnection(
            id=row["id"], project_id=row["project_id"],
            source_type=SourceType(row["source_type"]),
            name=row["name"], config=json.loads(row["config"]) if row["config"] else {},
            last_synced_at=row["last_synced_at"], status=row["status"],
        )

    # ── Snapshots + Diff ──

    def create_snapshot(self, source_connection_id: str, data: dict) -> Snapshot:
        snap = Snapshot(
            source_connection_id=source_connection_id,
            project_id=self.project_id,
            data=data,
        )
        conn = get_connection()
        conn.execute(
            "INSERT INTO snapshots (id, source_connection_id, project_id, data, created_at) VALUES (?, ?, ?, ?, ?)",
            (snap.id, snap.source_connection_id, snap.project_id, json.dumps(snap.data), snap.created_at),
        )
        # Update source connection last_synced_at
        conn.execute(
            "UPDATE source_connections SET last_synced_at = ?, status = 'connected' WHERE id = ?",
            (snap.created_at, source_connection_id),
        )
        conn.commit()
        conn.close()
        return snap

    def _get_snapshot(self, snapshot_id: str) -> Optional[Snapshot]:
        conn = get_connection()
        row = conn.execute("SELECT * FROM snapshots WHERE id = ? AND project_id = ?",
                           (snapshot_id, self.project_id)).fetchone()
        conn.close()
        if not row:
            return None
        return Snapshot(
            id=row["id"], source_connection_id=row["source_connection_id"],
            project_id=row["project_id"], data=json.loads(row["data"]) if row["data"] else {},
            created_at=row["created_at"],
        )

    def get_latest_snapshot_id(self, source_connection_id: str) -> Optional[str]:
        """Get the most recent snapshot ID for a source connection."""
        conn = get_connection()
        row = conn.execute(
            "SELECT id FROM snapshots WHERE source_connection_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1",
            (source_connection_id, self.project_id),
        ).fetchone()
        conn.close()
        return row["id"] if row else None

    def diff_snapshots(self, old_snapshot_id: str, new_snapshot_id: str) -> list[ChangeEvent]:
        old_snap = self._get_snapshot(old_snapshot_id)
        new_snap = self._get_snapshot(new_snapshot_id)
        if not old_snap or not new_snap:
            missing = []
            if not old_snap:
                missing.append(f"old={old_snapshot_id}")
            if not new_snap:
                missing.append(f"new={new_snapshot_id}")
            raise ValueError(f"Snapshot(s) not found: {', '.join(missing)}")

        old_data = old_snap.data
        new_data = new_snap.data
        changes: list[ChangeEvent] = []

        old_keys = set(old_data.keys())
        new_keys = set(new_data.keys())

        # Added
        for key in new_keys - old_keys:
            changes.append(ChangeEvent(
                project_id=self.project_id,
                source_connection_id=new_snap.source_connection_id,
                change_type=ChangeType.ADDED,
                entity_name=key,
                description=f"Added: {key}",
                diff_data={"new": new_data[key]},
            ))

        # Removed
        for key in old_keys - new_keys:
            changes.append(ChangeEvent(
                project_id=self.project_id,
                source_connection_id=old_snap.source_connection_id,
                change_type=ChangeType.REMOVED,
                entity_name=key,
                description=f"Removed: {key}",
                diff_data={"old": old_data[key]},
            ))

        # Modified
        for key in old_keys & new_keys:
            if old_data[key] != new_data[key]:
                diff = {}
                all_props = set(list(old_data[key].keys()) + list(new_data[key].keys()))
                for prop in all_props:
                    old_val = old_data[key].get(prop)
                    new_val = new_data[key].get(prop)
                    if old_val != new_val:
                        diff[prop] = {"old": old_val, "new": new_val}
                changes.append(ChangeEvent(
                    project_id=self.project_id,
                    source_connection_id=new_snap.source_connection_id,
                    change_type=ChangeType.MODIFIED,
                    entity_name=key,
                    description=f"Modified: {key}",
                    diff_data=diff,
                ))

        # Save all changes in a single transaction
        self._save_changes(changes)
        return changes

    def _save_changes(self, changes: list[ChangeEvent]):
        """Save multiple change events in a single transaction."""
        if not changes:
            return
        conn = get_connection()
        try:
            for change in changes:
                conn.execute(
                    """INSERT INTO change_events (id, project_id, source_connection_id, change_type, entity_id, entity_name, description, diff_data, impacted_entity_ids, created_at, acknowledged)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (change.id, change.project_id, change.source_connection_id,
                     change.change_type.value if isinstance(change.change_type, ChangeType) else change.change_type,
                     change.entity_id, change.entity_name, change.description,
                     json.dumps(change.diff_data), json.dumps(change.impacted_entity_ids),
                     change.created_at, int(change.acknowledged)),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def list_changes(self) -> list[ChangeEvent]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM change_events WHERE project_id = ? ORDER BY created_at DESC",
            (self.project_id,),
        ).fetchall()
        conn.close()
        return [ChangeEvent(
            id=r["id"], project_id=r["project_id"], source_connection_id=r["source_connection_id"],
            change_type=ChangeType(r["change_type"]),
            entity_id=r["entity_id"] or "", entity_name=r["entity_name"] or "",
            description=r["description"] or "",
            diff_data=json.loads(r["diff_data"]) if r["diff_data"] else {},
            impacted_entity_ids=json.loads(r["impacted_entity_ids"]) if r["impacted_entity_ids"] else [],
            created_at=r["created_at"], acknowledged=bool(r["acknowledged"]),
        ) for r in rows]
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/tests/test_context_engine.py apps/backend/src/context_engine.py
git commit -m "feat: context engine — source connections, snapshots, and diff"
```

---

## Task 4: Context Engine — BFS Impact Analysis + Subgraph Retrieval

**Files:**
- Modify: `apps/backend/tests/test_context_engine.py`
- Modify: `apps/backend/src/context_engine.py`

**Context:** Impact analysis is the "wow moment" of Demo A. Given an entity, BFS traverses the graph via relations to find all impacted entities within a depth limit. Subgraph retrieval returns a localized view of the graph around a given entity. Both traverse the relation edges bidirectionally.

- [ ] **Step 1: Write failing tests for impact analysis and subgraph**

Append to `apps/backend/tests/test_context_engine.py`:

```python
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
        # Should find e2, e3, e4 — everything downstream of DRV8825
        assert e2.id in impacted_ids
        assert e3.id in impacted_ids
        assert e4.id in impacted_ids
        # Should NOT include the starting entity itself
        assert e1.id not in impacted_ids

    def test_impact_depth_limit(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        impacted = engine.impact_analysis(e1.id, depth=1)
        impacted_ids = {e.id for e in impacted}
        # Depth 1: only direct neighbor
        assert e2.id in impacted_ids
        assert e3.id not in impacted_ids

    def test_impact_from_middle(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        impacted = engine.impact_analysis(e2.id, depth=3)
        impacted_ids = {e.id for e in impacted}
        # BFS is bidirectional: should find e1 (via reverse edge) AND e3, e4 (forward)
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
        # e2 itself + e1 (neighbor) + e3 (neighbor)
        assert e2.id in entity_ids
        assert e1.id in entity_ids
        assert e3.id in entity_ids
        assert e4.id not in entity_ids

    def test_subgraph_includes_relevant_relations(self, project_id):
        engine, e1, e2, e3, e4 = self._build_chain(project_id)
        sub = engine.get_subgraph(e2.id, depth=1)
        # Should include edges connecting the subgraph entities
        assert len(sub["relations"]) == 2  # e1->e2, e2->e3
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py::TestImpactAnalysis -v 2>&1 | head -15`
Expected: FAIL — `AttributeError: 'ContextEngine' object has no attribute 'impact_analysis'`

- [ ] **Step 3: Implement BFS impact analysis + subgraph retrieval**

Add to `apps/backend/src/context_engine.py` inside the `ContextEngine` class:

```python
    # ── Impact Analysis (BFS) ──

    def _build_adjacency(self) -> dict[str, set[str]]:
        """Build a bidirectional adjacency list from all relations in this project."""
        adj: dict[str, set[str]] = {}
        conn = get_connection()
        rows = conn.execute(
            "SELECT source_entity_id, target_entity_id FROM relations WHERE project_id = ?",
            (self.project_id,),
        ).fetchall()
        conn.close()
        for row in rows:
            src, tgt = row["source_entity_id"], row["target_entity_id"]
            adj.setdefault(src, set()).add(tgt)
            adj.setdefault(tgt, set()).add(src)
        return adj

    def impact_analysis(self, entity_id: str, depth: int = 3) -> list[Entity]:
        """BFS from entity_id up to `depth` hops. Returns all impacted entities (excludes the starting entity)."""
        adj = self._build_adjacency()
        visited: set[str] = set()
        queue: deque[tuple[str, int]] = deque([(entity_id, 0)])
        visited.add(entity_id)

        while queue:
            current_id, current_depth = queue.popleft()
            if current_depth >= depth:
                continue
            for neighbor_id in adj.get(current_id, set()):
                if neighbor_id not in visited:
                    visited.add(neighbor_id)
                    queue.append((neighbor_id, current_depth + 1))

        # Remove starting entity from results
        visited.discard(entity_id)
        return [e for e in self.list_entities() if e.id in visited]

    # ── Subgraph Retrieval ──

    def get_subgraph(self, entity_id: str, depth: int = 2) -> dict:
        """Get a localized subgraph centered on entity_id within `depth` hops."""
        adj = self._build_adjacency()
        visited: set[str] = set()
        queue: deque[tuple[str, int]] = deque([(entity_id, 0)])
        visited.add(entity_id)

        while queue:
            current_id, current_depth = queue.popleft()
            if current_depth >= depth:
                continue
            for neighbor_id in adj.get(current_id, set()):
                if neighbor_id not in visited:
                    visited.add(neighbor_id)
                    queue.append((neighbor_id, current_depth + 1))

        # Get the entities in the subgraph
        entities = [e for e in self.list_entities() if e.id in visited]
        # Get relations where BOTH endpoints are in the subgraph
        all_relations = self.list_relations()
        relations = [r for r in all_relations
                     if r.source_entity_id in visited and r.target_entity_id in visited]

        return {
            "entities": [self._entity_to_dict(e) for e in entities],
            "relations": [self._relation_to_dict(r) for r in relations],
        }
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_context_engine.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/tests/test_context_engine.py apps/backend/src/context_engine.py
git commit -m "feat: context engine — BFS impact analysis + subgraph retrieval"
```

---

## Task 5: KiCad Connector

**Files:**
- Create: `apps/backend/tests/test_kicad_connector.py`
- Create: `apps/backend/tests/fixtures/` (test fixture files)
- Create: `apps/backend/src/connectors/kicad_connector.py`

**Context:** KiCad files use S-expression format (nested parentheses). The connector needs to parse `.kicad_sch` (schematic) and `.kicad_pcb` (PCB layout) files. For the hackathon, we parse the S-expressions with a simple recursive parser (no external deps). We extract components (with reference designator, value, footprint) and nets, and return them as Entity objects. The connector does NOT write to the database — it returns parsed data that routes_core.py feeds into the context engine.

KiCad S-expression format looks like:
```
(kicad_sch (version 20211014)
  (symbol (lib_id "Device:R") (at 100 50 0)
    (property "Reference" "R1" ...)
    (property "Value" "10k" ...)
    (property "Footprint" "Resistor_SMD:R_0402" ...)))
```

- [ ] **Step 1: Create test fixture — minimal KiCad schematic**

Create `apps/backend/tests/fixtures/test_motor.kicad_sch`:

```
(kicad_sch (version 20211014) (generator eeschema)
  (lib_symbols
    (symbol "Device:R" (pin_names (offset 0)) (in_bom yes) (on_board yes))
    (symbol "Motor_Driver:DRV8825" (pin_names (offset 1.016)) (in_bom yes) (on_board yes))
  )
  (symbol (lib_id "Motor_Driver:DRV8825") (at 152.4 88.9 0) (unit 1)
    (property "Reference" "U1" (at 152.4 60.96 0))
    (property "Value" "DRV8825" (at 152.4 63.5 0))
    (property "Footprint" "Package_SO:HTSSOP-28-1EP_4.4x9.7mm_P0.65mm_EP3.4x9.5mm" (at 152.4 88.9 0))
  )
  (symbol (lib_id "Device:R") (at 140 100 0) (unit 1)
    (property "Reference" "R1" (at 140 97 0))
    (property "Value" "10k" (at 140 103 0))
    (property "Footprint" "Resistor_SMD:R_0402_1005Metric" (at 140 100 0))
  )
  (symbol (lib_id "Device:R") (at 160 100 0) (unit 1)
    (property "Reference" "R2" (at 160 97 0))
    (property "Value" "4.7k" (at 160 103 0))
    (property "Footprint" "Resistor_SMD:R_0402_1005Metric" (at 160 100 0))
  )
  (wire (pts (xy 140 90) (xy 152.4 90)))
  (wire (pts (xy 160 90) (xy 152.4 90)))
)
```

- [ ] **Step 2: Create test fixture — minimal KiCad PCB**

Create `apps/backend/tests/fixtures/test_motor.kicad_pcb`:

```
(kicad_pcb (version 20211014) (generator pcbnew)
  (net 0 "")
  (net 1 "VCC")
  (net 2 "GND")
  (net 3 "MOTOR_L")
  (footprint "Package_SO:HTSSOP-28" (layer "F.Cu") (at 100 80)
    (property "Reference" "U1")
    (property "Value" "DRV8825")
    (pad "1" smd rect (at -3.575 -4.225) (size 0.45 1.5) (layers "F.Cu") (net 1 "VCC"))
    (pad "2" smd rect (at -3.575 -3.575) (size 0.45 1.5) (layers "F.Cu") (net 3 "MOTOR_L"))
  )
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (at 90 80)
    (property "Reference" "R1")
    (property "Value" "10k")
    (pad "1" smd rect (at -0.48 0) (size 0.56 0.62) (layers "F.Cu") (net 1 "VCC"))
    (pad "2" smd rect (at 0.48 0) (size 0.56 0.62) (layers "F.Cu") (net 2 "GND"))
  )
)
```

- [ ] **Step 3: Write failing tests for KiCad connector**

Create `apps/backend/tests/test_kicad_connector.py`:

```python
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
        assert "U1" in names  # DRV8825
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
        # Returns a dict suitable for ContextEngine.create_snapshot()
        assert "U1" in snapshot
        assert "R1" in snapshot
        assert "VCC" in snapshot  # nets too
        assert snapshot["U1"]["type"] == "electrical_part"

    def test_sync_schematic_only(self):
        from apps.backend.src.connectors.kicad_connector import KiCadConnector
        sch_path = os.path.join(FIXTURES, "test_motor.kicad_sch")
        snapshot = KiCadConnector.sync(schematic_path=sch_path)
        assert "U1" in snapshot
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_kicad_connector.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError` or `ImportError`

- [ ] **Step 5: Implement KiCad connector**

Create `apps/backend/src/connectors/kicad_connector.py`:

```python
"""
KiCad Connector — Parse .kicad_sch and .kicad_pcb S-expression files.

Extracts components (with reference, value, footprint) and nets.
Returns data in a format suitable for ContextEngine.create_snapshot().
No external dependencies — pure Python S-expression parser.
"""

import re
from typing import Optional

from packages.shared_types.src.models import EntityType


def _tokenize(text: str) -> list[str]:
    """Tokenize S-expression text into a list of tokens."""
    # Replace parens with spaced parens, then split
    text = text.replace("(", " ( ").replace(")", " ) ")
    tokens = []
    i = 0
    chars = list(text)
    while i < len(chars):
        if chars[i] in (" ", "\t", "\n", "\r"):
            i += 1
        elif chars[i] == "(":
            tokens.append("(")
            i += 1
        elif chars[i] == ")":
            tokens.append(")")
            i += 1
        elif chars[i] == '"':
            # Quoted string
            j = i + 1
            while j < len(chars) and chars[j] != '"':
                if chars[j] == "\\":
                    j += 1  # skip escaped char
                j += 1
            tokens.append("".join(chars[i : j + 1]))
            i = j + 1
        else:
            # Unquoted token
            j = i
            while j < len(chars) and chars[j] not in (" ", "\t", "\n", "\r", "(", ")"):
                j += 1
            tokens.append("".join(chars[i:j]))
            i = j
    return tokens


def _parse_sexpr(tokens: list[str], pos: int = 0):
    """Parse S-expression tokens into nested lists. Returns (parsed, next_pos)."""
    if pos >= len(tokens):
        return None, pos
    if tokens[pos] == "(":
        result = []
        pos += 1
        while pos < len(tokens) and tokens[pos] != ")":
            item, pos = _parse_sexpr(tokens, pos)
            if item is not None:
                result.append(item)
        pos += 1  # skip closing )
        return result, pos
    else:
        token = tokens[pos]
        # Strip quotes from strings
        if token.startswith('"') and token.endswith('"'):
            token = token[1:-1]
        return token, pos + 1


def _find_nodes(tree, tag: str) -> list:
    """Recursively find all S-expression nodes with given tag name.
    Stops recursion into children of matched nodes to avoid duplicates
    (e.g., multi-unit KiCad symbols with nested symbol children).
    """
    results = []
    if isinstance(tree, list) and len(tree) > 0:
        if tree[0] == tag:
            results.append(tree)
            return results  # Don't recurse into matched node's children
        for item in tree:
            results.extend(_find_nodes(item, tag))
    return results


def _get_property(node: list, prop_name: str) -> Optional[str]:
    """Get a property value from a KiCad S-expression node."""
    for item in node:
        if isinstance(item, list) and len(item) >= 3:
            if item[0] == "property" and item[1] == prop_name:
                return item[2]
    return None


def _classify_component(reference: str) -> EntityType:
    """Classify a component by its reference designator prefix."""
    prefix = re.match(r"[A-Z]+", reference)
    if not prefix:
        return EntityType.ELECTRICAL_PART
    p = prefix.group()
    # IC / Microcontroller
    if p in ("U", "IC"):
        return EntityType.ELECTRICAL_PART
    # Resistor, Capacitor, Inductor — passive
    if p in ("R", "C", "L"):
        return EntityType.ELECTRICAL_PART
    # Connector, switch, etc.
    if p in ("J", "SW", "S"):
        return EntityType.INTERFACE
    # Mechanical
    if p in ("M", "H"):  # H = mounting hole
        return EntityType.MECHANICAL_PART
    return EntityType.ELECTRICAL_PART


class KiCadConnector:
    """Parse KiCad files and return structured component/net data."""

    @staticmethod
    def parse_schematic(path: str) -> dict:
        """Parse a .kicad_sch file. Returns {"components": [...]}."""
        with open(path, "r") as f:
            text = f.read()
        tokens = _tokenize(text)
        tree, _ = _parse_sexpr(tokens)
        if tree is None:
            return {"components": []}

        components = []
        symbols = _find_nodes(tree, "symbol")
        for sym in symbols:
            # Skip lib_symbols definitions (they live inside a "lib_symbols" parent)
            # Real placed symbols have a "lib_id" child
            lib_id = None
            for item in sym:
                if isinstance(item, list) and len(item) >= 2 and item[0] == "lib_id":
                    lib_id = item[1]
                    break
            if not lib_id:
                continue

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
    def parse_pcb(path: str) -> dict:
        """Parse a .kicad_pcb file. Returns {"components": [...], "nets": [...]}."""
        with open(path, "r") as f:
            text = f.read()
        tokens = _tokenize(text)
        tree, _ = _parse_sexpr(tokens)
        if tree is None:
            return {"components": [], "nets": []}

        # Extract nets
        nets = []
        net_nodes = _find_nodes(tree, "net")
        seen_nets = set()
        for net_node in net_nodes:
            # Top-level net declarations: (net <number> <name>)
            if len(net_node) >= 3 and isinstance(net_node[1], str) and net_node[1].isdigit():
                name = net_node[2]
                if name and name not in seen_nets and name != "":
                    nets.append({"name": name, "number": int(net_node[1])})
                    seen_nets.add(name)

        # Extract footprints (placed components)
        components = []
        footprints = _find_nodes(tree, "footprint")
        for fp in footprints:
            ref = _get_property(fp, "Reference") or ""
            value = _get_property(fp, "Value") or ""
            if not ref:
                continue

            # Find connected nets from pads
            connected_nets = set()
            pads = _find_nodes(fp, "pad")
            for pad in pads:
                pad_nets = _find_nodes(pad, "net")
                for pn in pad_nets:
                    if len(pn) >= 3 and pn[2]:
                        connected_nets.add(pn[2])

            components.append({
                "name": ref,
                "value": value,
                "entity_type": _classify_component(ref),
                "connected_nets": sorted(connected_nets),
            })

        return {"components": components, "nets": nets}

    @staticmethod
    def sync(schematic_path: Optional[str] = None, pcb_path: Optional[str] = None) -> dict:
        """
        Full sync: parse schematic + PCB, return a flat dict suitable for
        ContextEngine.create_snapshot(). Keys are entity names, values are property dicts.
        """
        snapshot: dict = {}

        if schematic_path and os.path.exists(schematic_path):
            sch = KiCadConnector.parse_schematic(schematic_path)
            for comp in sch["components"]:
                snapshot[comp["name"]] = {
                    "type": comp["entity_type"].value if isinstance(comp["entity_type"], EntityType) else comp["entity_type"],
                    "value": comp["value"],
                    "footprint": comp.get("footprint", ""),
                    "lib_id": comp.get("lib_id", ""),
                    "source": "schematic",
                }

        if pcb_path and os.path.exists(pcb_path):
            pcb = KiCadConnector.parse_pcb(pcb_path)
            for comp in pcb["components"]:
                name = comp["name"]
                if name in snapshot:
                    # Merge PCB info into existing schematic entry
                    snapshot[name]["connected_nets"] = comp.get("connected_nets", [])
                    snapshot[name]["source"] = "schematic+pcb"
                else:
                    snapshot[name] = {
                        "type": comp["entity_type"].value if isinstance(comp["entity_type"], EntityType) else comp["entity_type"],
                        "value": comp.get("value", ""),
                        "connected_nets": comp.get("connected_nets", []),
                        "source": "pcb",
                    }
            # Add nets as their own entries
            for net in pcb["nets"]:
                snapshot[net["name"]] = {
                    "type": "interface",
                    "net_number": net["number"],
                    "source": "pcb",
                }

        return snapshot
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_kicad_connector.py -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/tests/test_kicad_connector.py apps/backend/tests/fixtures/ apps/backend/src/connectors/kicad_connector.py
git commit -m "feat: KiCad connector — parse .kicad_sch/.kicad_pcb, extract components and nets"
```

---

## Task 6: GitHub Connector

**Files:**
- Create: `apps/backend/tests/test_github_connector.py`
- Create: `apps/backend/src/connectors/github_connector.py`

**Context:** The GitHub connector walks a local directory (cloned repo) and classifies files as robotics-relevant entities. It looks for: ROS packages (package.xml), CAD files (.step, .stl, .kicad_*), Python/C++ source files, config files (YAML/TOML/JSON), launch files, URDF/Xacro files. It does NOT use the GitHub API — it works with local filesystem paths. Returns a snapshot dict like the KiCad connector.

- [ ] **Step 1: Write failing tests for GitHub connector**

Create `apps/backend/tests/test_github_connector.py`:

```python
"""Tests for GitHub connector — local repo file walker."""

import os

from packages.shared_types.src.models import EntityType


class TestGitHubConnector:
    def _make_repo(self, tmp_path):
        """Create a fake robotics repo structure."""
        # ROS package
        ros_pkg = tmp_path / "src" / "motor_control"
        ros_pkg.mkdir(parents=True)
        (ros_pkg / "package.xml").write_text('<package format="3"><name>motor_control</name></package>')
        (ros_pkg / "CMakeLists.txt").write_text("cmake_minimum_required(VERSION 3.5)")

        # Python source
        scripts = ros_pkg / "scripts"
        scripts.mkdir()
        (scripts / "motor_controller.py").write_text("#!/usr/bin/env python3\nimport rclpy")

        # Config
        config = ros_pkg / "config"
        config.mkdir()
        (config / "motor_params.yaml").write_text("motor:\n  max_speed: 100")

        # URDF
        urdf_dir = tmp_path / "description"
        urdf_dir.mkdir()
        (urdf_dir / "robot.urdf").write_text('<robot name="testbot"></robot>')

        # Launch file
        launch_dir = ros_pkg / "launch"
        launch_dir.mkdir()
        (launch_dir / "motor.launch.py").write_text("from launch import LaunchDescription")

        # CAD file
        cad_dir = tmp_path / "cad"
        cad_dir.mkdir()
        (cad_dir / "chassis.step").write_text("ISO-10303-21;")
        (cad_dir / "wheel.stl").write_bytes(b"solid wheel\nendsolid")

        # Non-robotics files (should be ignored or low-priority)
        (tmp_path / "README.md").write_text("# My Robot")
        (tmp_path / ".gitignore").write_text("*.pyc")

        return tmp_path

    def test_walk_finds_ros_package(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "motor_control" in names  # ROS package detected

    def test_walk_finds_python_files(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "motor_controller.py" in names

    def test_walk_finds_urdf(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "robot.urdf" in names

    def test_walk_finds_cad_files(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "chassis.step" in names
        assert "wheel.stl" in names

    def test_walk_classifies_entity_types(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        by_name = {e["name"]: e for e in result["entities"]}
        assert by_name["motor_controller.py"]["entity_type"] == EntityType.SOFTWARE_MODULE
        assert by_name["chassis.step"]["entity_type"] == EntityType.MECHANICAL_PART
        assert by_name["robot.urdf"]["entity_type"] == EntityType.DOCUMENT

    def test_sync_returns_snapshot_dict(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        snapshot = GitHubConnector.sync(str(repo))
        # Returns dict keyed by relative path, suitable for create_snapshot()
        key = "src/motor_control/scripts/motor_controller.py"
        assert key in snapshot
        assert snapshot[key]["type"] == "software_module"
        assert snapshot[key]["name"] == "motor_controller.py"

    def test_walk_finds_config_files(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "motor_params.yaml" in names
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_github_connector.py -v 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement GitHub connector**

Create `apps/backend/src/connectors/github_connector.py`:

```python
"""
GitHub Connector — Walk a local repo directory and classify robotics files.

Detects: ROS packages, Python/C++ source, URDF/Xacro, launch files,
config files (YAML/TOML/JSON), CAD files (.step, .stl), KiCad files.
Returns data in a format suitable for ContextEngine.create_snapshot().
"""

import os
from pathlib import Path
from typing import Optional

from packages.shared_types.src.models import EntityType


# File extension → entity type mapping
_EXT_MAP: dict[str, EntityType] = {
    # Software
    ".py": EntityType.SOFTWARE_MODULE,
    ".cpp": EntityType.SOFTWARE_MODULE,
    ".c": EntityType.SOFTWARE_MODULE,
    ".h": EntityType.SOFTWARE_MODULE,
    ".hpp": EntityType.SOFTWARE_MODULE,
    ".rs": EntityType.SOFTWARE_MODULE,
    # Config
    ".yaml": EntityType.DOCUMENT,
    ".yml": EntityType.DOCUMENT,
    ".toml": EntityType.DOCUMENT,
    ".json": EntityType.DOCUMENT,
    ".xml": EntityType.DOCUMENT,
    # Launch
    ".launch": EntityType.DOCUMENT,
    # Robot description
    ".urdf": EntityType.DOCUMENT,
    ".xacro": EntityType.DOCUMENT,
    ".sdf": EntityType.DOCUMENT,
    # CAD / Mechanical
    ".step": EntityType.MECHANICAL_PART,
    ".stp": EntityType.MECHANICAL_PART,
    ".stl": EntityType.MECHANICAL_PART,
    ".obj": EntityType.MECHANICAL_PART,
    ".dae": EntityType.MECHANICAL_PART,
    # Electrical / PCB
    ".kicad_sch": EntityType.ELECTRICAL_PART,
    ".kicad_pcb": EntityType.ELECTRICAL_PART,
}

# Directories to skip
_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "build", "install", "log", ".cache"}

# Files to skip
_SKIP_FILES = {".gitignore", ".gitmodules", "LICENSE", "Makefile"}


def _classify_file(path: Path) -> Optional[EntityType]:
    """Classify a file by extension. Returns None if not relevant."""
    # Handle compound extensions like .launch.py
    name = path.name
    if name.endswith(".launch.py"):
        return EntityType.DOCUMENT
    ext = path.suffix.lower()
    return _EXT_MAP.get(ext)


def _is_ros_package(dirpath: Path) -> bool:
    """Check if a directory is a ROS package (contains package.xml)."""
    return (dirpath / "package.xml").exists()


class GitHubConnector:
    """Walk a local repository and classify robotics-relevant files."""

    @staticmethod
    def walk_repo(repo_path: str) -> dict:
        """
        Walk a repo directory. Returns {"entities": [...], "ros_packages": [...]}.
        Each entity has: name, path, entity_type, metadata.
        """
        root = Path(repo_path)
        entities = []
        ros_packages = []

        for dirpath, dirnames, filenames in os.walk(root):
            dp = Path(dirpath)

            # Skip irrelevant directories
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]

            # Detect ROS packages
            if _is_ros_package(dp):
                pkg_name = dp.name
                ros_packages.append(pkg_name)
                entities.append({
                    "name": pkg_name,
                    "path": str(dp.relative_to(root)),
                    "entity_type": EntityType.SOFTWARE_MODULE,
                    "metadata": {"is_ros_package": True},
                })

            for fname in filenames:
                fpath = dp / fname
                if fname in _SKIP_FILES:
                    continue
                if fname.startswith("."):
                    continue

                entity_type = _classify_file(fpath)
                if entity_type is None:
                    continue

                rel_path = str(fpath.relative_to(root))
                entities.append({
                    "name": fname,
                    "path": rel_path,
                    "entity_type": entity_type,
                    "metadata": {
                        "relative_path": rel_path,
                        "size_bytes": fpath.stat().st_size,
                    },
                })

        return {"entities": entities, "ros_packages": ros_packages}

    @staticmethod
    def sync(repo_path: str) -> dict:
        """
        Full sync: walk repo and return a flat dict suitable for
        ContextEngine.create_snapshot(). Keys = entity names, values = property dicts.
        """
        result = GitHubConnector.walk_repo(repo_path)
        snapshot: dict = {}

        for entity in result["entities"]:
            # Use relative path as key to avoid collisions (e.g., two main.py in different dirs)
            key = entity.get("path", entity["name"])
            etype = entity["entity_type"]
            snapshot[key] = {
                "type": etype.value if isinstance(etype, EntityType) else etype,
                "name": entity["name"],
                "path": entity.get("path", ""),
                **entity.get("metadata", {}),
            }

        return snapshot
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_github_connector.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/tests/test_github_connector.py apps/backend/src/connectors/github_connector.py
git commit -m "feat: GitHub connector — walk local repo, classify robotics files"
```

---

## Task 7: Core API Routes

**Files:**
- Create: `apps/backend/tests/test_routes_core.py`
- Create: `apps/backend/src/routes_core.py`
- Modify: `apps/backend/src/main.py` (add router include)

**Context:** FastAPI APIRouter with prefix `/api`. All 14 endpoints from the API Surface doc. Uses `ContextEngine` for all data operations. The KiCad and GitHub connectors are called during the `/sync` endpoint. Request/response bodies use Pydantic models (not the shared dataclasses directly — FastAPI needs Pydantic). We define minimal Pydantic request models inline.

- [ ] **Step 1: Write failing tests for core API routes**

Create `apps/backend/tests/test_routes_core.py`:

```python
"""Integration tests for core API routes."""

import os
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(fresh_db):
    """Create a test client with fresh database."""
    # Re-import to pick up fresh DB
    from apps.backend.src.main import app
    return TestClient(app)


@pytest.fixture
def project_id(client):
    """Create a test project via API and return its ID."""
    resp = client.post("/api/projects", json={"name": "TestBot", "description": "A test robot"})
    assert resp.status_code == 200
    return resp.json()["id"]


class TestProjectRoutes:
    def test_create_project(self, client):
        resp = client.post("/api/projects", json={"name": "MyBot", "description": "Test"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "MyBot"
        assert "id" in data

    def test_list_projects(self, client):
        client.post("/api/projects", json={"name": "Bot1"})
        client.post("/api/projects", json={"name": "Bot2"})
        resp = client.get("/api/projects")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_get_project(self, client, project_id):
        resp = client.get(f"/api/projects/{project_id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "TestBot"

    def test_get_project_not_found(self, client):
        resp = client.get("/api/projects/nonexistent")
        assert resp.status_code == 404


class TestTeamRoutes:
    def test_add_team_member(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/team",
                           json={"name": "Pratham", "role": "Lead", "email": "p@test.com"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Pratham"

    def test_list_team_members(self, client, project_id):
        client.post(f"/api/projects/{project_id}/team", json={"name": "Pratham", "role": "Lead"})
        client.post(f"/api/projects/{project_id}/team", json={"name": "Alice", "role": "Dev"})
        resp = client.get(f"/api/projects/{project_id}/team")
        assert resp.status_code == 200
        assert len(resp.json()) == 2


class TestEntityRoutes:
    def test_create_entity(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/entities", json={
            "entity_type": "electrical_part",
            "name": "DRV8825",
            "description": "Motor driver",
        })
        assert resp.status_code == 200
        assert resp.json()["name"] == "DRV8825"

    def test_list_entities(self, client, project_id):
        client.post(f"/api/projects/{project_id}/entities",
                     json={"entity_type": "electrical_part", "name": "DRV8825"})
        client.post(f"/api/projects/{project_id}/entities",
                     json={"entity_type": "software_module", "name": "main.py"})
        resp = client.get(f"/api/projects/{project_id}/entities")
        assert resp.status_code == 200
        assert len(resp.json()) == 2


class TestRelationRoutes:
    def test_create_relation(self, client, project_id):
        e1 = client.post(f"/api/projects/{project_id}/entities",
                          json={"entity_type": "electrical_part", "name": "DRV8825"}).json()
        e2 = client.post(f"/api/projects/{project_id}/entities",
                          json={"entity_type": "software_module", "name": "motor_ctrl"}).json()
        resp = client.post(f"/api/projects/{project_id}/relations", json={
            "source_entity_id": e1["id"],
            "target_entity_id": e2["id"],
            "relation_type": "drives",
        })
        assert resp.status_code == 200
        assert resp.json()["relation_type"] == "drives"


class TestGraphRoutes:
    def test_get_full_graph(self, client, project_id):
        client.post(f"/api/projects/{project_id}/entities",
                     json={"entity_type": "electrical_part", "name": "DRV8825"})
        resp = client.get(f"/api/projects/{project_id}/graph")
        assert resp.status_code == 200
        assert "entities" in resp.json()
        assert "relations" in resp.json()


class TestImpactRoute:
    def test_impact_analysis(self, client, project_id):
        e1 = client.post(f"/api/projects/{project_id}/entities",
                          json={"entity_type": "electrical_part", "name": "DRV8825"}).json()
        e2 = client.post(f"/api/projects/{project_id}/entities",
                          json={"entity_type": "software_module", "name": "motor_ctrl"}).json()
        client.post(f"/api/projects/{project_id}/relations", json={
            "source_entity_id": e1["id"],
            "target_entity_id": e2["id"],
            "relation_type": "drives",
        })
        resp = client.get(f"/api/projects/{project_id}/impact/{e1['id']}")
        assert resp.status_code == 200
        impacted = resp.json()
        assert len(impacted) == 1
        assert impacted[0]["name"] == "motor_ctrl"


class TestSourceRoutes:
    def test_add_source(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/sources", json={
            "source_type": "kicad",
            "name": "Motor PCB",
            "config": {"schematic_path": "/path/to/file.kicad_sch"},
        })
        assert resp.status_code == 200
        assert resp.json()["name"] == "Motor PCB"

    def test_list_sources(self, client, project_id):
        client.post(f"/api/projects/{project_id}/sources",
                     json={"source_type": "kicad", "name": "PCB"})
        client.post(f"/api/projects/{project_id}/sources",
                     json={"source_type": "github", "name": "Repo"})
        resp = client.get(f"/api/projects/{project_id}/sources")
        assert resp.status_code == 200
        assert len(resp.json()) == 2


class TestChangesRoute:
    def test_list_changes_empty(self, client, project_id):
        resp = client.get(f"/api/projects/{project_id}/changes")
        assert resp.status_code == 200
        assert resp.json() == []


class TestSyncRoute:
    def test_sync_kicad_source(self, client, project_id):
        import os
        fixtures = os.path.join(os.path.dirname(__file__), "fixtures")
        sch_path = os.path.join(fixtures, "test_motor.kicad_sch")
        # Create a KiCad source pointing to test fixtures
        src = client.post(f"/api/projects/{project_id}/sources", json={
            "source_type": "kicad",
            "name": "Test PCB",
            "config": {"schematic_path": sch_path},
        }).json()
        # Sync it
        resp = client.post(f"/api/projects/{project_id}/sources/{src['id']}/sync")
        assert resp.status_code == 200
        data = resp.json()
        assert data["entity_count"] > 0
        assert "snapshot_id" in data

    def test_sync_creates_changes_on_second_sync(self, client, project_id):
        import os
        fixtures = os.path.join(os.path.dirname(__file__), "fixtures")
        sch_path = os.path.join(fixtures, "test_motor.kicad_sch")
        src = client.post(f"/api/projects/{project_id}/sources", json={
            "source_type": "kicad",
            "name": "Test PCB",
            "config": {"schematic_path": sch_path},
        }).json()
        # First sync — baseline
        client.post(f"/api/projects/{project_id}/sources/{src['id']}/sync")
        # Second sync — same data, no changes expected
        resp = client.post(f"/api/projects/{project_id}/sources/{src['id']}/sync")
        assert resp.status_code == 200
        assert resp.json()["changes"] == []

    def test_sync_nonexistent_source(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/sources/nonexistent/sync")
        assert resp.status_code == 404


class TestProjectValidation:
    def test_entity_on_nonexistent_project(self, client):
        resp = client.post("/api/projects/fake-id/entities", json={
            "entity_type": "electrical_part", "name": "Test"})
        assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_routes_core.py -v 2>&1 | head -20`
Expected: FAIL — 404 errors (routes don't exist yet)

- [ ] **Step 3: Implement routes_core.py**

Create `apps/backend/src/routes_core.py`:

```python
"""
Core API Routes — FastAPI APIRouter for all foundation endpoints.

Projects, team members, entities, relations, sources, graph, impact analysis, changes.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Optional

from packages.shared_types.src.models import (
    Entity, EntityType, Relation, RelationType,
    Project, TeamMember, SourceConnection, SourceType,
)
from .context_engine import ContextEngine
from .connectors.kicad_connector import KiCadConnector
from .connectors.github_connector import GitHubConnector

router = APIRouter(prefix="/api")


# ── Pydantic Request Models ──

class CreateProjectReq(BaseModel):
    name: str
    description: str = ""

class AddTeamMemberReq(BaseModel):
    name: str
    role: str = ""
    email: str = ""

class CreateEntityReq(BaseModel):
    entity_type: str
    name: str
    description: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    source: str = "manual"
    source_ref: str = ""

class CreateRelationReq(BaseModel):
    source_entity_id: str
    target_entity_id: str
    relation_type: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0

class AddSourceReq(BaseModel):
    source_type: str
    name: str
    config: dict[str, Any] = Field(default_factory=dict)


def _require_project(project_id: str):
    """Validate that a project exists, or raise 404."""
    p = ContextEngine.get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


# ── Project Routes ──

@router.post("/projects")
async def create_project(req: CreateProjectReq):
    p = ContextEngine.create_project(Project(name=req.name, description=req.description))
    return {"id": p.id, "name": p.name, "description": p.description,
            "created_at": p.created_at, "updated_at": p.updated_at}

@router.get("/projects")
async def list_projects():
    return [{"id": p.id, "name": p.name, "description": p.description,
             "created_at": p.created_at, "updated_at": p.updated_at}
            for p in ContextEngine.list_projects()]

@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    p = ContextEngine.get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"id": p.id, "name": p.name, "description": p.description,
            "created_at": p.created_at, "updated_at": p.updated_at}


# ── Team Routes ──

@router.post("/projects/{project_id}/team")
async def add_team_member(project_id: str, req: AddTeamMemberReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    m = engine.add_team_member(TeamMember(name=req.name, role=req.role, email=req.email))
    return {"id": m.id, "project_id": m.project_id, "name": m.name, "role": m.role, "email": m.email}

@router.get("/projects/{project_id}/team")
async def list_team_members(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    return [{"id": m.id, "project_id": m.project_id, "name": m.name, "role": m.role, "email": m.email}
            for m in engine.list_team_members()]


# ── Entity Routes ──

@router.post("/projects/{project_id}/entities")
async def create_entity(project_id: str, req: CreateEntityReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    e = engine.create_entity(Entity(
        entity_type=EntityType(req.entity_type),
        name=req.name,
        description=req.description,
        metadata=req.metadata,
        source=SourceType(req.source) if req.source else SourceType.MANUAL,
        source_ref=req.source_ref,
    ))
    return ContextEngine._entity_to_dict(e)

@router.get("/projects/{project_id}/entities")
async def list_entities(project_id: str, entity_type: Optional[str] = None):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    et = EntityType(entity_type) if entity_type else None
    return [ContextEngine._entity_to_dict(e) for e in engine.list_entities(entity_type=et)]


# ── Relation Routes ──

@router.post("/projects/{project_id}/relations")
async def create_relation(project_id: str, req: CreateRelationReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    r = engine.create_relation(Relation(
        source_entity_id=req.source_entity_id,
        target_entity_id=req.target_entity_id,
        relation_type=RelationType(req.relation_type),
        metadata=req.metadata,
        confidence=req.confidence,
    ))
    return ContextEngine._relation_to_dict(r)


# ── Graph Routes ──

@router.get("/projects/{project_id}/graph")
async def get_full_graph(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    return engine.get_full_graph()


# ── Impact Analysis ──

@router.get("/projects/{project_id}/impact/{entity_id}")
async def run_impact_analysis(project_id: str, entity_id: str, depth: int = 3):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    impacted = engine.impact_analysis(entity_id, depth=depth)
    return [ContextEngine._entity_to_dict(e) for e in impacted]


# ── Source Routes ──

@router.post("/projects/{project_id}/sources")
async def add_source(project_id: str, req: AddSourceReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    src = engine.create_source(SourceConnection(
        source_type=SourceType(req.source_type),
        name=req.name,
        config=req.config,
    ))
    return {"id": src.id, "project_id": src.project_id,
            "source_type": src.source_type.value if isinstance(src.source_type, SourceType) else src.source_type,
            "name": src.name, "config": src.config,
            "last_synced_at": src.last_synced_at, "status": src.status}

@router.get("/projects/{project_id}/sources")
async def list_sources(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    return [{"id": s.id, "project_id": s.project_id,
             "source_type": s.source_type.value if isinstance(s.source_type, SourceType) else s.source_type,
             "name": s.name, "config": s.config,
             "last_synced_at": s.last_synced_at, "status": s.status}
            for s in engine.list_sources()]


# ── Sync Route ──

@router.post("/projects/{project_id}/sources/{source_id}/sync")
async def sync_source(project_id: str, source_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    source = engine.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    # Get the latest snapshot for diffing (via engine, not raw DB)
    prev_snapshot_id = engine.get_latest_snapshot_id(source_id)

    # Run the appropriate connector
    snapshot_data = {}
    source_type = source.source_type.value if isinstance(source.source_type, SourceType) else source.source_type

    if source_type == "kicad":
        snapshot_data = KiCadConnector.sync(
            schematic_path=source.config.get("schematic_path"),
            pcb_path=source.config.get("pcb_path"),
        )
    elif source_type == "github":
        repo_path = source.config.get("repo_path", "")
        if repo_path:
            snapshot_data = GitHubConnector.sync(repo_path)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported source type: {source_type}")

    # Create new snapshot
    new_snap = engine.create_snapshot(source_id, snapshot_data)

    # Diff against previous snapshot if one exists
    changes = []
    if prev_snapshot_id:
        change_events = engine.diff_snapshots(prev_snapshot_id, new_snap.id)
        changes = [{"id": c.id, "change_type": c.change_type.value if hasattr(c.change_type, 'value') else c.change_type,
                     "entity_name": c.entity_name, "description": c.description,
                     "diff_data": c.diff_data} for c in change_events]

    return {
        "snapshot_id": new_snap.id,
        "entity_count": len(snapshot_data),
        "changes": changes,
    }


# ── Changes Route ──

@router.get("/projects/{project_id}/changes")
async def list_changes(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    return [{"id": c.id, "change_type": c.change_type.value if hasattr(c.change_type, 'value') else c.change_type,
             "entity_name": c.entity_name, "description": c.description,
             "diff_data": c.diff_data, "created_at": c.created_at,
             "acknowledged": c.acknowledged}
            for c in engine.list_changes()]
```

- [ ] **Step 4: Wire router into main.py**

Add to `apps/backend/src/main.py` after the CORS middleware block:

```python
# Core routes (Pratham) — wired here for development; Teammate 3 will own final wiring
try:
    from .routes_core import router as core_router
    app.include_router(core_router)
except ImportError:
    pass
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_routes_core.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes_core.py apps/backend/src/main.py apps/backend/tests/test_routes_core.py
git commit -m "feat: core API routes — all 14 endpoints with FastAPI APIRouter"
```

---

## Task 8: WorkspaceTab.tsx

**Files:**
- Create: `apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx`

**Context:** The WorkspaceTab is the "home base" of Solus. It shows: (1) a project selector dropdown, (2) a list of connected sources with sync buttons, (3) a timeline of recent changes. It calls the core API endpoints. Since Teammate 3 hasn't built the Zustand store or shared hooks yet, this component uses local state and direct fetch calls. Teammate 3 will refactor to use the store later.

Uses Tailwind CSS v4 with the solus-* color tokens (dark theme). Font: Inter for UI, JetBrains Mono for data.

- [ ] **Step 1: Create the workspace directory**

Run: `mkdir -p /Users/bentontameling/VentureHacksSolus/apps/desktop/src/renderer/components/workspace`

- [ ] **Step 2: Implement WorkspaceTab.tsx**

Create `apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx`:

```tsx
import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface Source {
  id: string;
  source_type: string;
  name: string;
  config: Record<string, string>;
  last_synced_at: string | null;
  status: string;
}

interface ChangeEvent {
  id: string;
  change_type: "added" | "modified" | "removed";
  entity_name: string;
  description: string;
  diff_data: Record<string, unknown>;
  created_at: string;
  acknowledged: boolean;
}

interface SyncResult {
  snapshot_id: string;
  entity_count: number;
  changes: ChangeEvent[];
}

export default function WorkspaceTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [sources, setSources] = useState<Source[]>([]);
  const [changes, setChanges] = useState<ChangeEvent[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeFetch = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  };

  // Load projects on mount
  useEffect(() => {
    safeFetch(`${API}/projects`)
      .then((data) => {
        setProjects(data);
        if (data.length > 0 && !selectedProjectId) {
          setSelectedProjectId(data[0].id);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  // Load sources + changes when project changes
  useEffect(() => {
    if (!selectedProjectId) return;
    safeFetch(`${API}/projects/${selectedProjectId}/sources`)
      .then(setSources)
      .catch((e) => setError(e.message));

    safeFetch(`${API}/projects/${selectedProjectId}/changes`)
      .then(setChanges)
      .catch((e) => setError(e.message));
  }, [selectedProjectId]);

  const handleSync = useCallback(
    async (sourceId: string) => {
      setSyncing(sourceId);
      setError(null);
      try {
        const resp = await fetch(
          `${API}/projects/${selectedProjectId}/sources/${sourceId}/sync`,
          { method: "POST" }
        );
        if (!resp.ok) throw new Error(await resp.text());
        const result: SyncResult = await resp.json();

        // Refresh sources and changes
        const srcResp = await fetch(
          `${API}/projects/${selectedProjectId}/sources`
        );
        setSources(await srcResp.json());

        const chgResp = await fetch(
          `${API}/projects/${selectedProjectId}/changes`
        );
        setChanges(await chgResp.json());
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncing(null);
      }
    },
    [selectedProjectId]
  );

  const changeTypeColor: Record<string, string> = {
    added: "text-green-400",
    modified: "text-yellow-400",
    removed: "text-red-400",
  };

  const changeTypeIcon: Record<string, string> = {
    added: "+",
    modified: "~",
    removed: "-",
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 p-4 gap-4 font-['Inter']">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Workspace</h2>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Sources Panel */}
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4">
        <h3 className="text-sm font-medium text-neutral-400 mb-3">
          Connected Sources
        </h3>
        {sources.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No sources connected yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {sources.map((src) => (
              <div
                key={src.id}
                className="flex items-center justify-between bg-neutral-850 rounded px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      src.status === "connected"
                        ? "bg-green-400"
                        : "bg-neutral-500"
                    }`}
                  />
                  <div>
                    <span className="text-sm font-medium">{src.name}</span>
                    <span className="text-xs text-neutral-500 ml-2">
                      {src.source_type}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {src.last_synced_at && (
                    <span className="text-xs text-neutral-500 font-['JetBrains_Mono']">
                      {new Date(src.last_synced_at).toLocaleTimeString()}
                    </span>
                  )}
                  <button
                    onClick={() => handleSync(src.id)}
                    disabled={syncing === src.id}
                    className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 rounded transition-colors"
                  >
                    {syncing === src.id ? "Syncing..." : "Sync"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Changes Timeline */}
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4 flex-1 overflow-auto">
        <h3 className="text-sm font-medium text-neutral-400 mb-3">
          Recent Changes
        </h3>
        {changes.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No changes detected yet. Sync a source to see changes.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {changes.map((change) => (
              <div
                key={change.id}
                className="flex items-start gap-2 px-2 py-1.5 hover:bg-neutral-800 rounded text-sm font-['JetBrains_Mono']"
              >
                <span
                  className={`${
                    changeTypeColor[change.change_type]
                  } font-bold w-4`}
                >
                  {changeTypeIcon[change.change_type]}
                </span>
                <span className="text-neutral-200">
                  {change.entity_name}
                </span>
                <span className="text-neutral-500 text-xs ml-auto">
                  {change.change_type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx
git commit -m "feat: WorkspaceTab — project selector, sources panel, changes timeline"
```

---

## Task 9: ContextModelTab.tsx

**Files:**
- Create: `apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx`

**Context:** The ContextModelTab renders the Robotics Context Model as an interactive D3 force-directed graph. Nodes are colored by entity type (electrical = blue, software = green, mechanical = orange, interface = purple, document = gray). Edges connect related entities. Clicking a node highlights it and shows its details. An "Analyze Impact" button runs BFS impact analysis and highlights impacted nodes in red. This is the visual centerpiece for Demo A.

D3 should be imported dynamically since it may not be installed yet. The component handles the case where d3 is not available by showing a fallback table view.

- [ ] **Step 1: Create the context-model directory**

Run: `mkdir -p /Users/bentontameling/VentureHacksSolus/apps/desktop/src/renderer/components/context-model`

- [ ] **Step 2: Implement ContextModelTab.tsx**

Create `apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface GraphEntity {
  id: string;
  entity_type: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}

interface GraphRelation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
}

interface GraphData {
  entities: GraphEntity[];
  relations: GraphRelation[];
}

const TYPE_COLORS: Record<string, string> = {
  electrical_part: "#60a5fa",
  software_module: "#4ade80",
  mechanical_part: "#fb923c",
  interface: "#c084fc",
  runtime_signal: "#f472b6",
  document: "#94a3b8",
  paper: "#94a3b8",
  issue: "#f87171",
  fix: "#34d399",
  project: "#fbbf24",
  team_member: "#fbbf24",
  simulation_asset: "#22d3ee",
  external_part_candidate: "#a78bfa",
};

const IMPACT_COLOR = "#ef4444";

export default function ContextModelTab({
  projectId,
}: {
  projectId: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [graph, setGraph] = useState<GraphData>({ entities: [], relations: [] });
  const [selectedNode, setSelectedNode] = useState<GraphEntity | null>(null);
  const [impactedIds, setImpactedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load graph data
  const loadGraph = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const resp = await fetch(`${API}/projects/${projectId}/graph`);
      if (!resp.ok) throw new Error("Failed to load graph");
      const data: GraphData = await resp.json();
      setGraph(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Run impact analysis
  const runImpact = useCallback(
    async (entityId: string) => {
      try {
        const resp = await fetch(
          `${API}/projects/${projectId}/impact/${entityId}`
        );
        if (!resp.ok) throw new Error("Impact analysis failed");
        const impacted: GraphEntity[] = await resp.json();
        setImpactedIds(new Set(impacted.map((e) => e.id)));
      } catch (e: unknown) {
        setError(
          e instanceof Error ? e.message : "Impact analysis failed"
        );
      }
    },
    [projectId]
  );

  // D3 force simulation
  useEffect(() => {
    if (!svgRef.current || graph.entities.length === 0) return;

    let d3: typeof import("d3") | null = null;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    import("d3")
      .then((d3Module) => {
        if (cancelled) return;
        d3 = d3Module;
        const svg = d3.select(svgRef.current!);
        svg.selectAll("*").remove();

        const width = svgRef.current!.clientWidth;
        const height = svgRef.current!.clientHeight;

        const g = svg.append("g");

        // Zoom
        const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
        svg.call(zoom);

        // Build node/link data
        type SimNode = d3.SimulationNodeDatum & GraphEntity;
        type SimLink = d3.SimulationLinkDatum<SimNode> & GraphRelation;

        const nodes: SimNode[] = graph.entities.map((e) => ({ ...e }));
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

        const links: SimLink[] = graph.relations
          .filter(
            (r) =>
              nodeMap.has(r.source_entity_id) &&
              nodeMap.has(r.target_entity_id)
          )
          .map((r) => ({
            ...r,
            source: nodeMap.get(r.source_entity_id)!,
            target: nodeMap.get(r.target_entity_id)!,
          }));

        // Force simulation
        const simulation = d3
          .forceSimulation(nodes)
          .force(
            "link",
            d3.forceLink(links).id((d: any) => d.id).distance(80)
          )
          .force("charge", d3.forceManyBody().strength(-200))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force("collision", d3.forceCollide(20));

        // Draw links
        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .join("line")
          .attr("stroke", "#525252")
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.6);

        // Draw nodes
        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .join("circle")
          .attr("r", 8)
          .attr("fill", (d: SimNode) => {
            if (impactedIds.has(d.id)) return IMPACT_COLOR;
            return TYPE_COLORS[d.entity_type] || "#94a3b8";
          })
          .attr("stroke", "#171717")
          .attr("stroke-width", 1.5)
          .attr("cursor", "pointer")
          .on("click", (_event: MouseEvent, d: SimNode) => {
            setSelectedNode(d);
          })
          .call(
            d3
              .drag<SVGCircleElement, SimNode>()
              .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
              })
              .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
              })
              .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
              }) as any
          );

        // Labels
        const label = g
          .append("g")
          .selectAll("text")
          .data(nodes)
          .join("text")
          .text((d: SimNode) => d.name)
          .attr("font-size", "10px")
          .attr("font-family", "JetBrains Mono, monospace")
          .attr("fill", "#a3a3a3")
          .attr("dx", 12)
          .attr("dy", 4);

        simulation.on("tick", () => {
          link
            .attr("x1", (d: any) => d.source.x)
            .attr("y1", (d: any) => d.source.y)
            .attr("x2", (d: any) => d.target.x)
            .attr("y2", (d: any) => d.target.y);
          node
            .attr("cx", (d: SimNode) => d.x!)
            .attr("cy", (d: SimNode) => d.y!);
          label
            .attr("x", (d: SimNode) => d.x!)
            .attr("y", (d: SimNode) => d.y!);
        });

        cleanup = () => {
          simulation.stop();
        };
      })
      .catch(() => {
        // D3 not installed — fallback handled by the table view below
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [graph, impactedIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-neutral-950 text-neutral-400">
        Loading context model...
      </div>
    );
  }

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100 font-['Inter']">
      {/* Graph Area */}
      <div className="flex-1 relative">
        {graph.entities.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            No entities in the context model yet. Sync a source to populate the graph.
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ background: "#0a0a0a" }}
          />
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-neutral-900/90 border border-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-2 font-medium">
            Entity Types
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(TYPE_COLORS)
              .filter(([type]) =>
                graph.entities.some((e) => e.entity_type === type)
              )
              .map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-neutral-300">
                    {type.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            {impactedIds.size > 0 && (
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: IMPACT_COLOR }}
                />
                <span className="text-xs text-neutral-300">
                  impacted
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Refresh button */}
        <button
          onClick={loadGraph}
          className="absolute top-4 right-4 px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Detail Panel */}
      <div className="w-72 bg-neutral-900 border-l border-neutral-800 p-4 overflow-auto">
        {selectedNode ? (
          <div className="flex flex-col gap-3">
            <div>
              <span
                className="inline-block w-3 h-3 rounded-full mr-2"
                style={{
                  backgroundColor:
                    TYPE_COLORS[selectedNode.entity_type] || "#94a3b8",
                }}
              />
              <span className="text-sm font-medium">
                {selectedNode.name}
              </span>
            </div>
            <div className="text-xs text-neutral-400">
              {selectedNode.entity_type.replace(/_/g, " ")}
            </div>
            {selectedNode.description && (
              <p className="text-sm text-neutral-300">
                {selectedNode.description}
              </p>
            )}
            {Object.keys(selectedNode.metadata).length > 0 && (
              <div className="bg-neutral-800 rounded p-2 font-['JetBrains_Mono'] text-xs">
                {Object.entries(selectedNode.metadata).map(
                  ([key, val]) => (
                    <div key={key} className="flex justify-between py-0.5">
                      <span className="text-neutral-400">{key}</span>
                      <span className="text-neutral-200">
                        {String(val)}
                      </span>
                    </div>
                  )
                )}
              </div>
            )}
            <button
              onClick={() => runImpact(selectedNode.id)}
              className="px-3 py-2 text-sm bg-red-600 hover:bg-red-500 rounded transition-colors"
            >
              Analyze Impact
            </button>
            {impactedIds.size > 0 && (
              <div>
                <div className="text-xs text-neutral-400 mb-1">
                  {impactedIds.size} impacted entities
                </div>
                <button
                  onClick={() => setImpactedIds(new Set())}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Clear highlights
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-neutral-500">
            Click a node to see details and run impact analysis.
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx
git commit -m "feat: ContextModelTab — D3 force graph, node details, impact analysis"
```

---

## Parallelism Map

Tasks that can be dispatched to subagents in parallel:

```
Task 1 (Entity CRUD)         ──sequential──▶ Task 2 (Relations)
                              ──sequential──▶ Task 3 (Snapshots/Diff)
                              ──sequential──▶ Task 4 (Impact/Subgraph)

Task 5 (KiCad Connector)     ──parallel with──▶ Task 6 (GitHub Connector)
  (both import from shared_types only — NO dependency on Tasks 1-4)

Task 7 (Routes)               ──depends on──▶ Tasks 1-6

Task 8 (WorkspaceTab)         ──parallel with──▶ Task 9 (ContextModelTab)
  (both depend on Task 7 — they consume the API)
```

**Optimal dispatch order:**
1. Tasks 1 → 2 → 3 → 4 (sequential — each builds on the prior)
   Tasks 5 + 6 (parallel — start immediately, no dependency on Tasks 1-4)
2. Task 7 (after 1-6 all complete)
3. Tasks 8 + 9 (parallel — independent frontend tabs)
