"""
Discovery API Route — trigger auto-relation discovery.

Set SOLUS_DISCOVERY_ENABLED=false to disable this feature.
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from .context_engine import ContextEngine
from .discovery_engine import DiscoveryEngine

router = APIRouter(prefix="/api")

DISCOVERY_ENABLED = os.environ.get("SOLUS_DISCOVERY_ENABLED", "true").lower() != "false"


class DiscoverReq(BaseModel):
    analyzers: Optional[list[str]] = None
    auto_add: bool = False
    min_confidence: float = 0.6


def _require_project(project_id: str):
    p = ContextEngine.get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")


@router.post("/projects/{project_id}/discover")
async def discover_relations(project_id: str, req: DiscoverReq = DiscoverReq()):
    if not DISCOVERY_ENABLED:
        raise HTTPException(status_code=403, detail="Auto-discovery is disabled (set SOLUS_DISCOVERY_ENABLED=true to enable)")
    _require_project(project_id)
    disco = DiscoveryEngine(project_id)
    report = disco.discover(
        analyzers=req.analyzers,
        auto_add=req.auto_add,
        min_confidence=req.min_confidence,
    )
    return {
        "total_candidates": report.total_candidates,
        "new_relations": report.new_relations,
        "duplicates_skipped": report.duplicates_skipped,
        "boosted": report.boosted,
        "warnings": report.warnings,
        "relations": [
            {
                "source_entity_id": r.source_entity_id,
                "source_entity_name": r.source_entity_name,
                "target_entity_id": r.target_entity_id,
                "target_entity_name": r.target_entity_name,
                "relation_type": r.relation_type.value if hasattr(r.relation_type, 'value') else r.relation_type,
                "confidence": r.confidence,
                "discovered_by": r.discovered_by,
                "evidence": r.evidence,
                "added": r.added,
            }
            for r in report.relations
        ],
    }
