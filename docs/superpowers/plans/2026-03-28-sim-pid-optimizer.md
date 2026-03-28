# PID Optimization Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "bad policy → optimize → good policy" demo to the Simulator tab — user sees a car drifting off course with bad PID gains, clicks Optimize, and Solus finds gains that make it drive straight. No new dependencies.

**Architecture:** A PID controller translates "drive straight at target speed" into left/right wheel velocities using heading error feedback. An optimizer runs 100 trials with random PID candidates, each calling the existing `MuJoCoSimulator.run_steps()`, and scores each trajectory by lateral drift + heading error. The best result is returned with a before/after trajectory comparison. One new API endpoint, one new module, and a button added to the existing SimulatorTab.

**Tech Stack:** Python (existing FastAPI + MuJoCoSimulator), React/TypeScript (existing SimulatorTab + Recharts)

---

## Integration Points (Read-Only — Do NOT Modify)

| File | What It Provides |
|------|-----------------|
| `apps/backend/src/simulator/mujoco_wrapper.py` | `MuJoCoSimulator` with `run_steps(n_steps, left_speed, right_speed, dt)`, `set_parameter()`, `get_state()`. Uses kinematic differential drive. |
| `apps/backend/src/routes_agent.py` | Existing simulator routes (`/simulator/run`, `/simulator/state`, `/simulator/compare`). Has `_get_simulator(project_id)` factory and `_simulator_instances` dict. We add our optimize endpoint here. |
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Full simulator UI with parameter editor, run button, trajectory chart, velocity chart, discrepancy table. We add an Optimize section to this. |

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/simulator/pid_optimizer.py` | PID controller function + straight-line scorer + random search optimizer. Pure functions, no side effects. |
| `apps/backend/tests/test_pid_optimizer.py` | Tests for the PID controller, scorer, and optimizer |

### Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/routes_agent.py` | Add `POST /api/projects/{id}/simulator/optimize` endpoint |
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Add Optimize PID button, result card, before/after trajectory overlay |

---

## Task 1: PID Controller + Scorer + Optimizer

**Files:**
- Create: `apps/backend/src/simulator/pid_optimizer.py`
- Create: `apps/backend/tests/test_pid_optimizer.py`

**Context:** The PID controller is a function that takes heading error and returns a steering correction. It runs inside a simulation loop: at each step, compute heading error from current theta vs target (0 = straight), apply PID to get a steering adjustment, convert to left/right wheel speeds. The scorer measures how badly the car drifted. The optimizer tries random PID values and picks the best.

The existing `MuJoCoSimulator.run_steps()` takes constant left/right wheel speeds. We can't use it directly for PID because PID needs to adjust wheel speeds at each step. Instead, we'll step the simulator one step at a time in a loop (calling `run_steps(n_steps=1, ...)` per tick), reading position and adjusting.

