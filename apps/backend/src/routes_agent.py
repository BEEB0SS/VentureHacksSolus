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
from .simulator.pid_optimizer import optimize_pid

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

class OptimizePIDReq(BaseModel):
    n_trials: int = 100
    n_steps: int = 200
    dt: float = 0.01
    target_speed: float = 1.0
    initial_theta: float = 0.1
    bounds: Optional[dict[str, list[float]]] = None


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


@router.post("/projects/{project_id}/simulator/optimize")
async def optimize_simulation(project_id: str, req: OptimizePIDReq):
    """Run PID optimization: finds gains that minimize straight-line drift."""
    bounds = None
    if req.bounds:
        bounds = {k: tuple(v) for k, v in req.bounds.items()}
    result = optimize_pid(
        n_trials=req.n_trials,
        n_steps=req.n_steps,
        dt=req.dt,
        target_speed=req.target_speed,
        initial_theta=req.initial_theta,
        bounds=bounds,
    )
    return result


# ── Onshape Import (Mock) ──

class OnshapeImportReq(BaseModel):
    url: str

@router.post("/projects/{project_id}/simulator/import-onshape")
async def import_from_onshape(project_id: str, req: OnshapeImportReq):
    """Mock Onshape import — returns default model. Real API integration added later."""
    if not req.url.startswith("https://cad.onshape.com/"):
        raise HTTPException(status_code=400, detail="Invalid Onshape URL. Must start with https://cad.onshape.com/")
    return {
        "status": "success",
        "model_name": "elegoo-rover",
        "model_url": "/models/elegoo-rover.xml",
        "message": "Model imported successfully (demo mode)",
    }


# ── AI Simulation Tuning ──

class AITuneReq(BaseModel):
    goal: str
    current_mjcf: str
    current_params: dict[str, Any] = Field(default_factory=dict)
    n_trials: int = 100
    n_steps: int = 200

class ApplyTuneReq(BaseModel):
    new_mjcf: Optional[str] = None
    new_params: dict[str, Any] = Field(default_factory=dict)
    changes_summary: list[str] = Field(default_factory=list)


@router.post("/projects/{project_id}/simulator/ai-tune")
async def ai_tune_simulation(project_id: str, req: AITuneReq):
    """AI-driven simulation tuning: Gemini designs search, backend executes."""
    from apps.backend.src.simulator.ai_tuner import ai_tune

    # Get context model graph for Gemini prompt
    graph = {"entities": [], "relations": []}
    if CONTEXT_ENGINE_AVAILABLE:
        try:
            engine = ContextEngine(project_id)
            graph = engine.get_full_graph()
        except Exception:
            pass

    result = await ai_tune(
        goal=req.goal,
        current_mjcf=req.current_mjcf,
        current_params=req.current_params,
        graph=graph,
        n_trials=req.n_trials,
        n_steps=req.n_steps,
    )
    return result


@router.post("/projects/{project_id}/simulator/apply-tune")
async def apply_tune_result(project_id: str, req: ApplyTuneReq):
    """Record AI tuning changes in the context model graph."""
    changes_logged = 0

    if CONTEXT_ENGINE_AVAILABLE and req.changes_summary:
        try:
            engine = ContextEngine(project_id)
            for change_desc in req.changes_summary:
                from packages.shared_types.src.models import ChangeEvent, ChangeType, _uid, _now
                from apps.backend.src.database import get_connection
                import json as _json

                event = ChangeEvent(
                    project_id=project_id,
                    change_type=ChangeType.MODIFIED,
                    entity_name="simulation_model",
                    description=f"AI tuner: {change_desc}",
                )
                conn = get_connection()
                conn.execute(
                    """INSERT INTO change_events (id, project_id, source_connection_id, change_type, entity_id, entity_name, description, diff_data, impacted_entity_ids, created_at, acknowledged)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (event.id, event.project_id, "", event.change_type.value,
                     "", event.entity_name, event.description,
                     _json.dumps({}), _json.dumps([]), event.created_at, 0),
                )
                conn.commit()
                conn.close()
                changes_logged += 1
        except Exception as e:
            print(f"[apply-tune] Failed to log changes: {e}")

    return {"changes_logged": changes_logged, "status": "applied"}
