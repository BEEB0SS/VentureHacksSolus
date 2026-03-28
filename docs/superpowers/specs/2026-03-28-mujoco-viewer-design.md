# MuJoCo WASM Viewer — Design Spec

## Overview

Embed a real MuJoCo physics simulation in the SimulatorTab, running entirely in the browser via WebAssembly. The Elegoo Smart Robot Car V4.0 is modeled using its real STL chassis meshes with simplified wheel joints and motor actuators. Users adjust parameters, run physics simulation in MuJoCo WASM, and see the robot drive in 3D — with trajectory charts and discrepancy analysis below.

## Goals

1. Show a 3D robot driving in real-time physics simulation in the browser
2. Use the actual Elegoo rover chassis meshes for visual fidelity
3. Let users adjust motor/physics parameters and see the effect immediately
4. Extract trajectory data from MuJoCo state for charts and sim-vs-runtime comparison
5. Support loading custom MJCF models (upload) and mock Onshape import for future integration

## Non-Goals

- Precisely calibrated physics matching the real hardware (approximate is fine for hackathon)
- Real Onshape API integration (mock only — clean interface for later)
- Server-side MuJoCo rendering (everything runs client-side in WASM)

---

## Architecture

### MJCF Model File

**File:** `apps/desktop/public/models/elegoo-rover.xml`

**STL Assets:** `apps/desktop/public/models/meshes/bottom_plate.stl`, `top_plate.stl`, `dead_plate.stl`

Copied from the Elegoo repo (`/tmp/ELEGOO-Smart-Robot-Car-Kit-V4.0/Smart Robot Car 3D model.zip`).

**Model structure:**
- `worldbody`: ground plane + rover body
- `rover` body: composite of 3 STL meshes (bottom plate, top plate, dead/caster plate) positioned relative to each other
- 4 `wheel` bodies: cylinders with hinge joints, attached to the rover chassis
  - Front-left, front-right: driven by left/right motor actuators
  - Rear-left, rear-right: driven by same motor groups (4WD, matching real rover)
- 2 velocity-controlled motor actuators: `motor_left` (controls left pair), `motor_right` (controls right pair)
- Contact/friction between wheels and ground plane

**Approximate dimensions (from Elegoo V4 specs):**
- Chassis: ~250mm x 150mm x 60mm
- Wheel diameter: ~65mm, width: ~25mm
- Total mass: ~500g
- Wheel base: ~150mm (center-to-center, left-right)
- Wheel track: ~180mm (front-to-rear)

**Actuators:**
- `motor_left`: velocity actuator on left wheel joints, kv=1.0, ctrlrange=[-10, 10] rad/s
- `motor_right`: velocity actuator on right wheel joints, kv=1.0, ctrlrange=[-10, 10] rad/s

### MuJoCo WASM Integration

**Package:** `mujoco-wasm` (npm) — MuJoCo compiled to WebAssembly with Three.js rendering

**Initialization flow:**
1. Import `mujoco-wasm` module
2. Load the MJCF XML file + STL mesh assets
3. Create a MuJoCo simulation instance
4. Attach a Three.js renderer to a `<canvas>` element
5. Set up camera orbit controls (mouse drag to rotate, scroll to zoom)

**Simulation flow:**
1. User sets parameters → update actuator controls (`ctrl[0]` = left speed, `ctrl[1]` = right speed)
2. User clicks "Run Simulation" → call `mj_step()` N times, rendering each frame
3. After each step, extract body position (x, y, theta from rover body qpos) → build trajectory array
4. Trajectory feeds into the existing Recharts charts below

**Parameter mapping:**
| UI Parameter | MuJoCo Property |
|-------------|----------------|
| wheel_radius | Wheel geom size (visual only — affects mesh scale) |
| motor_torque | Actuator `forcerange` / `gear` |
| friction | Ground plane + wheel geom friction |
| left_speed | `ctrl[0]` — left motor actuator |
| right_speed | `ctrl[1]` — right motor actuator |
| n_steps | Number of `mj_step()` calls |
| dt | `model.opt.timestep` |

### SimulatorTab UI Changes

