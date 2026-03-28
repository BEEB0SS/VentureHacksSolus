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
            id=row["id"], project_id=row["project_id"],
            source_entity_id=row["source_entity_id"], target_entity_id=row["target_entity_id"],
            relation_type=RelationType(row["relation_type"]),
            metadata=json.loads(row["metadata"]) if row["metadata"] else {},
            confidence=row["confidence"], created_at=row["created_at"],
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
            "id": entity.id, "project_id": entity.project_id,
            "entity_type": entity.entity_type.value if isinstance(entity.entity_type, EntityType) else entity.entity_type,
            "name": entity.name, "description": entity.description, "metadata": entity.metadata,
            "source": entity.source.value if isinstance(entity.source, SourceType) else entity.source,
            "source_ref": entity.source_ref, "created_at": entity.created_at, "updated_at": entity.updated_at,
        }

    @staticmethod
    def _relation_to_dict(relation: Relation) -> dict:
        return {
            "id": relation.id, "project_id": relation.project_id,
            "source_entity_id": relation.source_entity_id, "target_entity_id": relation.target_entity_id,
            "relation_type": relation.relation_type.value if isinstance(relation.relation_type, RelationType) else relation.relation_type,
            "metadata": relation.metadata, "confidence": relation.confidence, "created_at": relation.created_at,
        }

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
            id=r["id"], project_id=r["project_id"], source_type=SourceType(r["source_type"]),
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
            id=row["id"], project_id=row["project_id"], source_type=SourceType(row["source_type"]),
            name=row["name"], config=json.loads(row["config"]) if row["config"] else {},
            last_synced_at=row["last_synced_at"], status=row["status"],
        )

    # ── Snapshots + Diff ──

    def create_snapshot(self, source_connection_id: str, data: dict) -> Snapshot:
        snap = Snapshot(source_connection_id=source_connection_id, project_id=self.project_id, data=data)
        conn = get_connection()
        conn.execute(
            "INSERT INTO snapshots (id, source_connection_id, project_id, data, created_at) VALUES (?, ?, ?, ?, ?)",
            (snap.id, snap.source_connection_id, snap.project_id, json.dumps(snap.data), snap.created_at),
        )
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
        return Snapshot(id=row["id"], source_connection_id=row["source_connection_id"],
                        project_id=row["project_id"], data=json.loads(row["data"]) if row["data"] else {},
                        created_at=row["created_at"])

    def get_latest_snapshot_id(self, source_connection_id: str) -> Optional[str]:
        conn = get_connection()
        row = conn.execute(
            "SELECT id FROM snapshots WHERE source_connection_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1",
            (source_connection_id, self.project_id)).fetchone()
        conn.close()
        return row["id"] if row else None

    def diff_snapshots(self, old_snapshot_id: str, new_snapshot_id: str) -> list[ChangeEvent]:
        old_snap = self._get_snapshot(old_snapshot_id)
        new_snap = self._get_snapshot(new_snapshot_id)
        if not old_snap or not new_snap:
            missing = []
            if not old_snap: missing.append(f"old={old_snapshot_id}")
            if not new_snap: missing.append(f"new={new_snapshot_id}")
            raise ValueError(f"Snapshot(s) not found: {', '.join(missing)}")

        old_data, new_data = old_snap.data, new_snap.data
        changes: list[ChangeEvent] = []
        old_keys, new_keys = set(old_data.keys()), set(new_data.keys())

        for key in new_keys - old_keys:
            changes.append(ChangeEvent(project_id=self.project_id, source_connection_id=new_snap.source_connection_id,
                change_type=ChangeType.ADDED, entity_name=key, description=f"Added: {key}", diff_data={"new": new_data[key]}))

        for key in old_keys - new_keys:
            changes.append(ChangeEvent(project_id=self.project_id, source_connection_id=old_snap.source_connection_id,
                change_type=ChangeType.REMOVED, entity_name=key, description=f"Removed: {key}", diff_data={"old": old_data[key]}))

        for key in old_keys & new_keys:
            if old_data[key] != new_data[key]:
                diff = {}
                for prop in set(list(old_data[key].keys()) + list(new_data[key].keys())):
                    old_val, new_val = old_data[key].get(prop), new_data[key].get(prop)
                    if old_val != new_val:
                        diff[prop] = {"old": old_val, "new": new_val}
                changes.append(ChangeEvent(project_id=self.project_id, source_connection_id=new_snap.source_connection_id,
                    change_type=ChangeType.MODIFIED, entity_name=key, description=f"Modified: {key}", diff_data=diff))

        self._save_changes(changes)
        return changes

    def _save_changes(self, changes: list[ChangeEvent]):
        if not changes: return
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
                     change.created_at, int(change.acknowledged)))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def list_changes(self) -> list[ChangeEvent]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM change_events WHERE project_id = ? ORDER BY created_at DESC",
                            (self.project_id,)).fetchall()
        conn.close()
        return [ChangeEvent(id=r["id"], project_id=r["project_id"], source_connection_id=r["source_connection_id"],
            change_type=ChangeType(r["change_type"]), entity_id=r["entity_id"] or "", entity_name=r["entity_name"] or "",
            description=r["description"] or "", diff_data=json.loads(r["diff_data"]) if r["diff_data"] else {},
            impacted_entity_ids=json.loads(r["impacted_entity_ids"]) if r["impacted_entity_ids"] else [],
            created_at=r["created_at"], acknowledged=bool(r["acknowledged"])) for r in rows]

    # ── Impact Analysis (BFS) ──

    def _build_adjacency(self, directed: bool = False) -> dict[str, set[str]]:
        """Build adjacency map from relations.

        If directed=True, edges only flow in the "impact" direction: from the
        entity being changed toward entities that depend on it.  The direction
        is inferred from the relation_type:

        - connected_to, drives, impacts, configured_by: src → tgt AND tgt → src
          (physical connections propagate both ways)
        - depends_on, reads_from, subscribes_to: tgt → src
          (the source depends on the target, so changing the target impacts the source)
        - publishes: src → tgt
          (publisher affects the topic/subscribers downstream)
        - documented_by, observed_in, changed_by, resolved_by, similar_to:
          src → tgt (informational link)

        When directed=False (default), all edges are bidirectional (original behaviour).
        """
        adj: dict[str, set[str]] = {}
        conn = get_connection()
        rows = conn.execute(
            "SELECT source_entity_id, target_entity_id, relation_type FROM relations WHERE project_id = ?",
            (self.project_id,),
        ).fetchall()
        conn.close()

        # Relation types where changing the *target* impacts the *source*
        # (e.g. motor_controller depends_on ESP32 — changing ESP32 impacts motor_controller)
        _REVERSE_IMPACT = {"depends_on", "reads_from", "subscribes_to"}

        for row in rows:
            src, tgt, rtype = row["source_entity_id"], row["target_entity_id"], row["relation_type"]
            if not directed:
                adj.setdefault(src, set()).add(tgt)
                adj.setdefault(tgt, set()).add(src)
            elif rtype in _REVERSE_IMPACT:
                # Changing tgt impacts src (e.g. changing ESP32 impacts motor_controller)
                adj.setdefault(tgt, set()).add(src)
            else:
                # Default: forward direction (src impacts tgt)
                adj.setdefault(src, set()).add(tgt)
        return adj

    def impact_analysis(self, entity_id: str, depth: int = 3) -> list[Entity]:
        adj = self._build_adjacency(directed=False)
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
        visited.discard(entity_id)
        return [e for e in self.list_entities() if e.id in visited]

    # ── Subgraph Retrieval ──

    def get_subgraph(self, entity_id: str, depth: int = 2) -> dict:
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
        entities = [e for e in self.list_entities() if e.id in visited]
        all_relations = self.list_relations()
        relations = [r for r in all_relations if r.source_entity_id in visited and r.target_entity_id in visited]
        return {
            "entities": [self._entity_to_dict(e) for e in entities],
            "relations": [self._relation_to_dict(r) for r in relations],
        }

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
