# AI-Driven Simulation Tuning — Design Spec

## Overview

Users type a natural language optimization goal (e.g., "Make the car follow a circular path", "Increase stability at high speeds", "Minimize energy while reaching (1,0)"). The backend sends the goal + current MJCF XML + parameters to Gemini, which reasons about the problem and returns a **search strategy**: what parameters to tune, what ranges to search, how to score each trial, and optionally a modified MJCF. The backend then executes the search — running N simulations across the parameter space Gemini defined — and returns the best result with before/after trajectories and Gemini's explanation.

## Goals

1. User types any optimization goal in plain English
2. Gemini analyzes the model + goal and designs the search: which parameters to tune, what ranges, and a scoring function
3. Gemini can modify the MJCF XML itself (friction, mass, actuators, body structure — anything)
4. Backend executes the parameter search using the existing kinematic simulator (fast, no MuJoCo dependency on server)
5. Best result returned with before/after trajectories + explanation
6. Frontend reloads modified model in MuJoCo WASM and shows comparison

## Non-Goals

- Multi-round Gemini iteration (Gemini reasons once, search executes mechanically)
- Server-side MuJoCo physics (search uses kinematic sim for speed)
- Guaranteed globally optimal results

---

## Context Model Integration

The Robotics Context Model graph (entities + relations) is central to Solus. The AI tuner integrates with it at three levels:

### 1. Graph as Context for Gemini

When Gemini reasons about the optimization goal, it receives the project's context model graph alongside the MJCF and parameters. This lets Gemini reason about the full system:

- "The DRV8825 motor driver has max current 2.5A — actuator torque should stay within that"
- "The NEMA17 motor has rated torque 0.44Nm — I should constrain the search range accordingly"
- "The 12V battery limits the voltage available to motors"
- "motor_controller.py subscribes to /cmd_vel — the PID output should match that interface"

The graph is retrieved via `ContextEngine(project_id).get_full_graph()` and serialized as a compact summary in the Gemini prompt.

### 2. Graph-Informed Constraints

Gemini uses the graph to set physically realistic constraints on the search space. For example:

- If an entity `Battery (12V, 2000mAh)` exists → Gemini constrains motor voltage/current ranges
- If a relation `DRV8825 --drives--> NEMA17` exists with metadata `{max_current: 1.5A}` → Gemini limits actuator force accordingly
- If `motor_controller.py --subscribes_to--> /cmd_vel` → Gemini knows the control interface

These constraints appear in the `explanation` and `changes_summary` so the user sees *why* certain ranges were chosen.

### 3. Graph Updates After Tuning

After the search completes and the user accepts the optimized parameters:

- If the MJCF was modified (e.g., friction changed, mass redistributed), the backend creates ChangeEvents in the context model recording what changed
- New entities can be created (e.g., if Gemini adds a geom to the MJCF, a corresponding entity appears in the graph)
- Relations are updated if component connections changed
- This feeds back into Demo A (Change Propagation) — the graph shows what was modified by the AI tuner and what might be impacted

The graph update is triggered by the frontend calling a new endpoint `POST /api/projects/{id}/simulator/apply-tune` after the user clicks "Apply" on the optimization result.

---

## Architecture

### Two-Phase Flow

**Phase 1: Gemini designs the search (AI reasoning)**
```
User goal + current MJCF + params → Gemini
→ Returns: search_space, scoring_function, base_mjcf, explanation
```

**Phase 2: Backend executes the search (mechanical)**
```
For each of N trials:
  Sample parameters from search_space
  Run kinematic simulation with sampled params
  Score trajectory using Gemini's scoring function
Return best trial + before/after trajectories
```

### Backend Endpoint

`POST /api/projects/{id}/simulator/ai-tune`

**Request:**
```json
{
  "goal": "Make the car follow a circular path with radius 0.5m",
  "current_mjcf": "<mujoco model=\"elegoo_smart_car_v4\">...</mujoco>",
  "current_params": {
    "left_speed": 6.0,
    "right_speed": 8.0,
    "pid_gains": { "kp": 0, "ki": 0, "kd": 0 },
    "target_speed": 1.0
  },
  "n_trials": 200
}
```

