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
