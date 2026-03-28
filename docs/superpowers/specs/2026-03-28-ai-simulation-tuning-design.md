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
  "mjcf_changed": true
}
```

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

Optimization goal: {goal}
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
| `apps/backend/src/simulator/ai_tuner.py` | Gemini prompt, response parsing, search execution, scoring |

### Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/routes_agent.py` | Add `POST /api/projects/{id}/simulator/ai-tune` endpoint |
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Wire optimize to new endpoint, show Gemini explanation + search results |
| `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx` | Add `loadModelFromXml()` to imperative handle |

---

## Success Criteria

1. User types "Make the car drive in a circle" → Gemini designs search (left_speed range, circle-radius scoring) → search finds best params → car drives in circle in 3D viewer
2. User types "Drive straight with minimal drift" → Gemini designs PID search + straight-line scoring → car corrects heading
3. User types "Make the car more stable at high speeds" → Gemini modifies MJCF (increases friction, damping) + searches speed ranges → car is stable
4. Before/After toggle shows clear improvement with score numbers
5. Gemini's explanation is displayed so user understands the strategy
6. Search space and scoring function are visible to the user
7. If MJCF was modified, the 3D viewer reloads with updated model
