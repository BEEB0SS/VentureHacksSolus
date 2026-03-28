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

Copied from the Elegoo repo and renamed (originals have spaces: `Bottom Plate.stl` → `bottom_plate.stl`, etc.).

**Model structure:**
- `worldbody`: ground plane (checkered for visual reference) + rover body
- `rover` body: composite of 3 STL meshes for **visual geometry only** (`contype="0" conaffinity="0"` — no collision on meshes). A simple box geom is used for chassis collision geometry.
- 4 `wheel` bodies: cylinder geoms with hinge joints, attached to the rover chassis
  - Front-left, front-right, rear-left, rear-right
  - Wheels use cylinder collision geometry with appropriate friction
- 4 velocity-controlled motor actuators: `motor_fl`, `motor_fr`, `motor_rl`, `motor_rr`
  - The code enforces 4WD pairing: `ctrl[0]=ctrl[2]` (left pair), `ctrl[1]=ctrl[3]` (right pair)
  - This is simpler than tendon coupling and makes the MJCF straightforward

**Approximate dimensions (from Elegoo V4 specs):**
- Chassis: ~250mm x 150mm x 60mm (0.25 x 0.15 x 0.06 m)
- Wheel diameter: ~65mm (radius 0.0325m), width: ~25mm
- Total mass: ~500g (chassis 350g, each wheel 37.5g)
- Wheel base: ~150mm center-to-center left-right
- Wheel track: ~180mm front-to-rear

**Actuators:**
- 4 velocity actuators with `kv=20`, `ctrlrange=[-10, 10]` rad/s
- `kv=20` provides sufficient force for a 500g robot to accelerate realistically
- Code sets `ctrl[0]=ctrl[2]=left_speed` and `ctrl[1]=ctrl[3]=right_speed`

**Collision approach:**
- STL meshes are **visual only** (expensive as collision geometry in MuJoCo)
- Chassis collision: single box geom matching approximate dimensions
- Wheel collision: cylinder geoms (built-in MuJoCo primitive)
- Ground collision: plane geom with friction

### MuJoCo WASM Integration

**Package:** `mujoco-js` (npm) — the official Google DeepMind MuJoCo WASM bindings. This provides **physics only** — no rendering included.

**Rendering:** Custom Three.js integration. We add `three` and `@react-three/fiber` + `@react-three/drei` as dependencies. The `MuJoCoViewer` component maps MuJoCo geom/body transforms to Three.js meshes and updates them each frame.

**Coordinate system:** MuJoCo uses Z-up; Three.js uses Y-up. The viewer applies a -90° rotation around X to the root scene group.

**Initialization flow:**
1. Import `mujoco-js`: `import loadMujoco from 'mujoco-js'`
2. Call `const mj = await loadMujoco()` — loads the WASM binary
3. Fetch MJCF XML and STL files as `ArrayBuffer` from the Vite dev server (`/models/elegoo-rover.xml`, `/models/meshes/*.stl`)
4. Write files into Emscripten's in-memory virtual filesystem:
   ```js
   mj.FS.mkdir('/models')
   mj.FS.mkdir('/models/meshes')
   mj.FS.writeFile('/models/elegoo-rover.xml', xmlBytes)
   mj.FS.writeFile('/models/meshes/bottom_plate.stl', stlBytes)
   // ... etc for each mesh
   ```
5. Create MuJoCo model + simulation: `model = mj.Model.load('/models/elegoo-rover.xml')`, `sim = new mj.Simulation(model)`
6. Build Three.js scene: for each MuJoCo geom, create a corresponding Three.js mesh (box, cylinder, or loaded STL mesh). Store a mapping of `geom_id → Three.js Object3D`.
7. Set up `OrbitControls` from `@react-three/drei` for camera interaction
8. Start the render loop

**Render loop (requestAnimationFrame-based):**
```
each frame:
  if playing:
    for i in range(stepsPerFrame):  // stepsPerFrame = playback speed
      set ctrl values from UI
      mj_step(model, data)
    extract rover body position (x, y, theta) from data.qpos → append to trajectory
  for each geom in model:
    read geom transform from data
    update corresponding Three.js mesh position/rotation
  renderer.render(scene, camera)
```

The simulation does NOT run all N steps at once (would freeze browser). It steps incrementally each animation frame, so the user sees the robot move in real-time.

**WASM loading states:**
- `loading` — WASM binary downloading + initializing
- `ready` — Model loaded, simulation ready
- `error` — WASM failed to load (CSP, browser compat, etc.)
- On error, fall back to the existing backend differential drive simulation with a message: "3D viewer unavailable — using 2D simulation fallback"

**Simulation flow:**
1. User sets parameters in left panel → stored in React state
2. User clicks "Run Simulation" → sets `playing = true`, resets sim position
3. Each animation frame: apply `ctrl` values, step physics, update Three.js, record trajectory point
4. After `n_steps` frames (or user clicks Pause): stop stepping, trajectory array is complete
5. Trajectory feeds into existing Recharts charts below the viewer

**Parameter mapping:**
| UI Parameter | MuJoCo Property | How Applied |
|-------------|----------------|-------------|
| wheel_radius | Visual mesh scale only | Not dynamically changeable — requires model reload |
| motor_torque | Actuator `gear` ratio | Modify `model.actuator_gear` before stepping |
| friction | Wheel geom friction | Modify `model.geom_friction` for wheel geoms |
| left_speed | `data.ctrl[0]` and `data.ctrl[2]` | Set each frame before `mj_step` |
| right_speed | `data.ctrl[1]` and `data.ctrl[3]` | Set each frame before `mj_step` |
| n_steps | Total steps to simulate | Controls when `playing` stops |
| dt | `model.opt.timestep` | Set before simulation starts |