The backend automatically fetches the project's context model graph and includes it in the Gemini prompt. The graph is NOT sent from the frontend — the backend reads it via `ContextEngine(project_id).get_full_graph()`.
```

**Response:**
```json
{
  "new_mjcf": "<mujoco ...>...</mujoco>",
  "new_params": {
    "left_speed": 4.2,
    "right_speed": 8.0,
    "pid_gains": { "kp": 1.8, "ki": 0.05, "kd": 0.2 },
    "target_speed": 0.8
  },
  "best_score": 0.023,
  "baseline_score": 1.45,
  "best_trajectory": [...],
  "baseline_trajectory": [...],
  "trials_run": 200,
  "explanation": "To achieve a circular path, I defined a search over left_speed (2-7 rad/s) while keeping right_speed fixed at 8.0. The scoring function measures how close the trajectory's curvature matches the target radius of 0.5m. I also increased wheel friction to 1.5 in the MJCF for better traction during turns.",
  "changes_summary": [
    "Search: left_speed ∈ [2.0, 7.0], pid.kp ∈ [0.5, 3.0]",
    "MJCF: wheel friction 1.0 → 1.5",
    "Best: left_speed=4.2, kp=1.8, score=0.023"
  ],
  "search_space": {
    "left_speed": [2.0, 7.0],
    "pid_kp": [0.5, 3.0],
    "pid_ki": [0.0, 0.2],
    "pid_kd": [0.0, 0.5]
  },
  "mjcf_changed": true,
  "graph_constraints_used": [
    "Battery 12V limits motor voltage",
    "DRV8825 max current 2.5A constrains actuator force"
  ]
}
```

### Graph Update Endpoint (post-optimization)

`POST /api/projects/{id}/simulator/apply-tune`

Called when user clicks "Apply" to accept the optimized result. Records changes in the context model.

**Request:**
```json
{
  "new_mjcf": "<mujoco ...>...</mujoco>",
  "new_params": { ... },
  "changes_summary": ["wheel friction 1.0 → 1.5", "actuator kv 20 → 25"]
}
```

**Backend logic:**
1. If `mjcf_changed`: diff the old and new MJCF to find what properties changed
2. For each change, create a `ChangeEvent` in the context model:
   - `change_type`: "modified"
   - `entity_name`: the affected component (e.g., "wheel_lf_geom")
   - `description`: "AI tuner changed friction from 1.0 to 1.5"
3. If new geoms/bodies were added to the MJCF, create new entities in the graph
4. Run impact analysis on modified entities to show downstream effects
5. Return `{ "changes_logged": N, "impacted_entities": [...] }`

### Gemini Prompt Structure

**System prompt:**
```
You are a robotics simulation engineer. Given a MuJoCo MJCF model and an optimization goal, design a parameter search strategy to achieve the goal.

You have two powers:
1. MODIFY THE MODEL: You can change the MJCF XML — friction, mass, actuator kv, damping, body structure, geom sizes, anything. Return the full modified XML.
2. DESIGN THE SEARCH: Define which runtime parameters to search over, their ranges, and a scoring function (as a Python expression) that evaluates trajectory quality. Lower score = better.

The robot is a 4-wheel differential drive car (Elegoo Smart Robot Car V4):
- 4 velocity actuators: act_lf, act_rf, act_lr, act_rr
- Left pair controlled together, right pair controlled together
- Optional PID heading controller: corrects theta error via left/right speed differential

Searchable parameters (you pick which ones and what ranges):
- left_speed: left wheel angular velocity (rad/s)
- right_speed: right wheel angular velocity (rad/s)
- pid_kp: proportional gain
- pid_ki: integral gain
- pid_kd: derivative gain
- target_speed: desired forward speed (m/s)
- initial_theta: starting heading offset (radians)

The scoring function receives a trajectory (list of {x, y, theta, v_linear, v_angular, timestamp}) and must return a float. Lower = better. Write it as a Python lambda or expression using these variables:
- traj: the full trajectory list
- p: a single trajectory point (use in list comprehensions)

Examples of scoring functions:
- Straight line: "sum(abs(p['y']) + abs(p['theta']) for p in traj) / len(traj)"
- Circle radius R: "sum(abs(math.sqrt(p['x']**2 + p['y']**2) - R) for p in traj) / len(traj)"
- Reach target: "math.sqrt((traj[-1]['x'] - tx)**2 + (traj[-1]['y'] - ty)**2)"
- Minimize energy: "sum(abs(p['v_angular']) for p in traj) / len(traj)"

Return JSON with these fields:
- new_mjcf: Complete modified MJCF XML string, or null if no XML changes needed
- search_space: Dict of {param_name: [min, max]} for parameters to search
- scoring_function: Python expression string that scores a trajectory (lower = better)
- fixed_params: Dict of parameters to hold constant (not searched)
- explanation: What you changed in the model and why you chose this search strategy
- changes_summary: Array of short bullet strings
- mjcf_changed: boolean
```

**User prompt:**
```
Current MJCF model:
{current_mjcf}

Current parameters:
{current_params}

Project Context Model (entities and relations in this robot system):
{graph_summary}

Use the context model to inform your constraints. For example, if a battery entity
shows 12V capacity, don't suggest parameters that would exceed that. If a motor
driver has a max current rating, constrain actuator forces accordingly.

