# AI-Driven Simulation Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI tuning system where Gemini designs a parameter search strategy (what to tune, ranges, scoring function, optional MJCF changes) based on a natural language goal and the project's context model graph, then the backend executes the search and returns the best result.

**Architecture:** User types a goal → backend sends goal + MJCF + params + context graph to Gemini → Gemini returns search_space + scoring_function + optional MJCF changes → backend runs N kinematic simulation trials → returns best result with before/after trajectories. An "Apply" endpoint records changes in the context model graph.

**Tech Stack:** Python, FastAPI, google-generativeai SDK (Gemini 2.5 Flash), existing ContextEngine + pid_optimizer

**Parallelism:** Tasks 1 and 2 are independent (backend). Task 3 depends on both. Task 4 is frontend (depends on Task 2's endpoint existing).

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/simulator/ai_tuner.py` | Gemini prompt construction (with graph), response parsing, search execution |
| `apps/backend/tests/test_ai_tuner.py` | Tests for AI tuner (mock Gemini, test search execution) |

### Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/routes_agent.py` | Add `POST /simulator/ai-tune` and `POST /simulator/apply-tune` endpoints |
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Wire optimize to new endpoint, show explanation + Apply button |
| `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx` | Add `loadModelFromXml()` to imperative handle |

---

## Task 1: AI Tuner — Gemini Prompt + Search Execution

**Files:**
- Create: `apps/backend/src/simulator/ai_tuner.py`
- Create: `apps/backend/tests/test_ai_tuner.py`

**Context:** This is the core module. It builds a Gemini prompt from the goal + MJCF + params + graph, parses the response, then runs the search using `simulate_with_pid` from `pid_optimizer.py`. Can be tested independently with mock Gemini responses.

- [ ] **Step 1: Write tests for the search execution (no Gemini needed)**

Create `apps/backend/tests/test_ai_tuner.py`:

```python
"""Tests for the AI tuner — search execution with mock Gemini responses."""

import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))


class TestSearchExecution:
    def test_execute_search_straight_line(self):
        from apps.backend.src.simulator.ai_tuner import execute_search

        # Mock Gemini response: search PID gains for straight-line driving
        search_config = {
            "search_space": {
                "pid_kp": [0.5, 5.0],
                "pid_ki": [0.0, 1.0],
                "pid_kd": [0.0, 0.5],
            },
            "scoring_function": "sum(abs(p['y']) + abs(p['theta']) for p in traj) / len(traj)",
            "fixed_params": {
                "left_speed": None,
                "right_speed": None,
                "target_speed": 1.0,
                "initial_theta": 0.1,
            },
            "new_mjcf": None,
            "mjcf_changed": False,
        }

        result = execute_search(search_config, n_trials=20, n_steps=100)

        assert "best_params" in result
        assert "best_score" in result
        assert "baseline_score" in result
        assert "best_trajectory" in result
        assert "baseline_trajectory" in result
        assert "trials_run" in result
        assert result["trials_run"] == 20
        assert result["best_score"] <= result["baseline_score"]
        assert len(result["best_trajectory"]) == 100

    def test_execute_search_with_fixed_speeds(self):
        from apps.backend.src.simulator.ai_tuner import execute_search

        search_config = {
            "search_space": {
                "left_speed": [2.0, 10.0],
            },
            "scoring_function": "abs(traj[-1]['x'] - 1.0)",
            "fixed_params": {
                "right_speed": 8.0,
                "pid_kp": 0.0,
                "pid_ki": 0.0,
                "pid_kd": 0.0,
                "target_speed": 1.0,
                "initial_theta": 0.0,
            },
            "new_mjcf": None,
            "mjcf_changed": False,
        }

        result = execute_search(search_config, n_trials=10, n_steps=50)
        assert result["best_score"] >= 0
        assert "left_speed" in result["best_params"]

    def test_bad_scoring_function_skips_trial(self):
        from apps.backend.src.simulator.ai_tuner import execute_search

        search_config = {
            "search_space": {"pid_kp": [0.1, 1.0]},
            "scoring_function": "1 / 0",  # will throw ZeroDivisionError
            "fixed_params": {
                "left_speed": None, "right_speed": None,
                "pid_ki": 0.0, "pid_kd": 0.0,
                "target_speed": 1.0, "initial_theta": 0.1,
            },
            "new_mjcf": None,
            "mjcf_changed": False,
        }

        result = execute_search(search_config, n_trials=5, n_steps=50)
        # Should not crash — bad trials are skipped, baseline used as fallback
        assert "best_score" in result


class TestBuildGraphSummary:
    def test_build_graph_summary_from_dict(self):
        from apps.backend.src.simulator.ai_tuner import build_graph_summary

        graph = {
            "entities": [
                {"name": "DRV8825", "entity_type": "electrical_part", "description": "Motor driver, max 2.5A"},
                {"name": "NEMA17", "entity_type": "mechanical_part", "description": "Stepper motor, 0.44Nm"},
            ],
            "relations": [
                {"source_entity_id": "e1", "target_entity_id": "e2", "relation_type": "drives"},
            ],
        }

        summary = build_graph_summary(graph)
        assert "DRV8825" in summary
        assert "NEMA17" in summary
        assert "drives" in summary
        assert isinstance(summary, str)

    def test_build_graph_summary_empty(self):
        from apps.backend.src.simulator.ai_tuner import build_graph_summary

        summary = build_graph_summary({"entities": [], "relations": []})
        assert "No entities" in summary or len(summary) > 0


class TestParseGeminiResponse:
    def test_parse_valid_json(self):
        from apps.backend.src.simulator.ai_tuner import parse_gemini_response

        raw = '''{
            "search_space": {"pid_kp": [0.5, 5.0]},
            "scoring_function": "sum(abs(p['y']) for p in traj) / len(traj)",
            "fixed_params": {"target_speed": 1.0},
            "new_mjcf": null,
            "mjcf_changed": false,
            "explanation": "Tuning PID for straight line",
            "changes_summary": ["Search kp 0.5-5.0"],
            "graph_constraints_used": ["DRV8825 max 2.5A"]
        }'''

        result = parse_gemini_response(raw)
        assert result["search_space"]["pid_kp"] == [0.5, 5.0]
        assert result["explanation"] == "Tuning PID for straight line"

    def test_parse_json_from_markdown_block(self):
        from apps.backend.src.simulator.ai_tuner import parse_gemini_response

        raw = '''Here is my analysis:
```json
{
    "search_space": {"pid_kp": [1.0, 3.0]},
    "scoring_function": "sum(abs(p['theta']) for p in traj) / len(traj)",
    "fixed_params": {},
    "new_mjcf": null,
    "mjcf_changed": false,
    "explanation": "test",
    "changes_summary": [],
    "graph_constraints_used": []
}
```'''

        result = parse_gemini_response(raw)
        assert result["search_space"]["pid_kp"] == [1.0, 3.0]

    def test_parse_invalid_json_returns_none(self):
        from apps.backend.src.simulator.ai_tuner import parse_gemini_response

        result = parse_gemini_response("this is not json at all")
        assert result is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-fixes && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_ai_tuner.py -v 2>&1 | head -15`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement ai_tuner.py**

Create `apps/backend/src/simulator/ai_tuner.py`:

```python
"""
AI Tuner — Gemini designs parameter search, backend executes it.

Phase 1: Gemini receives goal + MJCF + params + context graph → returns search strategy
Phase 2: Backend runs N kinematic simulation trials → returns best result
"""

import json
import math
import os
import random
from typing import Optional

from .pid_optimizer import simulate_with_pid, straight_line_score

# Gemini import — optional
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False


SYSTEM_PROMPT = """You are a robotics simulation engineer. Given a MuJoCo MJCF model, the project's context model graph (entities and relations), and an optimization goal, design a parameter search strategy to achieve the goal.

You have two powers:
1. MODIFY THE MODEL: You can change the MJCF XML — friction, mass, actuator kv, damping, body structure, geom sizes, anything. Return the full modified XML.
2. DESIGN THE SEARCH: Define which runtime parameters to search over, their ranges, and a scoring function (as a Python expression) that evaluates trajectory quality. Lower score = better.

The robot is a 4-wheel differential drive car (Elegoo Smart Robot Car V4):
- 4 velocity actuators: act_lf, act_rf, act_lr, act_rr
- Left pair controlled together, right pair controlled together
- Optional PID heading controller: corrects theta error via left/right speed differential

Searchable parameters (you pick which ones and what ranges):
- left_speed: left wheel angular velocity (rad/s). Set to null in fixed_params to use PID mode instead.
- right_speed: right wheel angular velocity (rad/s). Set to null in fixed_params to use PID mode instead.
- pid_kp: proportional gain (used when left_speed/right_speed are null)
- pid_ki: integral gain
- pid_kd: derivative gain
- target_speed: desired forward speed (m/s, used in PID mode)
- initial_theta: starting heading offset (radians)

The scoring function receives a trajectory (list of dicts with keys: x, y, theta, v_linear, v_angular, timestamp) and must return a float. Lower = better. Write it as a Python expression using:
- traj: the full trajectory list
- p: a single point (use in list comprehensions)
- math: the math module is available

Examples:
- Straight line: "sum(abs(p['y']) + abs(p['theta']) for p in traj) / len(traj)"
- Circle radius R: "sum(abs(math.sqrt(p['x']**2 + p['y']**2) - 0.5) for p in traj) / len(traj)"
- Reach target (1,0): "math.sqrt((traj[-1]['x'] - 1.0)**2 + (traj[-1]['y'] - 0.0)**2)"
- Minimize energy: "sum(abs(p['v_angular']) for p in traj) / len(traj)"

Use the context model graph to inform your constraints. For example:
- If a battery entity shows 12V, don't suggest parameters exceeding that
- If a motor driver has max current, constrain actuator forces accordingly
- Reference specific entities in your explanation

Return ONLY valid JSON (no markdown, no explanation outside JSON) with these fields:
- search_space: Dict of {param_name: [min, max]} for parameters to search
- scoring_function: Python expression string (lower = better)
- fixed_params: Dict of parameters to hold constant (not searched)
- new_mjcf: Complete modified MJCF XML string, or null if no changes
- mjcf_changed: boolean
- explanation: What you changed and why
- changes_summary: Array of short bullet strings
- graph_constraints_used: Array of strings noting which graph entities informed constraints"""


def build_graph_summary(graph: dict) -> str:
    """Convert a context model graph dict to a compact text summary for Gemini."""
    entities = graph.get("entities", [])
    relations = graph.get("relations", [])

    if not entities:
        return "No entities in the context model yet."

    lines = ["Entities:"]
    entity_names = {}
    for e in entities:
        eid = e.get("id", "?")
        name = e.get("name", "unnamed")
        etype = e.get("entity_type", "unknown")
        desc = e.get("description", "")
        entity_names[eid] = name
        lines.append(f"- {name} ({etype}): {desc}")

    if relations:
        lines.append("\nRelations:")
        for r in relations:
            src = entity_names.get(r.get("source_entity_id", ""), r.get("source_entity_id", "?"))
            tgt = entity_names.get(r.get("target_entity_id", ""), r.get("target_entity_id", "?"))
            rtype = r.get("relation_type", "related_to")
            lines.append(f"- {src} --{rtype}--> {tgt}")

    return "\n".join(lines)


def parse_gemini_response(raw_text: str) -> Optional[dict]:
    """Parse Gemini's JSON response. Handles markdown code blocks."""
    text = raw_text.strip()

    # Try to extract JSON from markdown code block
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                text = part
                break

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return None

    # Validate required fields
    required = ["search_space", "scoring_function", "fixed_params",
                "new_mjcf", "mjcf_changed", "explanation", "changes_summary"]
    for field in required:
        if field not in result:
            return None

    return result


def execute_search(search_config: dict, n_trials: int = 100,
                   n_steps: int = 200, dt: float = 0.01) -> dict:
    """Execute the parameter search designed by Gemini.

    Runs N trials with random sampling from search_space, scores each
    trajectory using the scoring function, returns the best result.
    """
    search_space = search_config["search_space"]
    scoring_expr = search_config["scoring_function"]
    fixed = search_config.get("fixed_params", {})

    # Compile scoring function
    def score_trajectory(traj: list[dict]) -> float:
        try:
            return float(eval(scoring_expr, {"__builtins__": {}, "math": math,
                                              "traj": traj, "abs": abs, "sum": sum,
                                              "len": len, "min": min, "max": max,
                                              "p": None}))
        except Exception:
            return float("inf")

    # Build baseline params (all fixed, search params at midpoint)
    baseline_params = dict(fixed)
    for param, (lo, hi) in search_space.items():
        baseline_params[param] = (lo + hi) / 2

    # Run baseline simulation
    sim_kwargs = _build_sim_kwargs(baseline_params)
    baseline_traj = simulate_with_pid(**sim_kwargs, n_steps=n_steps, dt=dt)
    baseline_score = score_trajectory(baseline_traj)

    # Run trials
    best_params = dict(baseline_params)
    best_score = baseline_score
    best_traj = baseline_traj

    for _ in range(n_trials):
        # Sample each search parameter uniformly
        trial_params = dict(fixed)
        for param, (lo, hi) in search_space.items():
            trial_params[param] = random.uniform(lo, hi)

        try:
            sim_kwargs = _build_sim_kwargs(trial_params)
            traj = simulate_with_pid(**sim_kwargs, n_steps=n_steps, dt=dt)
            score = score_trajectory(traj)
            if score < best_score:
                best_score = score
                best_params = dict(trial_params)
                best_traj = traj
        except Exception:
            continue  # Skip failed trials

    return {
        "best_params": {k: round(v, 4) if isinstance(v, float) else v
                        for k, v in best_params.items()},
        "best_score": round(best_score, 6),
        "baseline_score": round(baseline_score, 6),
        "best_trajectory": best_traj,
        "baseline_trajectory": baseline_traj,
        "trials_run": n_trials,
    }


def _build_sim_kwargs(params: dict) -> dict:
    """Convert flat params dict to simulate_with_pid kwargs.

    If left_speed/right_speed are None, PID mode is used (kp/ki/kd + target_speed).
    If they are set, direct speed mode with kp=ki=kd=0.
    """
    left = params.get("left_speed")
    right = params.get("right_speed")

    if left is None or right is None:
        # PID mode
        return {
            "kp": params.get("pid_kp", 0),
            "ki": params.get("pid_ki", 0),
            "kd": params.get("pid_kd", 0),
            "target_speed": params.get("target_speed", 1.0),
            "initial_theta": params.get("initial_theta", 0.1),
        }
    else:
        # Direct speed mode — simulate by setting base speed and zero PID
        avg_speed = (left + right) / 2 * 0.0325  # angular to linear
        return {
            "kp": 0, "ki": 0, "kd": 0,
            "target_speed": avg_speed,
            "initial_theta": params.get("initial_theta", 0.0),
        }


async def ai_tune(goal: str, current_mjcf: str, current_params: dict,
                  graph: dict, n_trials: int = 100, n_steps: int = 200) -> dict:
    """Full AI tuning pipeline: Gemini designs search, backend executes it.

    Args:
        goal: Natural language optimization goal
        current_mjcf: Current MJCF XML string
        current_params: Current runtime parameters
        graph: Context model graph dict {entities: [...], relations: [...]}
        n_trials: Number of search trials
        n_steps: Steps per simulation

    Returns:
        Combined result with Gemini's analysis + search results
    """
    graph_summary = build_graph_summary(graph)

    user_prompt = f"""Current MJCF model:
{current_mjcf}

Current parameters:
{json.dumps(current_params, indent=2)}

Project Context Model (entities and relations in this robot system):
{graph_summary}

Use the context model to inform your constraints. For example, if a battery entity
shows 12V capacity, don't suggest parameters that would exceed that. If a motor
driver has a max current rating, constrain actuator forces accordingly.

Optimization goal: {goal}"""

    # Call Gemini
    gemini_response = None
    if GEMINI_AVAILABLE:
        api_key = os.environ.get("GEMINI_API_KEY")
        if api_key:
            try:
                genai.configure(api_key=api_key)
                model = genai.GenerativeModel("gemini-2.5-flash")
                full_prompt = f"{SYSTEM_PROMPT}\n\n{user_prompt}"
                import asyncio
                response = await asyncio.to_thread(model.generate_content, full_prompt)
                gemini_response = parse_gemini_response(response.text)
            except Exception as e:
                print(f"[ai_tuner] Gemini call failed: {e}")

    if not gemini_response:
        # Fallback: default straight-line PID search
        gemini_response = {
            "search_space": {"pid_kp": [0.5, 5.0], "pid_ki": [0.0, 1.0], "pid_kd": [0.0, 0.5]},
            "scoring_function": "sum(abs(p['y']) + abs(p['theta']) for p in traj) / len(traj)",
            "fixed_params": {"left_speed": None, "right_speed": None,
                             "target_speed": 1.0, "initial_theta": 0.1},
            "new_mjcf": None,
            "mjcf_changed": False,
            "explanation": "Gemini unavailable. Using default PID search for straight-line driving.",
            "changes_summary": ["Default: search PID gains kp/ki/kd for heading correction"],
            "graph_constraints_used": [],
        }

    # Execute the search
    search_result = execute_search(gemini_response, n_trials=n_trials, n_steps=n_steps)

    # Combine Gemini's analysis with search results
    return {
        **search_result,
        "new_mjcf": gemini_response.get("new_mjcf"),
        "new_params": search_result["best_params"],
        "mjcf_changed": gemini_response.get("mjcf_changed", False),
        "explanation": gemini_response.get("explanation", ""),
        "changes_summary": gemini_response.get("changes_summary", []),
        "search_space": gemini_response.get("search_space", {}),
        "scoring_function": gemini_response.get("scoring_function", ""),
        "graph_constraints_used": gemini_response.get("graph_constraints_used", []),
    }
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-fixes && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_ai_tuner.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/simulator/ai_tuner.py apps/backend/tests/test_ai_tuner.py
git commit -m "feat: AI tuner — Gemini designs search strategy, backend executes parameter search"
```

---

## Task 2: Backend Routes — ai-tune + apply-tune Endpoints

**Files:**
- Modify: `apps/backend/src/routes_agent.py`

**Context:** Add two new endpoints. The `ai-tune` endpoint calls `ai_tuner.ai_tune()` with the context graph from ContextEngine. The `apply-tune` endpoint records changes in the context model.

**Can run in parallel with:** Task 1 (but depends on ai_tuner.py existing for import).

- [ ] **Step 1: Add request models and endpoints**

Append to `apps/backend/src/routes_agent.py`, after the Onshape endpoint:

```python
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
```

- [ ] **Step 2: Verify the backend starts**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-fixes/apps/backend && source .venv/bin/activate && python -c "from apps.backend.src.routes_agent import router; print('Routes loaded OK')"`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/routes_agent.py
git commit -m "feat: add POST /simulator/ai-tune and /simulator/apply-tune endpoints"
```

---

## Task 3: MuJoCoViewer — Add loadModelFromXml

**Files:**
- Modify: `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx`

**Context:** Add a `loadModelFromXml(xml)` method to the imperative handle so the frontend can reload the MuJoCo model when Gemini modifies the MJCF.

- [ ] **Step 1: Add loadModelFromXml to the interface and implementation**

In `MuJoCoViewer.tsx`, add `loadModelFromXml` to the `MuJoCoViewerHandle` interface:

```tsx
export interface MuJoCoViewerHandle {
  play: (leftSpeed: number, rightSpeed: number) => void
  playWithPID: (kp: number, ki: number, kd: number, targetSpeed: number) => void
  pause: () => void
  reset: () => void
  isPlaying: () => boolean
  getTrajectory: () => TrajectoryPoint[]
  loadModelFromXml: (xml: string) => Promise<void>
}
```

Then add the implementation inside `useImperativeHandle`, after `getTrajectory`:

```tsx
    loadModelFromXml: async (xml: string) => {
      const mj = mjRef.current
      if (!mj) throw new Error('MuJoCo not initialized')

      // Pause and clean up
      playingRef.current = false
      dataRef.current?.delete?.()
      modelRef.current?.delete?.()

      // Write new XML to VFS
      mj.FS.writeFile('/working/model.xml', xml)

      // Load new model
      const model = mj.MjModel.loadFromXML('/working/model.xml')
      const data = new mj.MjData(model)
      modelRef.current = model
      dataRef.current = data

      // Rebuild Three.js meshes
      mj.mj_forward(model, data)
      const scene = sceneRef.current
      if (scene) {
        // Remove old geom meshes
        geomMeshesRef.current.forEach(mesh => scene.remove(mesh))
        geomMeshesRef.current.clear()
        // Rebuild
        buildGeomMeshes(scene, model, data)
      }

      stepCountRef.current = 0
      trajectoryRef.current = []
      pidIntegralRef.current = 0
      pidPrevErrorRef.current = 0
    },
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-fixes/apps/desktop && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx
git commit -m "feat: add loadModelFromXml() to MuJoCoViewer for AI tuner model reload"
```

---

## Task 4: SimulatorTab — Wire AI Tuning UI

**Files:**
- Modify: `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx`

**Context:** Replace the current `runOptimization` function (which calls the old `/simulator/optimize` endpoint) with the new AI tuning flow. The optimize panel already exists — we reuse it but wire it to the new endpoint and show Gemini's explanation + search results.

- [ ] **Step 1: Update the optimization state types and runOptimization function**

Replace the `optimResult` state type and `runOptimization` function. The new version:
1. Fetches the current MJCF XML from `/models/elegoo-rover.xml`
2. Sends goal + MJCF + params + n_trials to `POST /simulator/ai-tune`
3. Stores the result including explanation, changes_summary, graph_constraints_used

Replace the existing optimization state (around line 71):

```tsx
  const [optimResult, setOptimResult] = useState<{
    best_params: Record<string, number | null>
    best_score: number
    baseline_score: number
    best_trajectory: TrajectoryPoint[]
    baseline_trajectory: TrajectoryPoint[]
    trials_run: number
    new_mjcf: string | null
    mjcf_changed: boolean
    explanation: string
    changes_summary: string[]
    search_space: Record<string, number[]>
    scoring_function: string
    graph_constraints_used: string[]
  } | null>(null)
```

Replace the `runOptimization` function (around line 159):

```tsx
  const runOptimization = useCallback(async () => {
    if (!currentProjectId) return
    setOptimizing(true)
    setError(null)
    setOptimResult(null)
    try {
      // Fetch current MJCF
      const mjcfRes = await fetch('/models/elegoo-rover.xml')
      const currentMjcf = await mjcfRes.text()

      const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/ai-tune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: optimGoal,
          current_mjcf: currentMjcf,
          current_params: {
            left_speed: leftSpeed,
            right_speed: rightSpeed,
            pid_gains: { kp: 0, ki: 0, kd: 0 },
            target_speed: 1.0,
          },
          n_trials: 100,
          n_steps: 200,
        }),
      })
      if (!res.ok) throw new Error(`AI tuning failed: ${res.statusText}`)
      const result = await res.json()
      setOptimResult(result)
      setViewingOptimized(true)
      setTrajectory(result.best_trajectory)
      setShowOptimizeInput(false)

      // If MJCF was changed, reload the model in the viewer
      if (result.mjcf_changed && result.new_mjcf) {
        try {
          await viewerRef.current?.loadModelFromXml(result.new_mjcf)
        } catch (err) {
          console.warn('Failed to reload model:', err)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI tuning failed')
    } finally {
      setOptimizing(false)
    }
  }, [currentProjectId, optimGoal, leftSpeed, rightSpeed])
```

- [ ] **Step 2: Update the handlePlay for Before/After with AI tune results**

Replace the `handlePlay` function to use the new optimResult fields:

```tsx
  const handlePlay = useCallback(() => {
    if (optimResult) {
      const bp = optimResult.best_params
      if (viewingOptimized) {
        // After: use best params from search
        if (bp.left_speed != null && bp.right_speed != null) {
          viewerRef.current?.play(bp.left_speed as number, bp.right_speed as number)
        } else {
          viewerRef.current?.playWithPID(
            (bp.pid_kp as number) || 0,
            (bp.pid_ki as number) || 0,
            (bp.pid_kd as number) || 0,
            (bp.target_speed as number) || 1.0,
          )
        }
      } else {
        // Before: no PID correction (baseline)
        viewerRef.current?.playWithPID(0, 0, 0, 1.0)
      }
    } else {
      viewerRef.current?.play(leftSpeed, rightSpeed)
    }
    setTrajectory([])
    setStepCount(0)
    setPlaying(true)
  }, [leftSpeed, rightSpeed, optimResult, viewingOptimized])
```

- [ ] **Step 3: Update the optimization result card to show Gemini's explanation**

Replace the optimization result card (around line 442) with:

```tsx
              {optimResult && (
                <Card title="AI Optimization Result">
                  <div className="space-y-3">
                    {/* Score improvement */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-solus-text-dim">Score improvement</span>
                      <span className="text-sm font-mono font-semibold text-green-400">
                        {optimResult.baseline_score.toFixed(4)} → {optimResult.best_score.toFixed(4)}
                        {optimResult.baseline_score > 0 && (
                          <> ({((1 - optimResult.best_score / optimResult.baseline_score) * 100).toFixed(0)}% better)</>
                        )}
                      </span>
                    </div>

                    {/* Gemini's explanation */}
                    <div className="bg-solus-elevated/50 rounded-md p-3">
                      <p className="text-xs text-solus-text-dim mb-1 font-semibold">AI Analysis</p>
                      <p className="text-xs text-solus-text whitespace-pre-wrap">{optimResult.explanation}</p>
                    </div>

                    {/* Changes summary */}
                    {optimResult.changes_summary.length > 0 && (
                      <div>
                        <p className="text-xs text-solus-text-dim mb-1 font-semibold">Changes Made</p>
                        <ul className="text-xs text-solus-text space-y-0.5">
                          {optimResult.changes_summary.map((c, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <span className="text-solus-accent mt-0.5">•</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Graph constraints used */}
                    {optimResult.graph_constraints_used.length > 0 && (
                      <div>
                        <p className="text-xs text-solus-text-dim mb-1 font-semibold">Context Model Constraints</p>
                        <ul className="text-xs text-solus-text-muted space-y-0.5">
                          {optimResult.graph_constraints_used.map((c, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <span className="text-solus-warning mt-0.5">⚡</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Search space */}
                    {Object.keys(optimResult.search_space).length > 0 && (
                      <div>
                        <p className="text-xs text-solus-text-dim mb-1 font-semibold">Search Space</p>
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(optimResult.search_space).map(([key, range]) => (
                            <div key={key} className="bg-solus-elevated rounded px-2 py-1 text-xs font-mono">
                              <span className="text-solus-text-muted">{key}:</span>{' '}
                              <span className="text-solus-text">[{(range as number[])[0]}, {(range as number[])[1]}]</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Best params */}
                    <div>
                      <p className="text-xs text-solus-text-dim mb-1 font-semibold">Best Parameters</p>
                      <div className="grid grid-cols-3 gap-1">
                        {Object.entries(optimResult.best_params).filter(([, v]) => v != null).map(([key, value]) => (
                          <div key={key} className="bg-solus-elevated rounded px-2 py-1 text-center">
                            <div className="text-[10px] text-solus-text-muted">{key}</div>
                            <div className="text-xs font-mono font-semibold text-solus-accent">
                              {typeof value === 'number' ? value.toFixed(3) : String(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="text-xs text-solus-text-muted">
                      Tested {optimResult.trials_run} candidates
                      {optimResult.mjcf_changed && ' • Model XML modified'}
                    </div>

                    {/* Before/After trajectory overlay */}
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                          <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <Tooltip contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                          <Line data={optimResult.baseline_trajectory} dataKey="y" name="Before" stroke="#ef4444" dot={false} strokeWidth={2} strokeDasharray="5 5" />
                          <Line data={optimResult.best_trajectory} dataKey="y" name="After (optimized)" stroke="#22c55e" dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </Card>
              )}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-fixes/apps/desktop && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx
git commit -m "feat: wire AI tuning UI — Gemini explanation, search space, graph constraints"
```

---

## Task 5: End-to-End Verification

- [ ] **Step 1: Run backend tests**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-fixes && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_ai_tuner.py -v`
Expected: All tests PASS

- [ ] **Step 2: Verify build**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-fixes/apps/desktop && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Manual test**

1. Start backend: `cd apps/backend && source .venv/bin/activate && uvicorn src.main:app --reload --port 8000`
2. Start frontend: `cd apps/desktop && pnpm run dev:web`
3. Open Simulator tab, click "Optimize"
4. Type "Make the car drive in a straight line with minimal drift"
5. Click "Run" — should show loading, then Gemini's analysis + search results
6. Click Before/After to compare trajectories
7. Click "Run Simulation" to see the optimized car in 3D

- [ ] **Step 4: Commit any fixes**

```bash
git status
git add -A
git commit -m "fix: adjustments from e2e testing"
```