### SimulatorTab UI Changes

**Right panel layout (top to bottom):**
1. **Model source bar:** Three buttons — "Default Rover" (active), "Upload MJCF", "Import from Onshape"
2. **3D Viewer canvas:** ~400px tall, full width, with orbit/pan/zoom controls. Shows loading spinner during WASM init. Shows error message with fallback option on failure.
3. **Playback controls bar:** Play/Pause, speed slider (0.25x-4x), step counter showing `current_step / n_steps`, Reset
4. **Trajectory chart** (existing Recharts X-Y path)
5. **Velocity chart** (existing Recharts linear + angular)
6. **Compare button + Discrepancy table** (existing)

**Left panel:** Same parameter editor as before. "Run Simulation" behavior:
- If WASM loaded successfully → steps MuJoCo in the browser (primary path)
- If WASM failed → calls backend `/simulator/run` endpoint (fallback path)
- The switching is automatic based on a `wasmReady` boolean state

**Model loading:**
- "Default Rover" → fetches `public/models/elegoo-rover.xml` + meshes, loads into WASM VFS
- "Upload MJCF" → file input for `.xml` file + optional mesh files → loads into WASM VFS
- "Import from Onshape" → text input for URL → calls `POST /api/projects/{id}/simulator/import-onshape` → shows "Importing from Onshape..." → loads default model (mock). Validates URL starts with `https://cad.onshape.com/`.

### Backend Changes

**New endpoint (stub for Onshape):**

`POST /api/projects/{id}/simulator/import-onshape`
- Request: `{"url": "https://cad.onshape.com/documents/..."}`
- Response: `{"status": "success", "model_name": "elegoo-rover", "model_url": "/models/elegoo-rover.xml", "message": "Model imported successfully (demo mode)"}`
- Validates URL starts with `https://cad.onshape.com/`
- Implementation: Returns hardcoded success. Real Onshape integration added later.

**Existing endpoints unchanged.** The `/simulator/run` endpoint still works as a fallback when WASM is unavailable.

### Vite Configuration

May need adjustments for WASM:
- `vite-plugin-wasm` or `vite-plugin-top-level-await` if `mujoco-js` uses top-level await
- `optimizeDeps.exclude: ['mujoco-js']` to prevent Vite from pre-bundling the WASM module
- Verify `.wasm` MIME type is served correctly by Vite dev server (usually automatic)
- `public/` directory for static model assets (Vite serves these at root path)

### Electron Compatibility

The app is Electron-based. WASM in Electron's renderer generally works, but:
- If `contextIsolation` or strict CSP is enabled, WASM `eval`/`compile` may be blocked
- May need to adjust CSP in Electron's `webPreferences` to allow `wasm-eval`
- Test early — if Electron blocks WASM, the fallback to backend simulation ensures the demo still works

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/desktop/public/models/elegoo-rover.xml` | MJCF model definition for the Elegoo rover |
| `apps/desktop/public/models/meshes/bottom_plate.stl` | Chassis bottom mesh (renamed from `Bottom Plate.stl`) |
| `apps/desktop/public/models/meshes/top_plate.stl` | Chassis top mesh (renamed from `Top Plate.stl`) |
| `apps/desktop/public/models/meshes/dead_plate.stl` | Caster plate mesh (renamed from `Dead Plate.stl`) |
| `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx` | 3D viewer: mujoco-js init, Emscripten VFS loading, Three.js rendering, animation loop |
| `apps/desktop/src/renderer/components/simulator/ModelSourceBar.tsx` | Model source selector (Default / Upload / Onshape) |

### Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Integrate MuJoCoViewer + ModelSourceBar, dual sim path (WASM vs backend fallback) |
| `apps/desktop/package.json` | Add `mujoco-js`, `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three` |
| `apps/desktop/vite.config.ts` | Add WASM plugin / optimizeDeps exclude if needed |
| `apps/backend/src/routes_agent.py` | Add Onshape import stub endpoint |

### Existing Files (Read-Only References)

| File | Used For |
|------|----------|
| `apps/desktop/src/renderer/stores/projectStore.ts` | `useProjectStore` — `currentProjectId`, `queryAgent()` |
| `apps/desktop/src/renderer/constants/api.ts` | `API_BASE` constant |
| `apps/desktop/src/renderer/components/shared/Card.tsx` | Card wrapper |
| `apps/desktop/src/renderer/components/shared/LoadingSpinner.tsx` | Loading spinner |
| `apps/desktop/src/renderer/components/shared/EmptyState.tsx` | Empty state |

---

## Onshape Integration Interface

The mock endpoint has a clean interface so real integration can be added later without changing the frontend:

```python
# routes_agent.py
class OnshapeImportReq(BaseModel):
    url: str  # Onshape document URL

@router.post("/projects/{project_id}/simulator/import-onshape")
async def import_from_onshape(project_id: str, req: OnshapeImportReq):
    # Validate URL format
    if not req.url.startswith("https://cad.onshape.com/"):
        raise HTTPException(status_code=400, detail="Invalid Onshape URL")
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

1. User opens Simulator tab → sees 3D Elegoo rover on a ground plane (or loading spinner, then rover)
2. User clicks "Run Simulation" → rover drives forward in 3D, wheels spin, in real-time
3. User changes left/right speeds → rover turns in 3D
4. Trajectory chart below updates with data extracted from MuJoCo state
5. "Compare Sim vs Runtime" still works with discrepancy table
6. "Upload MJCF" loads a custom model into the viewer
7. "Import from Onshape" shows importing flow → loads default (mock)
8. Camera orbit/pan/zoom works via mouse
9. If WASM fails to load → graceful fallback to backend simulation with user notification