Optimization goal: {goal}
```

The `{graph_summary}` is built by the backend from `ContextEngine.get_full_graph()`:
```
Entities:
- DRV8825 (electrical_part): Stepper motor driver, max 2.5A, 8.2-45V
- NEMA17 (mechanical_part): Stepper motor, 0.44Nm rated torque
- motor_controller.py (software_module): Stepper control code
- ESP32 (electrical_part): Main microcontroller
- Battery (electrical_part): 12V, 2000mAh LiPo

Relations:
- DRV8825 --drives--> NEMA17
- motor_controller.py --depends_on--> DRV8825
- ESP32 --connected_to--> DRV8825
- Battery --connected_to--> ESP32
```

### Search Execution (ai_tuner.py)

After Gemini responds:

1. Parse Gemini's JSON response
2. If `mjcf_changed`: validate the new XML is parseable
3. Compile the `scoring_function` string into a callable Python function (using `eval` with a restricted namespace containing only `math` and `traj`)
4. Run the baseline: simulate with current params, score it
5. Run N trials:
   - For each trial, sample each parameter uniformly from its `[min, max]` range
   - Merge sampled params with `fixed_params`
   - Run `simulate_with_pid()` from the existing kinematic simulator
   - Score the trajectory using Gemini's scoring function
   - Track best
6. Return best params + trajectories + scores

**Security note on eval:** The scoring function comes from Gemini (not user input) and runs in a restricted namespace with only `math` imported. No `os`, `sys`, `subprocess`, etc. For extra safety, wrap in a timeout.

### Frontend Changes

**SimulatorTab:**
1. Reuse existing "Optimize" input and button
2. On click: send goal + current MJCF (fetched from `/models/elegoo-rover.xml`) + current params to `POST /simulator/ai-tune`
3. On response:
   - Store `optimResult` with new fields (explanation, changes_summary, search_space, scores)
   - Show explanation card with Gemini's reasoning
   - Show changes_summary as bullets
   - Show search_space that was explored
   - Show score improvement: baseline_score → best_score
   - Before/After toggle:
     - Before: reload original MJCF + baseline params → run in viewer
     - After: reload new MJCF (if changed) + best params → run in viewer
4. If `mjcf_changed`: call `viewerRef.current?.loadModelFromXml(new_mjcf)` to reload the 3D model

**MuJoCoViewer:**
- Add `loadModelFromXml(xml: string)` to imperative handle:
  1. Pause simulation
  2. Delete old model/data
  3. Write new XML to VFS
  4. Load new model + data
  5. Rebuild geom meshes
  6. Reset trajectory

### Validation

- Gemini's `new_mjcf` must parse as valid XML
- `scoring_function` must compile without errors (test with empty trajectory)
- `search_space` must have at least one parameter with valid `[min, max]` range
- If Gemini returns malformed JSON, retry once with "fix your JSON" prompt
- If scoring function throws during a trial, skip that trial (don't crash the search)

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/simulator/ai_tuner.py` | Gemini prompt (with graph context), response parsing, search execution, scoring |

### Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/routes_agent.py` | Add `POST /simulator/ai-tune` and `POST /simulator/apply-tune` endpoints |
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Wire optimize to new endpoint, show explanation + graph constraints, Apply button |
| `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx` | Add `loadModelFromXml()` to imperative handle |

### Existing Files Used

| File | How Used |
|------|----------|
| `apps/backend/src/context_engine.py` | `get_full_graph()` for Gemini prompt context; entity CRUD + ChangeEvent creation for graph updates |
| `apps/backend/src/simulator/pid_optimizer.py` | `simulate_with_pid()` reused for kinematic search trials |
| `apps/backend/src/agent/solus_agent.py` | Gemini API pattern reused (import, configure, generate_content) |

---

## Success Criteria

1. User types "Make the car drive in a circle" → Gemini designs search (left_speed range, circle-radius scoring) → search finds best params → car drives in circle in 3D viewer
2. User types "Drive straight with minimal drift" → Gemini designs PID search + straight-line scoring → car corrects heading
3. User types "Make the car more stable at high speeds" → Gemini modifies MJCF (increases friction, damping) + searches speed ranges → car is stable
4. Gemini references project graph entities in its reasoning (e.g., "DRV8825 max current constrains actuator force")
5. `graph_constraints_used` in the response shows which graph entities informed the search
6. Before/After toggle shows clear improvement with score numbers
7. Gemini's explanation is displayed so user understands the strategy
8. Search space and scoring function are visible to the user
9. If MJCF was modified, the 3D viewer reloads with updated model
10. "Apply" button records changes in the context model graph as ChangeEvents
11. Impact analysis runs on modified entities, showing downstream effects in the Context Model tab