**Right panel layout (top to bottom):**
1. **Model source bar:** Three buttons — "Default Rover" (active), "Upload MJCF", "Import from Onshape"
2. **3D Viewer canvas:** ~400px tall, full width, with orbit controls
3. **Playback controls bar:** Play/Pause, speed slider (0.25x-4x), step count, Reset
4. **Trajectory chart** (existing Recharts X-Y path)
5. **Velocity chart** (existing Recharts linear + angular)
6. **Compare button + Discrepancy table** (existing)

**Left panel:** Same parameter editor as before, but "Run Simulation" now steps MuJoCo instead of calling the backend.

**Model loading:**
- "Default Rover" → loads `public/models/elegoo-rover.xml` (bundled)
- "Upload MJCF" → file input for `.xml` file → loads into WASM instance
- "Import from Onshape" → text input for URL → shows "Importing from Onshape..." toast → loads default model (mock). Clean interface: the handler calls `POST /api/projects/{id}/simulator/import-onshape` which returns success. Future integration replaces the mock with real Onshape API + STEP-to-MJCF conversion.

### Backend Changes

**New endpoint (stub for Onshape):**

`POST /api/projects/{id}/simulator/import-onshape`
- Request: `{"url": "https://cad.onshape.com/documents/..."}`
- Response: `{"status": "success", "model_name": "elegoo-rover", "message": "Model imported successfully"}`
- Implementation: Returns hardcoded success. Real Onshape integration added later.

**Existing endpoints unchanged.** The `/simulator/run` endpoint still works for the differential drive math fallback, but the primary simulation path is now MuJoCo WASM in the browser.

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/desktop/public/models/elegoo-rover.xml` | MJCF model definition for the Elegoo rover |
| `apps/desktop/public/models/meshes/bottom_plate.stl` | Chassis bottom mesh (from Elegoo repo) |
| `apps/desktop/public/models/meshes/top_plate.stl` | Chassis top mesh (from Elegoo repo) |
| `apps/desktop/public/models/meshes/dead_plate.stl` | Caster/dead plate mesh (from Elegoo repo) |
| `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx` | 3D viewer component wrapping mujoco-wasm + Three.js canvas |
| `apps/desktop/src/renderer/components/simulator/ModelSourceBar.tsx` | Model source selector (Default / Upload / Onshape) |

### Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Integrate MuJoCoViewer + ModelSourceBar, change "Run" to step MuJoCo |
| `apps/desktop/package.json` | Add `mujoco-wasm` dependency |
| `apps/backend/src/routes_agent.py` | Add Onshape import stub endpoint |

---

## Onshape Integration Interface

The mock endpoint has a clean interface so real integration can be added later without changing the frontend:

```python
# routes_agent.py
class OnshapeImportReq(BaseModel):
    url: str  # Onshape document URL

@router.post("/projects/{project_id}/simulator/import-onshape")
async def import_from_onshape(project_id: str, req: OnshapeImportReq):
    # TODO: Replace with real Onshape API integration
    # Real flow: OAuth → export STEP → convert to MJCF → return model
    return {
        "status": "success",
        "model_name": "elegoo-rover",
        "model_url": "/models/elegoo-rover.xml",
        "message": "Model imported successfully (demo mode)",
    }
```

When the real Onshape API is added, this endpoint would:
1. Authenticate via OAuth
2. Call Onshape export API to get STEP file
3. Convert STEP → STL meshes → generate MJCF
4. Save to project assets
5. Return the model URL

The frontend already handles the response format — it just loads whatever model URL is returned.

---

## Success Criteria

1. User opens Simulator tab → sees 3D Elegoo rover on a ground plane
2. User clicks "Run Simulation" → rover drives forward in 3D, wheels spin
3. User changes left/right speeds → rover turns in 3D
4. Trajectory chart below updates with data extracted from MuJoCo state
5. "Compare Sim vs Runtime" still works with discrepancy table
6. "Upload MJCF" loads a custom model into the viewer
7. "Import from Onshape" shows importing flow → loads default (mock)
8. Camera orbit/pan/zoom works via mouse
