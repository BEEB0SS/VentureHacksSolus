"""
Solus Agent Routes — FastAPI APIRouter for agent queries, memory, and simulator.

Uses APIRouter(prefix="/api") so it can be included in main.py without conflicts
with other teammates' route files.
"""

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from packages.shared_types.src.models import (
    AgentQuery, AgentResponse, SemanticMemoryItem, SimulationRun,
    _uid, _now,
)

from .memory.memory_store import MemoryStore
from .agent.solus_agent import SolusAgent
from .simulator.mujoco_wrapper import MuJoCoSimulator

# ContextEngine — available now that Pratham has merged
try:
    from .context_engine import ContextEngine
    CONTEXT_ENGINE_AVAILABLE = True
except ImportError:
    CONTEXT_ENGINE_AVAILABLE = False


router = APIRouter(prefix="/api")

# Shared instances
_memory_store = MemoryStore()
_simulator_instances: dict[str, MuJoCoSimulator] = {}
_agent_instances: dict[str, SolusAgent] = {}


def _get_simulator(project_id: str) -> MuJoCoSimulator:
    """Get or create a simulator instance for a project."""
    if project_id not in _simulator_instances:
        _simulator_instances[project_id] = MuJoCoSimulator()
    return _simulator_instances[project_id]


def _get_agent(project_id: str) -> SolusAgent:
    """Get or create a SolusAgent for a project."""
    if project_id not in _agent_instances:
        context_engine = None
        if CONTEXT_ENGINE_AVAILABLE:
            context_engine = ContextEngine(project_id)
        _agent_instances[project_id] = SolusAgent(context_engine=context_engine, memory_store=_memory_store)
    return _agent_instances[project_id]


# ── Request Models ──

class AgentQueryReq(BaseModel):
    query: str
    query_type: str = "general"
    context_entity_ids: list[str] = Field(default_factory=list)

class MemoryStoreReq(BaseModel):
    content: str
    content_type: str
    metadata: dict[str, Any] = Field(default_factory=dict)

class SimulatorRunReq(BaseModel):
    n_steps: int = 100
    left_speed: float = 1.0
    right_speed: float = 1.0
    dt: float = 0.01
    parameters: dict[str, float] = Field(default_factory=dict)

class SimulatorCompareReq(BaseModel):
    sim_data: list[dict[str, Any]]
    runtime_data: list[dict[str, Any]]
    threshold: float = 0.01


# ── Agent Routes ──

@router.post("/projects/{project_id}/agent/query")
async def agent_query(project_id: str, req: AgentQueryReq):
    """Main AI query endpoint — routes to appropriate handler based on query_type."""
    agent = _get_agent(project_id)
    query = AgentQuery(
        project_id=project_id,
        query=req.query,
        query_type=req.query_type,
        context_entity_ids=req.context_entity_ids,
    )
    response = await agent.query(query)
    return {
        "query_id": response.query_id,
        "response_text": response.response_text,
        "structured_data": response.structured_data,
        "sources": response.sources,
        "confidence": response.confidence,
    }


# ── Memory Routes ──

@router.post("/projects/{project_id}/memory")
async def store_memory(project_id: str, req: MemoryStoreReq):
    """Store a memory item."""
    item = SemanticMemoryItem(
        project_id=project_id,
        content=req.content,
        content_type=req.content_type,
        metadata=req.metadata,
    )
    stored = _memory_store.store(item)
    return {
        "id": stored.id,
        "project_id": stored.project_id,
        "content_type": stored.content_type,
        "created_at": stored.created_at,
    }


@router.get("/projects/{project_id}/memory/search")
async def search_memory(project_id: str, query: str, content_type: Optional[str] = None, limit: int = 5):
    """Search memory for similar items."""
    results = _memory_store.find_similar(
        query=query,
        project_id=project_id,
        content_type=content_type,
        limit=limit,
    )
    return results


# ── Simulator Routes ──

@router.post("/projects/{project_id}/simulator/run")
async def run_simulation(project_id: str, req: SimulatorRunReq):
    """Run a simulation with given parameters."""
    sim = _get_simulator(project_id)
    for name, value in req.parameters.items():
        sim.set_parameter(name, value)
    trajectory = sim.run_steps(
        n_steps=req.n_steps,
        left_speed=req.left_speed,
        right_speed=req.right_speed,
        dt=req.dt,
    )
    return {
        "n_steps": req.n_steps,
        "trajectory": trajectory,
        "final_position": sim.get_state()["position"],
    }


@router.get("/projects/{project_id}/simulator/state")
async def get_simulator_state(project_id: str):
    """Get current simulator state."""
    sim = _get_simulator(project_id)
    return sim.get_state()


@router.post("/projects/{project_id}/simulator/compare")
async def compare_simulation(project_id: str, req: SimulatorCompareReq):
    """Compare simulation results with runtime data."""
    sim = _get_simulator(project_id)
    discrepancies = sim.compare_with_runtime(
        sim_data=req.sim_data,
        runtime_data=req.runtime_data,
        threshold=req.threshold,
    )
    return {
        "discrepancies": discrepancies,
        "match": len(discrepancies) == 0,
    }
