"""
Solus Shared Types — The canonical data models for the entire system.
All agents import from here. This is the single source of truth.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional
import uuid


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class EntityType(str, Enum):
    PROJECT = "project"
    TEAM_MEMBER = "team_member"
    MECHANICAL_PART = "mechanical_part"
    ELECTRICAL_PART = "electrical_part"
    SOFTWARE_MODULE = "software_module"
    INTERFACE = "interface"
    RUNTIME_SIGNAL = "runtime_signal"
    DOCUMENT = "document"
    PAPER = "paper"
    ISSUE = "issue"
    FIX = "fix"
    RUN = "run"
    SIMULATION_ASSET = "simulation_asset"
    EXTERNAL_PART_CANDIDATE = "external_part_candidate"


class RelationType(str, Enum):
    CONNECTED_TO = "connected_to"
    DEPENDS_ON = "depends_on"
    CONFIGURED_BY = "configured_by"
    DOCUMENTED_BY = "documented_by"
    PUBLISHES = "publishes"
    SUBSCRIBES_TO = "subscribes_to"
    DRIVES = "drives"
    READS_FROM = "reads_from"
    CHANGED_BY = "changed_by"
    IMPACTS = "impacts"
    OBSERVED_IN = "observed_in"
    RESOLVED_BY = "resolved_by"
    SIMILAR_TO = "similar_to"


class SourceType(str, Enum):
    GITHUB = "github"
    ONSHAPE = "onshape"
    KICAD = "kicad"
    PDF = "pdf"
    MANUAL = "manual"
    RUNTIME = "runtime"


class SignalStatus(str, Enum):
    HEALTHY = "healthy"
    WARNING = "warning"
    ERROR = "error"
    UNKNOWN = "unknown"


class ChangeType(str, Enum):
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"


class IssueStatus(str, Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())

def _now() -> str:
    return datetime.utcnow().isoformat()


# ──────────────────────────────────────────────
# Core Graph Models
# ──────────────────────────────────────────────

@dataclass
class Entity:
    """A node in the Robotics Context Model graph."""
    id: str = field(default_factory=_uid)
    project_id: str = ""
    entity_type: EntityType = EntityType.SOFTWARE_MODULE
    name: str = ""
    description: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    source: SourceType = SourceType.MANUAL
    source_ref: str = ""
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


@dataclass
class Relation:
    """An edge in the Robotics Context Model graph."""
    id: str = field(default_factory=_uid)
    project_id: str = ""
    source_entity_id: str = ""
    target_entity_id: str = ""
    relation_type: RelationType = RelationType.CONNECTED_TO
    metadata: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    created_at: str = field(default_factory=_now)


# ──────────────────────────────────────────────
# Project & Team
# ──────────────────────────────────────────────

@dataclass
class Project:
    id: str = field(default_factory=_uid)
    name: str = ""
    description: str = ""
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


@dataclass
class TeamMember:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    name: str = ""
    role: str = ""
    email: str = ""


@dataclass
class SourceConnection:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    source_type: SourceType = SourceType.GITHUB
    name: str = ""
    config: dict[str, Any] = field(default_factory=dict)
    last_synced_at: Optional[str] = None
    status: str = "disconnected"


# ──────────────────────────────────────────────
# Snapshots & Change Tracking
# ──────────────────────────────────────────────

@dataclass
class Snapshot:
    id: str = field(default_factory=_uid)
    source_connection_id: str = ""
    project_id: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_now)


@dataclass
class ChangeEvent:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    source_connection_id: str = ""
    change_type: ChangeType = ChangeType.MODIFIED
    entity_id: str = ""
    entity_name: str = ""
    description: str = ""
    diff_data: dict[str, Any] = field(default_factory=dict)
    impacted_entity_ids: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)
    acknowledged: bool = False


# ──────────────────────────────────────────────
# Runtime / Live Bench
# ──────────────────────────────────────────────

@dataclass
class RuntimeSignal:
    name: str = ""
    value: float = 0.0
    unit: str = ""
    timestamp: str = field(default_factory=_now)


@dataclass
class RuntimePacket:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    source: str = ""
    timestamp: str = field(default_factory=_now)
    signals: list[RuntimeSignal] = field(default_factory=list)
    status: SignalStatus = SignalStatus.HEALTHY
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Anomaly:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    runtime_packet_id: str = ""
    signal_name: str = ""
    expected_range: tuple[float, float] = (0.0, 1.0)
    actual_value: float = 0.0
    severity: str = "warning"
    description: str = ""
    created_at: str = field(default_factory=_now)


# ──────────────────────────────────────────────
# Issues & Fixes (Team Memory)
# ──────────────────────────────────────────────

@dataclass
class Issue:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    title: str = ""
    description: str = ""
    status: IssueStatus = IssueStatus.OPEN
    related_entity_ids: list[str] = field(default_factory=list)
    reported_by: str = ""
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


@dataclass
class Fix:
    id: str = field(default_factory=_uid)
    issue_id: str = ""
    project_id: str = ""
    description: str = ""
    steps: list[str] = field(default_factory=list)
    applied_by: str = ""
    created_at: str = field(default_factory=_now)


# ──────────────────────────────────────────────
# Simulation
# ──────────────────────────────────────────────

@dataclass
class SimulationRun:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    model_path: str = ""
    parameters: dict[str, Any] = field(default_factory=dict)
    results: dict[str, Any] = field(default_factory=dict)
    status: str = "pending"
    created_at: str = field(default_factory=_now)


# ──────────────────────────────────────────────
# Agent / AI Layer
# ──────────────────────────────────────────────

@dataclass
class AgentQuery:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    query: str = ""
    query_type: str = "general"
    context_entity_ids: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)


@dataclass
class AgentResponse:
    id: str = field(default_factory=_uid)
    query_id: str = ""
    response_text: str = ""
    structured_data: dict[str, Any] = field(default_factory=dict)
    sources: list[str] = field(default_factory=list)
    confidence: float = 0.0
    created_at: str = field(default_factory=_now)


@dataclass
class PartCandidate:
    id: str = field(default_factory=_uid)
    name: str = ""
    manufacturer: str = ""
    specs: dict[str, Any] = field(default_factory=dict)
    datasheet_url: str = ""
    price_range: str = ""
    source_url: str = ""
    relevance_score: float = 0.0


@dataclass
class ParameterRecommendation:
    parameter_name: str = ""
    recommended_value: Any = None
    unit: str = ""
    confidence: str = "uncertain"
    source_type: str = ""
    source_ref: str = ""
    reasoning: str = ""


@dataclass
class ChangeImpactReport:
    change_event_id: str = ""
    changed_entities: list[str] = field(default_factory=list)
    impacted_entities: list[str] = field(default_factory=list)
    risk_level: str = "low"
    explanation: str = ""
    suggested_actions: list[str] = field(default_factory=list)


@dataclass
class SemanticMemoryItem:
    id: str = field(default_factory=_uid)
    project_id: str = ""
    content: str = ""
    content_type: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: Optional[list[float]] = None
    created_at: str = field(default_factory=_now)