Actually — simpler: we write our own `simulate_with_pid()` that uses the same differential drive math directly (it's just 5 lines of kinematics). This avoids coupling to the MuJoCoSimulator class and is testable in isolation. The optimizer module is self-contained.

- [ ] **Step 1: Write failing tests**

Create `apps/backend/tests/test_pid_optimizer.py`:

```python
"""Tests for PID controller, straight-line scorer, and optimizer."""

import math


class TestPIDController:
    def test_zero_error_gives_zero_correction(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        correction, state = pid_step(error=0.0, prev_error=0.0, integral=0.0,
                                      kp=1.0, ki=0.0, kd=0.0, dt=0.01)
        assert correction == 0.0

    def test_positive_error_gives_positive_correction(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        correction, state = pid_step(error=0.5, prev_error=0.0, integral=0.0,
                                      kp=2.0, ki=0.0, kd=0.0, dt=0.01)
        assert correction > 0

    def test_integral_accumulates(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        _, state1 = pid_step(error=1.0, prev_error=0.0, integral=0.0,
                              kp=0.0, ki=1.0, kd=0.0, dt=0.01)
        assert state1["integral"] > 0
        _, state2 = pid_step(error=1.0, prev_error=1.0, integral=state1["integral"],
                              kp=0.0, ki=1.0, kd=0.0, dt=0.01)
        assert state2["integral"] > state1["integral"]

    def test_derivative_responds_to_change(self):
        from apps.backend.src.simulator.pid_optimizer import pid_step
        correction, _ = pid_step(error=0.0, prev_error=1.0, integral=0.0,
                                  kp=0.0, ki=0.0, kd=1.0, dt=0.01)
        # Error decreased (1.0 -> 0.0), derivative is negative
        assert correction < 0


class TestSimulateWithPID:
    def test_returns_trajectory(self):
        from apps.backend.src.simulator.pid_optimizer import simulate_with_pid
        traj = simulate_with_pid(kp=1.0, ki=0.0, kd=0.0, target_speed=1.0,
                                  n_steps=100, dt=0.01)
        assert len(traj) == 100
        assert "x" in traj[0]
        assert "y" in traj[0]
        assert "theta" in traj[0]

    def test_good_pid_drives_straighter_than_bad(self):
        from apps.backend.src.simulator.pid_optimizer import simulate_with_pid, straight_line_score
        # Bad PID: no correction at all
        bad_traj = simulate_with_pid(kp=0.0, ki=0.0, kd=0.0, target_speed=1.0,
                                      n_steps=200, dt=0.01, initial_theta=0.1)
        # Good PID: strong proportional correction
        good_traj = simulate_with_pid(kp=3.0, ki=0.1, kd=0.05, target_speed=1.0,
                                       n_steps=200, dt=0.01, initial_theta=0.1)
        bad_score = straight_line_score(bad_traj)
        good_score = straight_line_score(good_traj)
        assert good_score < bad_score  # lower = better

    def test_with_initial_heading_offset(self):
        from apps.backend.src.simulator.pid_optimizer import simulate_with_pid
        traj = simulate_with_pid(kp=2.0, ki=0.0, kd=0.0, target_speed=1.0,
                                  n_steps=100, dt=0.01, initial_theta=0.3)
        # PID should correct back toward theta=0
        assert abs(traj[-1]["theta"]) < 0.3


class TestStraightLineScore:
    def test_perfect_straight_line_scores_zero(self):
        from apps.backend.src.simulator.pid_optimizer import straight_line_score
        traj = [{"x": i * 0.01, "y": 0.0, "theta": 0.0} for i in range(100)]
        score = straight_line_score(traj)
        assert score == 0.0

    def test_drifting_trajectory_scores_higher(self):
        from apps.backend.src.simulator.pid_optimizer import straight_line_score
        traj = [{"x": i * 0.01, "y": i * 0.005, "theta": 0.1} for i in range(100)]
        score = straight_line_score(traj)
        assert score > 0


class TestOptimizer:
    def test_optimize_returns_result(self):
        from apps.backend.src.simulator.pid_optimizer import optimize_pid
        result = optimize_pid(n_trials=20, n_steps=100, dt=0.01, target_speed=1.0)
        assert "best_gains" in result
        assert "best_score" in result
        assert "best_trajectory" in result
        assert "bad_trajectory" in result
        assert "kp" in result["best_gains"]
        assert "ki" in result["best_gains"]
        assert "kd" in result["best_gains"]

    def test_optimized_beats_zero_gains(self):
        from apps.backend.src.simulator.pid_optimizer import optimize_pid, straight_line_score
        result = optimize_pid(n_trials=50, n_steps=200, dt=0.01, target_speed=1.0)
        assert result["best_score"] < result["bad_score"]

    def test_optimizer_respects_bounds(self):
        from apps.backend.src.simulator.pid_optimizer import optimize_pid
        bounds = {"kp": (0.5, 2.0), "ki": (0.0, 0.5), "kd": (0.0, 0.2)}
        result = optimize_pid(n_trials=20, n_steps=100, dt=0.01, target_speed=1.0, bounds=bounds)
        assert 0.5 <= result["best_gains"]["kp"] <= 2.0
        assert 0.0 <= result["best_gains"]["ki"] <= 0.5
        assert 0.0 <= result["best_gains"]["kd"] <= 0.2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_pid_optimizer.py -v 2>&1 | head -15`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement pid_optimizer.py**

Create `apps/backend/src/simulator/pid_optimizer.py`:

```python
"""
PID Optimizer — Finds optimal PID gains for straight-line driving.

Demo flow: bad gains (no correction) → random search → good gains (straight line).
Uses differential drive kinematics directly (no MuJoCo dependency).
"""

import math
import random


def pid_step(error: float, prev_error: float, integral: float,
             kp: float, ki: float, kd: float, dt: float) -> tuple[float, dict]:
    """Single PID computation. Returns (correction, new_state)."""
    integral += error * dt
    derivative = (error - prev_error) / dt if dt > 0 else 0.0
    correction = kp * error + ki * integral + kd * derivative
    return correction, {"integral": integral, "prev_error": error}


def simulate_with_pid(kp: float, ki: float, kd: float,
                       target_speed: float = 1.0, n_steps: int = 200,
                       dt: float = 0.01, initial_theta: float = 0.1,
                       wheel_base: float = 0.17, wheel_radius: float = 0.0325) -> list[dict]:
    """Run a differential drive simulation with PID heading correction.

    The robot tries to drive straight (target heading = 0). The PID controller
    adjusts the left/right wheel speed difference to correct heading error.
    An initial_theta offset simulates the car starting slightly off-course.

    Returns a trajectory: list of {x, y, theta, v_linear, v_angular, timestamp}.
    """
    x, y, theta = 0.0, 0.0, initial_theta
    integral, prev_error = 0.0, 0.0
    trajectory = []

    for step in range(n_steps):
        # Heading error: how far from theta=0 (straight ahead)
        error = -theta  # negative because positive theta means drifting left, need right correction

        # PID correction → steering adjustment
        correction, state = pid_step(error, prev_error, integral, kp, ki, kd, dt)
        integral = state["integral"]
        prev_error = state["prev_error"]

        # Convert to wheel speeds: base speed ± steering correction
        # Correction > 0 means turn right (slow left, speed up right)
        base_angular_speed = target_speed / wheel_radius
        left_speed = base_angular_speed - correction
        right_speed = base_angular_speed + correction

        # Differential drive kinematics
        v_left = left_speed * wheel_radius
        v_right = right_speed * wheel_radius
        v_linear = (v_left + v_right) / 2.0
        v_angular = (v_right - v_left) / wheel_base

        x += v_linear * math.cos(theta) * dt
        y += v_linear * math.sin(theta) * dt
        theta += v_angular * dt

        trajectory.append({
            "x": round(x, 6),
            "y": round(y, 6),
            "theta": round(theta, 6),
            "v_linear": round(v_linear, 6),
            "v_angular": round(v_angular, 6),
            "timestamp": round((step + 1) * dt, 6),
        })

    return trajectory


def straight_line_score(trajectory: list[dict]) -> float:
    """Score a trajectory for straight-line driving. Lower = better.

    Penalizes: lateral drift (y deviation) + heading error (theta deviation).
    Uses mean absolute values so the score is interpretable.
    """
    if not trajectory:
        return float("inf")
    total_y = sum(abs(p["y"]) for p in trajectory)
    total_theta = sum(abs(p["theta"]) for p in trajectory)
    n = len(trajectory)
    return total_y / n + total_theta / n


def optimize_pid(n_trials: int = 100, n_steps: int = 200, dt: float = 0.01,
                  target_speed: float = 1.0, initial_theta: float = 0.1,
                  bounds: dict | None = None) -> dict:
    """Find optimal PID gains via random search.

    Runs n_trials simulations with random PID gains, each scored on
    straight-line driving quality. Returns the best gains + trajectories
    for before/after comparison.

    Args:
        n_trials: Number of random PID candidates to try
        n_steps: Steps per simulation
        dt: Time step
        target_speed: Target forward speed (m/s)
        initial_theta: Starting heading offset (radians) — simulates misalignment
        bounds: Dict of {param_name: (min, max)} for each PID gain

    Returns:
        {best_gains, best_score, best_trajectory, bad_gains, bad_score, bad_trajectory, trials_run}
    """
    if bounds is None:
        bounds = {"kp": (0.5, 5.0), "ki": (0.0, 1.0), "kd": (0.0, 0.5)}

    # First: generate the "bad" baseline (zero gains = no correction)
    bad_gains = {"kp": 0.0, "ki": 0.0, "kd": 0.0}
    bad_traj = simulate_with_pid(**bad_gains, target_speed=target_speed,
                                  n_steps=n_steps, dt=dt, initial_theta=initial_theta)
    bad_score = straight_line_score(bad_traj)

    # Random search
    best_gains = dict(bad_gains)
    best_score = bad_score
    best_traj = bad_traj

    for _ in range(n_trials):
        candidate = {
            "kp": random.uniform(*bounds["kp"]),
            "ki": random.uniform(*bounds["ki"]),
            "kd": random.uniform(*bounds["kd"]),
        }
        traj = simulate_with_pid(**candidate, target_speed=target_speed,
                                  n_steps=n_steps, dt=dt, initial_theta=initial_theta)
        score = straight_line_score(traj)
        if score < best_score:
            best_score = score
            best_gains = candidate
            best_traj = traj

    return {
        "best_gains": {k: round(v, 4) for k, v in best_gains.items()},
        "best_score": round(best_score, 6),
        "best_trajectory": best_traj,
        "bad_gains": bad_gains,
        "bad_score": round(bad_score, 6),
        "bad_trajectory": bad_traj,
        "trials_run": n_trials,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_pid_optimizer.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/simulator/pid_optimizer.py apps/backend/tests/test_pid_optimizer.py
git commit -m "feat: PID optimizer — controller, scorer, and random search for straight-line driving"
```

---

## Task 2: Optimize API Endpoint

**Files:**
- Modify: `apps/backend/src/routes_agent.py`
- Create: `apps/backend/tests/test_optimize_route.py`

**Context:** Add a single `POST /api/projects/{id}/simulator/optimize` endpoint that calls `optimize_pid()` and returns the result. This slots into the existing routes_agent.py alongside the other simulator endpoints. The endpoint is synchronous — 100 trials with 200 steps each runs in <1 second since it's pure Python kinematics (no MuJoCo physics).

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/test_optimize_route.py`:

```python
"""Integration test for the PID optimize endpoint."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(fresh_db):
    from apps.backend.src.main import app
    return TestClient(app)


@pytest.fixture
def project_id(client):
    resp = client.post("/api/projects", json={"name": "TestBot", "description": "Test"})
    assert resp.status_code == 200
    return resp.json()["id"]


class TestOptimizeEndpoint:
    def test_optimize_returns_result(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/simulator/optimize", json={
            "n_trials": 20,
            "n_steps": 100,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "best_gains" in data
        assert "best_score" in data
        assert "bad_score" in data
        assert "best_trajectory" in data
        assert "bad_trajectory" in data
        assert data["best_score"] <= data["bad_score"]

    def test_optimize_with_custom_bounds(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/simulator/optimize", json={
            "n_trials": 10,
            "n_steps": 50,
            "bounds": {"kp": [1.0, 3.0], "ki": [0.0, 0.5], "kd": [0.0, 0.2]},
        })
        assert resp.status_code == 200
        gains = resp.json()["best_gains"]
        assert 1.0 <= gains["kp"] <= 3.0

    def test_optimize_default_params(self, client, project_id):
        resp = client.post(f"/api/projects/{project_id}/simulator/optimize", json={})
        assert resp.status_code == 200
        assert resp.json()["trials_run"] == 100  # default
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_optimize_route.py -v 2>&1 | head -15`
Expected: FAIL — 404 or 422

- [ ] **Step 3: Add optimize endpoint to routes_agent.py**

Add these to `apps/backend/src/routes_agent.py`:

After the existing imports at the top, add:
```python
from .simulator.pid_optimizer import optimize_pid
```

Add this Pydantic model after the existing request models:
```python
class OptimizePIDReq(BaseModel):
    n_trials: int = 100
    n_steps: int = 200
    dt: float = 0.01
    target_speed: float = 1.0
    initial_theta: float = 0.1
    bounds: Optional[dict[str, list[float]]] = None
```

Add this endpoint after the existing `/simulator/compare` endpoint:
```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/test_optimize_route.py -v`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/bentontameling/VentureHacksSolus && python -m pytest apps/backend/tests/ --tb=short 2>&1 | tail -5`
Expected: No new failures

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes_agent.py apps/backend/tests/test_optimize_route.py
git commit -m "feat: POST /simulator/optimize endpoint for PID tuning"
```

---

## Task 3: Optimize UI in SimulatorTab

**Files:**
- Modify: `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx`

**Context:** Add an "Optimize PID" section to the existing SimulatorTab. The UI shows: (1) an Optimize button, (2) while running: a loading state, (3) when done: a result card with best gains + score improvement, and (4) a before/after trajectory overlay chart. The existing SimulatorTab already has Recharts imported and a parameter panel + trajectory chart.

- [ ] **Step 1: Read the existing SimulatorTab.tsx**

Read `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` to understand the current structure before modifying.

- [ ] **Step 2: Add optimization state + handler + UI**

Add the following to `SimulatorTab.tsx`:

**New state variables** (add after the existing state declarations around line 75):
```tsx
  // Optimization
  const [optimizing, setOptimizing] = useState(false)
  const [optimResult, setOptimResult] = useState<{
    best_gains: { kp: number; ki: number; kd: number }
    best_score: number
    bad_score: number
    best_trajectory: TrajectoryPoint[]
    bad_trajectory: TrajectoryPoint[]
    trials_run: number
  } | null>(null)
```

**New handler** (add after the `resetSimulator` callback):
```tsx
  const runOptimization = useCallback(async () => {
    if (!currentProjectId) return
    setOptimizing(true)
    setError(null)
    setOptimResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n_trials: 100, n_steps: 200 }),
      })
      if (!res.ok) throw new Error(`Optimization failed: ${res.statusText}`)
      const result = await res.json()
      setOptimResult(result)
      // Show the optimized trajectory in the main chart
      setTrajectory(result.best_trajectory)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
    } finally {
      setOptimizing(false)
    }
  }, [currentProjectId])
```

**New button** in the header bar (add after the existing "Run Simulation" button):
```tsx
          <button
            onClick={runOptimization}
            disabled={optimizing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-500 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {optimizing ? <LoadingSpinner size="sm" /> : <Play size={14} />}
            {optimizing ? 'Optimizing...' : 'Optimize PID'}
          </button>
```

**Result card** (add in the right panel, after the trajectory charts, before the Compare button):
```tsx
              {optimResult && (
                <Card title="Optimization Result">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-solus-text-dim">Score improvement</span>
                      <span className="text-sm font-mono font-semibold text-green-400">
                        {optimResult.bad_score.toFixed(4)} → {optimResult.best_score.toFixed(4)}
                        {' '}({((1 - optimResult.best_score / optimResult.bad_score) * 100).toFixed(0)}% better)
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(optimResult.best_gains).map(([key, value]) => (
                        <div key={key} className="bg-solus-elevated rounded px-2 py-1.5 text-center">
                          <div className="text-xs text-solus-text-muted">{key.toUpperCase()}</div>
                          <div className="text-sm font-mono font-semibold text-solus-accent">{value.toFixed(3)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-solus-text-muted">
                      Tested {optimResult.trials_run} candidates
                    </div>

                    {/* Before/After Trajectory Overlay */}
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                          <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'x (m)', position: 'insideBottom', offset: -5, style: { fontSize: 10, fill: '#94a3b8' } }} />
                          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'y (m)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                          <Tooltip contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                          <Line data={optimResult.bad_trajectory} dataKey="y" name="Before (no PID)" stroke="#ef4444" dot={false} strokeWidth={2} strokeDasharray="5 5" />
                          <Line data={optimResult.best_trajectory} dataKey="y" name="After (optimized)" stroke="#22c55e" dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </Card>
              )}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx
git commit -m "feat: Optimize PID button + before/after trajectory overlay in SimulatorTab"
```

---

## Parallelism Map

```
Task 1 (pid_optimizer.py)  ──sequential──▶  Task 2 (API endpoint)
                                                     │
Task 3 (Frontend UI)       ◀──depends on─────────────┘
```

Tasks 1 → 2 → 3, strictly sequential.

## Demo Script

After all tasks are done, the demo flow is:

1. Open Simulator tab
2. Click **"Optimize PID"** button
3. Wait ~1 second (100 trials × 200 steps of pure kinematics)
4. See result card: `Score: 0.0847 → 0.0012 (99% better)`
5. See before/after chart: red dashed line drifting vs green solid line straight
6. PID gains shown: `KP=2.341, KI=0.187, KD=0.092`
7. (Stretch) Click "Apply" to write gains to Context Model
