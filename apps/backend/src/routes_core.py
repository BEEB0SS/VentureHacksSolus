"""
Solus Core API Routes — All 14 endpoints for the Robotics Context Model.

FastAPI APIRouter with prefix /api. Uses ContextEngine for data operations.
KiCad and GitHub connectors called during /sync endpoint.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .context_engine import ContextEngine
from .connectors.kicad_connector import KiCadConnector
from .connectors.github_connector import GitHubConnector

from packages.shared_types.src.models import (
    Project, TeamMember, Entity, EntityType, Relation, RelationType,
    SourceConnection, SourceType,
)

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
    name: str
    entity_type: str = "software_module"
    description: str = ""
    metadata: dict = {}
    source: str = "manual"
    source_ref: str = ""


class CreateRelationReq(BaseModel):
    source_entity_id: str
    target_entity_id: str
    relation_type: str = "connected_to"
    metadata: dict = {}
    confidence: float = 1.0


class AddSourceReq(BaseModel):
    name: str
    source_type: str = "github"
    config: dict = {}


# ── Helper ──

def _require_project(project_id: str) -> Project:
    """Check project exists or raise 404."""
    project = ContextEngine.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")
    return project


# ── Project Routes ──

@router.post("/projects")
def create_project(req: CreateProjectReq):
    project = ContextEngine.create_project(Project(name=req.name, description=req.description))
    return {"id": project.id, "name": project.name, "description": project.description,
            "created_at": project.created_at, "updated_at": project.updated_at}


@router.get("/projects")
def list_projects():
    projects = ContextEngine.list_projects()
    return [{"id": p.id, "name": p.name, "description": p.description,
             "created_at": p.created_at, "updated_at": p.updated_at} for p in projects]


@router.get("/projects/{project_id}")
def get_project(project_id: str):
    project = _require_project(project_id)
    return {"id": project.id, "name": project.name, "description": project.description,
            "created_at": project.created_at, "updated_at": project.updated_at}


# ── Team Routes ──

@router.post("/projects/{project_id}/team")
def add_team_member(project_id: str, req: AddTeamMemberReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    member = engine.add_team_member(TeamMember(name=req.name, role=req.role, email=req.email))
    return {"id": member.id, "project_id": member.project_id, "name": member.name,
            "role": member.role, "email": member.email}


@router.get("/projects/{project_id}/team")
def list_team_members(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    members = engine.list_team_members()
    return [{"id": m.id, "project_id": m.project_id, "name": m.name,
             "role": m.role, "email": m.email} for m in members]


# ── Entity Routes ──

@router.post("/projects/{project_id}/entities")
def create_entity(project_id: str, req: CreateEntityReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    entity = engine.create_entity(Entity(
        name=req.name,
        entity_type=EntityType(req.entity_type),
        description=req.description,
        metadata=req.metadata,
        source=SourceType(req.source),
        source_ref=req.source_ref,
    ))
    return ContextEngine._entity_to_dict(entity)


@router.get("/projects/{project_id}/entities")
def list_entities(project_id: str, entity_type: Optional[str] = None):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    et = EntityType(entity_type) if entity_type else None
    entities = engine.list_entities(entity_type=et)
    return [ContextEngine._entity_to_dict(e) for e in entities]


# ── Relation Routes ──

@router.post("/projects/{project_id}/relations")
def create_relation(project_id: str, req: CreateRelationReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    relation = engine.create_relation(Relation(
        source_entity_id=req.source_entity_id,
        target_entity_id=req.target_entity_id,
        relation_type=RelationType(req.relation_type),
        metadata=req.metadata,
        confidence=req.confidence,
    ))
    return ContextEngine._relation_to_dict(relation)


# ── Graph Routes ──

@router.get("/projects/{project_id}/graph")
def get_full_graph(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    return engine.get_full_graph()


# ── Impact Analysis ──

@router.get("/projects/{project_id}/impact/{entity_id}")
def impact_analysis(project_id: str, entity_id: str, depth: int = 3):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    impacted = engine.impact_analysis(entity_id, depth=depth)
    return [ContextEngine._entity_to_dict(e) for e in impacted]


# ── Source Routes ──

@router.post("/projects/{project_id}/sources")
def add_source(project_id: str, req: AddSourceReq):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    source = engine.create_source(SourceConnection(
        name=req.name,
        source_type=SourceType(req.source_type),
        config=req.config,
    ))
    return {"id": source.id, "project_id": source.project_id,
            "source_type": source.source_type.value if isinstance(source.source_type, SourceType) else source.source_type,
            "name": source.name, "config": source.config,
            "last_synced_at": source.last_synced_at, "status": source.status}


@router.get("/projects/{project_id}/sources")
def list_sources(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    sources = engine.list_sources()
    return [{"id": s.id, "project_id": s.project_id,
             "source_type": s.source_type.value if isinstance(s.source_type, SourceType) else s.source_type,
             "name": s.name, "config": s.config,
             "last_synced_at": s.last_synced_at, "status": s.status} for s in sources]


# ── Sync Route ──

@router.post("/projects/{project_id}/sources/{source_id}/sync")
def sync_source(project_id: str, source_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    source = engine.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source {source_id} not found")

    # Get previous snapshot for diffing
    prev_snapshot_id = engine.get_latest_snapshot_id(source_id)

    # Dispatch to connector based on source type
    source_type = source.source_type.value if isinstance(source.source_type, SourceType) else source.source_type

    if source_type == SourceType.KICAD.value:
        data = KiCadConnector.sync(
            schematic_path=source.config.get("schematic_path"),
            pcb_path=source.config.get("pcb_path"),
        )
    elif source_type == SourceType.GITHUB.value:
        data = GitHubConnector.sync(
            repo_path=source.config.get("repo_path", ""),
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported source type: {source_type}")

    # Create new snapshot
    new_snapshot = engine.create_snapshot(source_id, data)

    # Diff if previous snapshot exists
    changes = []
    if prev_snapshot_id:
        change_events = engine.diff_snapshots(prev_snapshot_id, new_snapshot.id)
        changes = [{"id": c.id, "change_type": c.change_type.value if hasattr(c.change_type, 'value') else c.change_type,
                     "entity_name": c.entity_name, "description": c.description,
                     "diff_data": c.diff_data} for c in change_events]

    return {
        "snapshot_id": new_snapshot.id,
        "source_id": source_id,
        "items_synced": len(data),
        "changes": changes,
    }


# ── Changes Route ──

@router.get("/projects/{project_id}/changes")
def list_changes(project_id: str):
    _require_project(project_id)
    engine = ContextEngine(project_id)
    changes = engine.list_changes()
    return [{"id": c.id, "project_id": c.project_id, "source_connection_id": c.source_connection_id,
             "change_type": c.change_type.value if hasattr(c.change_type, 'value') else c.change_type,
             "entity_id": c.entity_id, "entity_name": c.entity_name,
             "description": c.description, "diff_data": c.diff_data,
             "impacted_entity_ids": c.impacted_entity_ids,
             "created_at": c.created_at, "acknowledged": c.acknowledged} for c in changes]
