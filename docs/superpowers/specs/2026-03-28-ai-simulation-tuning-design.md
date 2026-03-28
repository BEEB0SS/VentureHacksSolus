# AI-Driven Simulation Tuning — Design Spec

## Overview

Users type a natural language optimization goal (e.g., "Make the car follow a circular path", "Increase stability at high speeds", "Reduce energy consumption"). Gemini receives the current MJCF model XML, runtime parameters, and the goal. It reasons about what to change — modifying the MJCF XML, runtime parameters, PID gains, or control strategy — and returns the modified model + explanation. The frontend reloads the new model in MuJoCo WASM and shows before/after comparison.

## Goals

1. User types any optimization goal in plain English
2. Gemini analyzes the current model + goal and decides what to change
3. Gemini can modify anything: MJCF XML (body structure, geoms, actuators, friction, mass, joints) and/or runtime parameters (PID gains, wheel speeds, control strategy)
4. Frontend reloads the modified model and runs before/after simulation
5. Gemini explains what it changed and why

## Non-Goals

- Iterative optimization loops (single-shot reasoning only)
- Guaranteed optimal results (Gemini's best guess, not mathematically proven)
- Real-time parameter tuning during simulation

---

## Architecture

### Data Flow

```
User types goal → Frontend sends goal + current MJCF + params to backend
→ Backend sends to Gemini with structured prompt
→ Gemini returns: modified MJCF XML + modified params + explanation
→ Backend validates XML is parseable, returns to frontend
→ Frontend shows explanation, reloads MuJoCo WASM with new model
→ User clicks Before/After to compare old vs new simulation
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
  }
}
```

**Response:**
```json
{
  "new_mjcf": "<mujoco model=\"elegoo_smart_car_v4\">...</mujoco>",
  "new_params": {
    "left_speed": 4.0,
    "right_speed": 8.0,
    "pid_gains": { "kp": 2.5, "ki": 0.1, "kd": 0.3 },
    "target_speed": 0.8
  },
  "explanation": "To achieve a circular path with radius 0.5m, I adjusted the left/right wheel speed differential. The left wheel runs at 4.0 rad/s while the right runs at 8.0 rad/s, creating a consistent turning radius. I also increased wheel friction to 1.5 for better traction during turns and added PID gains to maintain the circular heading.",
  "changes_summary": [
    "Left wheel speed: 6.0 → 4.0 rad/s",
    "Wheel friction: 1.0 → 1.5",
    "Added PID heading control: kp=2.5, ki=0.1, kd=0.3"
  ],
  "mjcf_changed": true
}
```

### Gemini Prompt Structure

**System prompt:**
```
You are a robotics simulation engineer working with MuJoCo. Given a MuJoCo MJCF model XML and an optimization goal from the user, analyze the model and determine what changes are needed to achieve the goal.

You can modify:
- The MJCF XML itself: body structure, geom properties (size, mass, friction, position), actuator settings (kv, ctrlrange, gear), joint properties (damping, armature), solver options, timestep — anything in the XML.
- Runtime parameters: wheel speeds (left_speed, right_speed), PID controller gains (kp, ki, kd), target speed.

Rules:
- The model is a 4-wheel differential drive robot (Elegoo Smart Robot Car V4).
- 4 velocity actuators: act_lf, act_rf, act_lr, act_rr (left-front, right-front, left-rear, right-rear).
- Left pair (act_lf, act_lr) are controlled together. Right pair (act_rf, act_rr) are controlled together.
- The PID controller corrects heading error (theta) by adjusting left/right speed differential.
- Keep the model valid MuJoCo XML. Do not remove required elements.
- Be specific about what you changed and why.

Return your response as JSON with these fields:
- new_mjcf: The complete modified MJCF XML string (or null if no XML changes needed)
- new_params: { left_speed, right_speed, pid_gains: { kp, ki, kd }, target_speed }
- explanation: A clear explanation of what you changed and why
- changes_summary: Array of short bullet strings describing each change
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

### Frontend Changes

**SimulatorTab additions:**
1. The "Optimize" input already exists — reuse it
2. When user clicks "Run" on the optimize panel, call `POST /api/projects/{id}/simulator/ai-tune` instead of the current random-search endpoint
3. On response:
   - Show Gemini's explanation in a card
   - Show changes_summary as a bullet list
   - If `mjcf_changed`: write the new MJCF to a blob URL and reload it in the viewer via a new `loadModelFromXml()` method on MuJoCoViewerHandle
   - Update left/right speed + PID gains state from `new_params`
   - Before button: reload original MJCF + original params
   - After button: reload new MJCF + new params

**MuJoCoViewer additions:**
- Add `loadModelFromXml(xml: string)` to the imperative handle — destroys current model/data, writes new XML to VFS, loads it, rebuilds geom meshes

### Validation

Backend validates Gemini's response before returning to frontend:
- `new_mjcf` must be valid XML (basic parse check)
- `new_params` must have expected fields with numeric values
- If Gemini returns malformed JSON, retry once with a "fix your JSON" prompt
- If still broken, return error to frontend

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/backend/src/simulator/ai_tuner.py` | Gemini prompt construction, response parsing, XML validation |

### Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/routes_agent.py` | Add `POST /api/projects/{id}/simulator/ai-tune` endpoint |
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Wire optimize button to new endpoint, show explanation, handle model reload |
| `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx` | Add `loadModelFromXml()` to imperative handle |

---

## Success Criteria

1. User types "Make the car drive in a circle" → Gemini adjusts wheel speeds and/or model → car drives in a circle in the 3D viewer
2. User types "Make the car more stable" → Gemini adjusts friction, damping, mass distribution → car behaves more stably
3. User types "Optimize PID gains for straight-line driving" → Gemini returns tuned kp/ki/kd → car corrects heading
4. Before/After toggle shows the difference clearly
5. Gemini's explanation is shown to the user so they understand what changed
6. If MJCF was modified, the 3D viewer reloads with the new model geometry
