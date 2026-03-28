# MuJoCo WASM Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a real MuJoCo physics simulation in the SimulatorTab with 3D rendering of the Elegoo rover, running entirely in the browser via WebAssembly.

**Architecture:** `mujoco-js` (official DeepMind WASM bindings) provides physics. Three.js renders the scene with custom geom-to-mesh mapping. The MJCF model uses Elegoo STL meshes for visuals and primitive geometry for collision. A `MuJoCoViewer` React component encapsulates all WASM/Three.js logic. `ModelSourceBar` handles model loading (default/upload/Onshape mock). The existing `SimulatorTab` integrates both, with automatic fallback to backend simulation if WASM fails.

**Tech Stack:** mujoco-js (WASM), Three.js, React 19, TypeScript, Tailwind CSS v4, Recharts

**Parallelism:** Tasks 1, 2, and 3 are fully independent — dispatch all three simultaneously. Task 4 depends on Task 1 (needs MJCF + deps). Task 5 depends on Tasks 3 and 4. Task 6 depends on Task 5.

---

## File Structure

### Files to Create

| File | Responsibility |
|------|---------------|
| `apps/desktop/public/models/elegoo-rover.xml` | MJCF model for the Elegoo rover |
| `apps/desktop/public/models/meshes/bottom_plate.stl` | Chassis bottom mesh (copied + renamed) |
| `apps/desktop/public/models/meshes/top_plate.stl` | Chassis top mesh (copied + renamed) |
| `apps/desktop/public/models/meshes/dead_plate.stl` | Caster plate mesh (copied + renamed) |
| `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx` | 3D viewer: WASM init, VFS loading, Three.js rendering, animation loop |
| `apps/desktop/src/renderer/components/simulator/ModelSourceBar.tsx` | Model source selector (Default / Upload / Onshape mock) |

### Files to Modify

| File | Change |
|------|--------|
| `apps/desktop/package.json` | Add mujoco-js, three, @types/three |
| `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` | Integrate MuJoCoViewer + ModelSourceBar, dual sim path |
| `apps/backend/src/routes_agent.py` | Add Onshape import stub endpoint |

---

## Task 1: MJCF Model + STL Assets + Dependencies

**Files:**
- Create: `apps/desktop/public/models/elegoo-rover.xml`
- Create: `apps/desktop/public/models/meshes/bottom_plate.stl`
- Create: `apps/desktop/public/models/meshes/top_plate.stl`
- Create: `apps/desktop/public/models/meshes/dead_plate.stl`
- Modify: `apps/desktop/package.json`

**Context:** The MJCF model defines the Elegoo rover for MuJoCo. STL meshes are visual-only (collision uses primitives). Dependencies must be installed before the MuJoCoViewer can be built. This task has NO code dependencies on other tasks.

**Can run in parallel with:** Tasks 2 and 3.

- [ ] **Step 1: Install npm dependencies**

Run:
```bash
cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-viewer/apps/desktop
pnpm add mujoco-js three
pnpm add -D @types/three
```

- [ ] **Step 2: Copy and rename STL meshes**

Run:
```bash
mkdir -p apps/desktop/public/models/meshes
cp "/tmp/elegoo-3d/Smart Robot Car 3D model/Bottom Plate.stl" apps/desktop/public/models/meshes/bottom_plate.stl
cp "/tmp/elegoo-3d/Smart Robot Car 3D model/Top Plate.stl" apps/desktop/public/models/meshes/top_plate.stl
cp "/tmp/elegoo-3d/Smart Robot Car 3D model/Dead Plate.stl" apps/desktop/public/models/meshes/dead_plate.stl
```

If the `/tmp/elegoo-3d` directory doesn't exist, extract from the Elegoo repo first:
```bash
cd /tmp && git clone --depth 1 https://github.com/elegooofficial/ELEGOO-Smart-Robot-Car-Kit-V4.0.git 2>/dev/null
unzip -o "/tmp/ELEGOO-Smart-Robot-Car-Kit-V4.0/Smart Robot Car 3D model.zip" -d /tmp/elegoo-3d
```

- [ ] **Step 3: Create the MJCF model file**

Create `apps/desktop/public/models/elegoo-rover.xml`:

```xml
<mujoco model="elegoo-rover-v4">
  <compiler angle="radian" meshdir="meshes"/>

  <option timestep="0.01" gravity="0 0 -9.81" integrator="implicit"/>

  <asset>
    <!-- Visual meshes from Elegoo STL files -->
    <mesh name="bottom_plate" file="bottom_plate.stl" scale="0.001 0.001 0.001"/>
    <mesh name="top_plate" file="top_plate.stl" scale="0.001 0.001 0.001"/>
    <mesh name="dead_plate" file="dead_plate.stl" scale="0.001 0.001 0.001"/>

    <!-- Materials -->
    <material name="chassis_mat" rgba="0.2 0.2 0.25 1"/>
    <material name="wheel_mat" rgba="0.1 0.1 0.1 1"/>
    <material name="ground_mat" rgba="0.4 0.4 0.4 1" texrepeat="10 10"/>

    <!-- Ground texture -->
    <texture name="grid" type="2d" builtin="checker" rgb1="0.3 0.3 0.35" rgb2="0.25 0.25 0.3" width="512" height="512"/>
    <material name="grid_mat" texture="grid" texrepeat="10 10" texuniform="true"/>
  </asset>

  <worldbody>
    <!-- Ground plane -->
    <geom name="ground" type="plane" size="5 5 0.1" material="grid_mat"/>
    <light pos="0 0 3" dir="0 0 -1" diffuse="0.8 0.8 0.8"/>
    <light pos="2 2 3" dir="-0.5 -0.5 -1" diffuse="0.4 0.4 0.4"/>

    <!-- Rover chassis -->
    <body name="rover" pos="0 0 0.05" euler="0 0 0">
      <joint name="rover_free" type="free"/>
      <inertial pos="0 0 0.02" mass="0.35" diaginertia="0.001 0.002 0.002"/>

      <!-- Collision box for chassis -->
      <geom name="chassis_collision" type="box" size="0.125 0.075 0.03" pos="0 0 0.02"
            rgba="0 0 0 0" contype="1" conaffinity="1"/>

      <!-- Visual meshes (no collision) -->
      <geom name="bottom_visual" type="mesh" mesh="bottom_plate" material="chassis_mat"
            contype="0" conaffinity="0" pos="0 0 0"/>
      <geom name="top_visual" type="mesh" mesh="top_plate" material="chassis_mat"
            contype="0" conaffinity="0" pos="0 0 0.04"/>
      <geom name="dead_visual" type="mesh" mesh="dead_plate" material="chassis_mat"
            contype="0" conaffinity="0" pos="0 0 0.01"/>

      <!-- Front-left wheel -->
      <body name="wheel_fl" pos="0.09 0.085 0">
        <joint name="joint_fl" type="hinge" axis="0 1 0" damping="0.01"/>
        <geom name="geom_fl" type="cylinder" size="0.0325 0.0125"
              euler="1.5708 0 0" material="wheel_mat"
              friction="1.0 0.005 0.001" contype="1" conaffinity="1" mass="0.0375"/>
      </body>

      <!-- Front-right wheel -->
      <body name="wheel_fr" pos="0.09 -0.085 0">
        <joint name="joint_fr" type="hinge" axis="0 1 0" damping="0.01"/>
        <geom name="geom_fr" type="cylinder" size="0.0325 0.0125"
              euler="1.5708 0 0" material="wheel_mat"
              friction="1.0 0.005 0.001" contype="1" conaffinity="1" mass="0.0375"/>
      </body>

      <!-- Rear-left wheel -->
      <body name="wheel_rl" pos="-0.09 0.085 0">
        <joint name="joint_rl" type="hinge" axis="0 1 0" damping="0.01"/>
        <geom name="geom_rl" type="cylinder" size="0.0325 0.0125"
              euler="1.5708 0 0" material="wheel_mat"
              friction="1.0 0.005 0.001" contype="1" conaffinity="1" mass="0.0375"/>
      </body>

      <!-- Rear-right wheel -->
      <body name="wheel_rr" pos="-0.09 -0.085 0">
        <joint name="joint_rr" type="hinge" axis="0 1 0" damping="0.01"/>
        <geom name="geom_rr" type="cylinder" size="0.0325 0.0125"
              euler="1.5708 0 0" material="wheel_mat"
              friction="1.0 0.005 0.001" contype="1" conaffinity="1" mass="0.0375"/>
      </body>
    </body>
  </worldbody>

  <!-- 4 velocity actuators, code enforces left/right pairing -->
  <actuator>
    <velocity name="motor_fl" joint="joint_fl" kv="20" ctrlrange="-10 10"/>
    <velocity name="motor_fr" joint="joint_fr" kv="20" ctrlrange="-10 10"/>
    <velocity name="motor_rl" joint="joint_rl" kv="20" ctrlrange="-10 10"/>
    <velocity name="motor_rr" joint="joint_rr" kv="20" ctrlrange="-10 10"/>
  </actuator>
</mujoco>
```

- [ ] **Step 4: Verify build still passes with new deps**

Run:
```bash
cd apps/desktop && npx vite build --mode development 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/public/models/ apps/desktop/package.json apps/desktop/pnpm-lock.yaml
git commit -m "feat: add Elegoo rover MJCF model + STL meshes + mujoco-js/three deps"
```

---

## Task 2: Onshape Import Stub Endpoint

**Files:**
- Modify: `apps/backend/src/routes_agent.py`
- Create: `apps/backend/tests/test_onshape_stub.py`

**Context:** A mock backend endpoint for Onshape import. Returns hardcoded success with the default model URL. Validates the URL starts with `https://cad.onshape.com/`. This task has NO dependencies on other tasks.

**Can run in parallel with:** Tasks 1 and 3.

- [ ] **Step 1: Write failing test**

Create `apps/backend/tests/test_onshape_stub.py`:

```python
"""Tests for the Onshape import stub endpoint."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from fastapi.testclient import TestClient


def _get_app():
    from fastapi import FastAPI
    from apps.backend.src.routes_agent import router
    app = FastAPI()
    app.include_router(router)
    return app


class TestOnshapeImport:
    def test_import_valid_url(self, project_id):
        client = TestClient(_get_app())
        response = client.post(f"/api/projects/{project_id}/simulator/import-onshape", json={
            "url": "https://cad.onshape.com/documents/abc123/w/def456/e/ghi789",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["model_name"] == "elegoo-rover"
        assert "model_url" in data

    def test_import_invalid_url(self, project_id):
        client = TestClient(_get_app())
        response = client.post(f"/api/projects/{project_id}/simulator/import-onshape", json={
            "url": "https://example.com/not-onshape",
        })
        assert response.status_code == 400

    def test_import_missing_url(self, project_id):
        client = TestClient(_get_app())
        response = client.post(f"/api/projects/{project_id}/simulator/import-onshape", json={})
        assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-viewer && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_onshape_stub.py -v 2>&1 | head -15`
Expected: FAIL — 404 (route doesn't exist yet)

- [ ] **Step 3: Add the Onshape stub endpoint to routes_agent.py**

Append to `apps/backend/src/routes_agent.py`, before the final line:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bentontameling/VentureHacksSolus/.worktrees/mujoco-viewer && source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/test_onshape_stub.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes_agent.py apps/backend/tests/test_onshape_stub.py
git commit -m "feat: Onshape import stub endpoint — mock with URL validation"
```

---

## Task 3: ModelSourceBar Component

**Files:**
- Create: `apps/desktop/src/renderer/components/simulator/ModelSourceBar.tsx`

**Context:** A row of three buttons (Default Rover / Upload MJCF / Import from Onshape) plus an Onshape URL input modal. This is a pure UI component with callbacks — it doesn't touch MuJoCo. It receives `onLoadDefault`, `onUploadFile`, and `onImportOnshape` callbacks from the parent.

**Can run in parallel with:** Tasks 1 and 2.

- [ ] **Step 1: Create ModelSourceBar component**

Create `apps/desktop/src/renderer/components/simulator/ModelSourceBar.tsx`:

```tsx
import { useState, useRef } from 'react'
import { Box, Upload, Globe, X } from 'lucide-react'
import { LoadingSpinner } from '../shared/LoadingSpinner'

interface ModelSourceBarProps {
  activeSource: 'default' | 'upload' | 'onshape'
  loading: boolean
  onLoadDefault: () => void
  onUploadFile: (xmlFile: File, meshFiles: File[]) => void
  onImportOnshape: (url: string) => void
}

export function ModelSourceBar({
  activeSource,
  loading,
  onLoadDefault,
  onUploadFile,
  onImportOnshape,
}: ModelSourceBarProps) {
  const [showOnshapeInput, setShowOnshapeInput] = useState(false)
  const [onshapeUrl, setOnshapeUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const xmlFile = files.find(f => f.name.endsWith('.xml'))
    if (!xmlFile) return
    const meshFiles = files.filter(f => f.name.endsWith('.stl') || f.name.endsWith('.obj'))
    onUploadFile(xmlFile, meshFiles)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleOnshapeSubmit = () => {
    if (!onshapeUrl.startsWith('https://cad.onshape.com/')) return
    onImportOnshape(onshapeUrl)
    setShowOnshapeInput(false)
    setOnshapeUrl('')
  }

  const btnBase = "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer"
  const btnActive = "bg-solus-accent/20 text-solus-accent-bright border border-solus-accent/40"
  const btnInactive = "text-solus-text-dim bg-solus-elevated border border-solus-border hover:bg-solus-surface"

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-solus-border bg-solus-surface/50">
      <span className="text-xs text-solus-text-muted mr-1">Model:</span>

      <button
        onClick={onLoadDefault}
        disabled={loading}
        className={`${btnBase} ${activeSource === 'default' ? btnActive : btnInactive}`}
      >
        <Box size={14} />
        Default Rover
      </button>

      <button
        onClick={handleUploadClick}
        disabled={loading}
        className={`${btnBase} ${activeSource === 'upload' ? btnActive : btnInactive}`}
      >
        <Upload size={14} />
        Upload MJCF
      </button>

      <button
        onClick={() => setShowOnshapeInput(true)}
        disabled={loading}
        className={`${btnBase} ${activeSource === 'onshape' ? btnActive : btnInactive}`}
      >
        <Globe size={14} />
        Import from Onshape
      </button>

      {loading && <LoadingSpinner size="sm" label="Loading model..." />}

      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.stl,.obj"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />

      {/* Onshape URL input overlay */}
      {showOnshapeInput && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-solus-surface border border-solus-border rounded-lg p-4 w-[480px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-solus-text">Import from Onshape</h3>
              <button onClick={() => setShowOnshapeInput(false)} className="text-solus-text-muted hover:text-solus-text cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-solus-text-muted mb-3">
              Paste the Onshape document URL to import your CAD model.
            </p>
            <input
              type="text"
              value={onshapeUrl}
              onChange={e => setOnshapeUrl(e.target.value)}
              placeholder="https://cad.onshape.com/documents/..."
              className="w-full bg-solus-elevated border border-solus-border rounded px-3 py-2 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowOnshapeInput(false)}
                className="px-3 py-1.5 text-xs text-solus-text-dim bg-solus-elevated border border-solus-border rounded-md hover:bg-solus-surface cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleOnshapeSubmit}
                disabled={!onshapeUrl.startsWith('https://cad.onshape.com/')}
                className="px-3 py-1.5 text-xs text-white bg-solus-accent rounded-md hover:bg-solus-accent-bright disabled:opacity-50 cursor-pointer"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd apps/desktop && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds (component isn't imported yet, but should have no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/simulator/ModelSourceBar.tsx
git commit -m "feat: ModelSourceBar — model source selector with upload + Onshape mock"
```

---

## Task 4: MuJoCoViewer Component

**Files:**
- Create: `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx`

**Context:** The core 3D viewer. Initializes mujoco-js WASM, loads MJCF + STL assets into Emscripten VFS, creates Three.js scene from MuJoCo geom data, runs the physics/render loop. This is the most complex component. It exposes imperative methods via `useImperativeHandle` for the parent to control (play/pause/reset/set controls).

**Depends on:** Task 1 (MJCF model + deps installed).

- [ ] **Step 1: Create the MuJoCoViewer component**

Create `apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx`:

```tsx
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { EmptyState } from '../shared/EmptyState'

// ── Types ──

export interface MuJoCoViewerHandle {
  play: () => void
  pause: () => void
  reset: () => void
  setControls: (leftSpeed: number, rightSpeed: number) => void
  setTimestep: (dt: number) => void
  isPlaying: () => boolean
  getTrajectory: () => TrajectoryPoint[]
  loadModelFromXml: (xml: string, meshFiles?: Map<string, ArrayBuffer>) => Promise<void>
}

export interface TrajectoryPoint {
  x: number
  y: number
  theta: number
  v_linear: number
  v_angular: number
  timestamp: number
  step: number
}

interface MuJoCoViewerProps {
  modelUrl?: string
  meshUrls?: string[]
  maxSteps?: number
  playbackSpeed?: number
  onTrajectoryUpdate?: (trajectory: TrajectoryPoint[]) => void
  onSimComplete?: () => void
  onError?: (error: string) => void
  onReady?: () => void
}

// ── Component ──

const MuJoCoViewer = forwardRef<MuJoCoViewerHandle, MuJoCoViewerProps>(({
  modelUrl = '/models/elegoo-rover.xml',
  meshUrls = [
    '/models/meshes/bottom_plate.stl',
    '/models/meshes/top_plate.stl',
    '/models/meshes/dead_plate.stl',
  ],
  maxSteps = 200,
  playbackSpeed = 1.0,
  onTrajectoryUpdate,
  onSimComplete,
  onError,
  onReady,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')

  // Refs for mutable state that persists across renders
  const mujocoRef = useRef<any>(null)
  const modelRef = useRef<any>(null)
  const dataRef = useRef<any>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const bodyMeshesRef = useRef<Map<number, THREE.Object3D>>(new Map())
  const animFrameRef = useRef<number>(0)
  const playingRef = useRef(false)
  const trajectoryRef = useRef<TrajectoryPoint[]>([])
  const stepCountRef = useRef(0)
  const maxStepsRef = useRef(maxSteps)
  const playbackSpeedRef = useRef(playbackSpeed)
  const leftSpeedRef = useRef(0)
  const rightSpeedRef = useRef(0)

  // Keep refs in sync with props
  useEffect(() => { maxStepsRef.current = maxSteps }, [maxSteps])
  useEffect(() => { playbackSpeedRef.current = playbackSpeed }, [playbackSpeed])

  // ── Initialize MuJoCo WASM + Three.js ──

  const initMujoco = useCallback(async () => {
    try {
      setStatus('loading')

      // Dynamically import mujoco-js
      const loadMujoco = (await import('mujoco-js')).default
      const mj = await loadMujoco()
      mujocoRef.current = mj

      // Create VFS directories
      try { mj.FS.mkdir('/models') } catch (e: any) { /* exists */ }
      try { mj.FS.mkdir('/models/meshes') } catch (e: any) { /* exists */ }

      // Fetch and write MJCF XML
      const xmlRes = await fetch(modelUrl)
      if (!xmlRes.ok) throw new Error(`Failed to fetch model: ${xmlRes.statusText}`)
      const xmlText = await xmlRes.text()
      mj.FS.writeFile('/models/elegoo-rover.xml', xmlText)

      // Fetch and write STL meshes
      for (const meshUrl of meshUrls) {
        const meshRes = await fetch(meshUrl)
        if (!meshRes.ok) throw new Error(`Failed to fetch mesh: ${meshUrl}`)
        const meshBuf = new Uint8Array(await meshRes.arrayBuffer())
        const meshPath = `/models/meshes/${meshUrl.split('/').pop()}`
        mj.FS.writeFile(meshPath, meshBuf)
      }

      // Load MuJoCo model
      const model = mj.Model.load('/models/elegoo-rover.xml')
      const data = new mj.Simulation(model)
      modelRef.current = model
      dataRef.current = data

      // Initialize Three.js
      initThreeJs()

      // Build scene from MuJoCo geoms
      buildSceneFromModel(mj, model, data)

      setStatus('ready')
      onReady?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize MuJoCo WASM'
      setStatus('error')
      setErrorMsg(msg)
      onError?.(msg)
    }
  }, [modelUrl, meshUrls, onReady, onError])

  // ── Three.js Setup ──

  const initThreeJs = useCallback(() => {
    if (!containerRef.current) return

    const width = containerRef.current.clientWidth
    const height = containerRef.current.clientHeight || 400

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a0f)
    // Rotate scene to convert MuJoCo Z-up to Three.js Y-up
    scene.rotation.x = -Math.PI / 2
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100)
    camera.position.set(0.5, 0.4, 0.5)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controlsRef.current = controls

    // Ambient + directional light
    scene.add(new THREE.AmbientLight(0x404050, 2))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
    dirLight.position.set(2, 3, 2)
    scene.add(dirLight)

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight || 400
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)
  }, [])

  // ── Build Three.js Scene from MuJoCo Model ──

  const buildSceneFromModel = useCallback((mj: any, model: any, data: any) => {
    if (!sceneRef.current) return
    const scene = sceneRef.current

    // Clear old meshes
    bodyMeshesRef.current.forEach(mesh => scene.remove(mesh))
    bodyMeshesRef.current.clear()

    const ngeom = model.ngeom

    for (let i = 0; i < ngeom; i++) {
      const geomType = model.geom_type[i]
      const geomSize = [model.geom_size[i * 3], model.geom_size[i * 3 + 1], model.geom_size[i * 3 + 2]]
      const geomRgba = [model.geom_rgba[i * 4], model.geom_rgba[i * 4 + 1], model.geom_rgba[i * 4 + 2], model.geom_rgba[i * 4 + 3]]
      const bodyId = model.geom_bodyid[i]

      // Skip invisible geoms (rgba alpha = 0, used for collision only)
      if (geomRgba[3] === 0) continue

      let geometry: THREE.BufferGeometry | null = null
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(geomRgba[0], geomRgba[1], geomRgba[2]),
        transparent: geomRgba[3] < 1,
        opacity: geomRgba[3],
      })

      // MuJoCo geom types: 0=plane, 2=sphere, 3=capsule, 5=cylinder, 6=box, 7=mesh
      switch (geomType) {
        case 0: // plane
          geometry = new THREE.PlaneGeometry(geomSize[0] * 2, geomSize[1] * 2)
          break
        case 2: // sphere
          geometry = new THREE.SphereGeometry(geomSize[0], 16, 16)
          break
        case 3: // capsule
          geometry = new THREE.CapsuleGeometry(geomSize[0], geomSize[1] * 2, 8, 16)
          break
        case 5: // cylinder
          geometry = new THREE.CylinderGeometry(geomSize[0], geomSize[0], geomSize[1] * 2, 16)
          geometry.rotateX(Math.PI / 2) // MuJoCo cylinder axis is Z, Three.js is Y
          break
        case 6: // box
          geometry = new THREE.BoxGeometry(geomSize[0] * 2, geomSize[1] * 2, geomSize[2] * 2)
          break
        case 7: // mesh — handled by STL loader, skip for now
          // Mesh geoms get their transform from the body, loaded separately
          continue
        default:
          continue
      }

      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)
        bodyMeshesRef.current.set(i, mesh)
      }
    }

    // Load STL meshes for mesh-type geoms
    const stlLoader = new STLLoader()
    const meshGeomIndices: number[] = []
    for (let i = 0; i < ngeom; i++) {
      if (model.geom_type[i] === 7) {
        meshGeomIndices.push(i)
      }
    }

    // Load each mesh asset from the URLs we have
    meshUrls.forEach((url, idx) => {
      stlLoader.load(url, (stlGeometry) => {
        if (idx < meshGeomIndices.length) {
          const geomIdx = meshGeomIndices[idx]
          const geomRgba = [
            model.geom_rgba[geomIdx * 4],
            model.geom_rgba[geomIdx * 4 + 1],
            model.geom_rgba[geomIdx * 4 + 2],
            model.geom_rgba[geomIdx * 4 + 3],
          ]
          const material = new THREE.MeshPhongMaterial({
            color: new THREE.Color(geomRgba[0], geomRgba[1], geomRgba[2]),
          })

          // Apply scale from MJCF (0.001 for mm→m conversion)
          const scale = model.mesh_scale ? [
            model.mesh_scale[idx * 3] || 1,
            model.mesh_scale[idx * 3 + 1] || 1,
            model.mesh_scale[idx * 3 + 2] || 1,
          ] : [0.001, 0.001, 0.001]

          stlGeometry.scale(scale[0], scale[1], scale[2])
          const mesh = new THREE.Mesh(stlGeometry, material)
          sceneRef.current?.add(mesh)
          bodyMeshesRef.current.set(geomIdx, mesh)
        }
      })
    })

    // Initial render
    renderFrame()
  }, [meshUrls])

  // ── Render Frame ──

  const renderFrame = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return
    controlsRef.current?.update()
    rendererRef.current.render(sceneRef.current, cameraRef.current)
  }, [])

  // ── Update Three.js Transforms from MuJoCo State ──

  const syncVisuals = useCallback(() => {
    const data = dataRef.current
    const model = modelRef.current
    if (!data || !model) return

    bodyMeshesRef.current.forEach((mesh, geomIdx) => {
      // Read geom transform from data.geom_xpos and data.geom_xmat
      const px = data.geom_xpos[geomIdx * 3 + 0]
      const py = data.geom_xpos[geomIdx * 3 + 1]
      const pz = data.geom_xpos[geomIdx * 3 + 2]
      mesh.position.set(px, py, pz)

      // Read 3x3 rotation matrix and convert to quaternion
      const m = data.geom_xmat
      const off = geomIdx * 9
      const mat4 = new THREE.Matrix4()
      mat4.set(
        m[off + 0], m[off + 3], m[off + 6], 0,
        m[off + 1], m[off + 4], m[off + 7], 0,
        m[off + 2], m[off + 5], m[off + 8], 0,
        0, 0, 0, 1,
      )
      const quat = new THREE.Quaternion()
      quat.setFromRotationMatrix(mat4)
      mesh.quaternion.copy(quat)
    })
  }, [])

  // ── Animation Loop ──

  const animationLoop = useCallback(() => {
    const mj = mujocoRef.current
    const model = modelRef.current
    const data = dataRef.current

    if (!mj || !model || !data) {
      animFrameRef.current = requestAnimationFrame(animationLoop)
      renderFrame()
      return
    }

    if (playingRef.current && stepCountRef.current < maxStepsRef.current) {
      // Steps per frame based on playback speed
      const stepsPerFrame = Math.max(1, Math.round(playbackSpeedRef.current))

      for (let i = 0; i < stepsPerFrame && stepCountRef.current < maxStepsRef.current; i++) {
        // Set actuator controls: left pair (0, 2), right pair (1, 3)
        data.ctrl[0] = leftSpeedRef.current
        data.ctrl[1] = rightSpeedRef.current
        data.ctrl[2] = leftSpeedRef.current
        data.ctrl[3] = rightSpeedRef.current

        // Step physics
        mj.mj_step(model, data)
        stepCountRef.current++

        // Extract rover body position for trajectory
        // Body 1 is the rover (body 0 is world)
        const roverBodyId = 1
        const x = data.xpos[roverBodyId * 3 + 0]
        const y = data.xpos[roverBodyId * 3 + 1]

        // Extract orientation (quaternion → yaw angle)
        const qw = data.xquat[roverBodyId * 4 + 0]
        const qx = data.xquat[roverBodyId * 4 + 1]
        const qy = data.xquat[roverBodyId * 4 + 2]
        const qz = data.xquat[roverBodyId * 4 + 3]
        const theta = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))

        // Compute velocities
        const vx = data.qvel[0] || 0
        const vy = data.qvel[1] || 0
        const v_linear = Math.sqrt(vx * vx + vy * vy)
        const v_angular = data.qvel[5] || 0 // angular velocity around z

        trajectoryRef.current.push({
          x, y, theta,
          v_linear, v_angular,
          timestamp: data.time,
          step: stepCountRef.current,
        })
      }

      onTrajectoryUpdate?.(trajectoryRef.current)

      if (stepCountRef.current >= maxStepsRef.current) {
        playingRef.current = false
        onSimComplete?.()
      }
    }

    syncVisuals()
    renderFrame()
    animFrameRef.current = requestAnimationFrame(animationLoop)
  }, [renderFrame, syncVisuals, onTrajectoryUpdate, onSimComplete])

  // ── Lifecycle ──

  useEffect(() => {
    initMujoco()
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      rendererRef.current?.dispose()
      dataRef.current?.delete?.()
      modelRef.current?.delete?.()
    }
  }, [initMujoco])

  useEffect(() => {
    if (status === 'ready') {
      animFrameRef.current = requestAnimationFrame(animationLoop)
    }
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [status, animationLoop])

  // ── Imperative Handle ──

  useImperativeHandle(ref, () => ({
    play: () => { playingRef.current = true },
    pause: () => { playingRef.current = false },
    reset: () => {
      const mj = mujocoRef.current
      const model = modelRef.current
      const data = dataRef.current
      if (mj && model && data) {
        mj.mj_resetData(model, data)
        mj.mj_forward(model, data)
      }
      playingRef.current = false
      stepCountRef.current = 0
      trajectoryRef.current = []
      onTrajectoryUpdate?.([])
    },
    setControls: (leftSpeed: number, rightSpeed: number) => {
      leftSpeedRef.current = leftSpeed
      rightSpeedRef.current = rightSpeed
    },
    setTimestep: (dt: number) => {
      if (modelRef.current) {
        modelRef.current.opt.timestep = dt
      }
    },
    isPlaying: () => playingRef.current,
    getTrajectory: () => [...trajectoryRef.current],
    loadModelFromXml: async (xml: string, meshFiles?: Map<string, ArrayBuffer>) => {
      const mj = mujocoRef.current
      if (!mj) throw new Error('MuJoCo not initialized')

      // Clean up old model
      dataRef.current?.delete?.()
      modelRef.current?.delete?.()

      // Write new files to VFS
      mj.FS.writeFile('/models/custom-model.xml', xml)
      if (meshFiles) {
        try { mj.FS.mkdir('/models/meshes') } catch (e: any) { /* exists */ }
        meshFiles.forEach((buf, name) => {
          mj.FS.writeFile(`/models/meshes/${name}`, new Uint8Array(buf))
        })
      }

      const model = mj.Model.load('/models/custom-model.xml')
      const data = new mj.Simulation(model)
      modelRef.current = model
      dataRef.current = data

      // Rebuild scene
      buildSceneFromModel(mj, model, data)
      stepCountRef.current = 0
      trajectoryRef.current = []
    },
  }), [buildSceneFromModel, onTrajectoryUpdate])

  // ── Render ──

  if (status === 'loading') {
    return (
      <div className="h-[400px] flex items-center justify-center bg-solus-bg border border-solus-border rounded-lg">
        <LoadingSpinner size="lg" label="Initializing MuJoCo WASM..." />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="h-[400px] flex items-center justify-center bg-solus-bg border border-solus-border rounded-lg">
        <EmptyState
          title="3D viewer unavailable"
          description={`${errorMsg}. Using 2D simulation fallback.`}
        />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-[400px] w-full bg-solus-bg border border-solus-border rounded-lg overflow-hidden"
    />
  )
})

MuJoCoViewer.displayName = 'MuJoCoViewer'
export default MuJoCoViewer
```

- [ ] **Step 2: Verify build passes**

Run: `cd apps/desktop && npx vite build --mode development 2>&1 | tail -10`
Expected: Build succeeds (may have warnings about dynamic import, which is fine)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/simulator/MuJoCoViewer.tsx
git commit -m "feat: MuJoCoViewer — WASM init, VFS loading, Three.js rendering, animation loop"
```

---

## Task 5: SimulatorTab Integration

**Files:**
- Modify: `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx`

**Context:** Integrate the MuJoCoViewer and ModelSourceBar into the existing SimulatorTab. The viewer sits at the top of the right panel. "Run Simulation" plays the MuJoCo sim if WASM is ready, otherwise falls back to the backend. Playback controls (play/pause, speed, reset) sit below the viewer. Charts remain below, fed by trajectory data from MuJoCo.

**Depends on:** Tasks 3 and 4.

- [ ] **Step 1: Rewrite SimulatorTab to integrate all components**

Replace the entire content of `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx` with:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Pause, RotateCcw, AlertTriangle, ArrowRight, SkipForward } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useProjectStore } from '../../stores/projectStore'
import { API_BASE } from '../../constants/api'
import { Card } from '../shared/Card'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { EmptyState } from '../shared/EmptyState'
import MuJoCoViewer, { type MuJoCoViewerHandle, type TrajectoryPoint } from './MuJoCoViewer'
import { ModelSourceBar } from './ModelSourceBar'

// ── Types ──

interface Discrepancy {
  signal: string
  simulated: number
  observed: number
  delta: number
}

// ── Default Parameters ──

const DEFAULT_PARAMS: Record<string, number> = {
  wheel_radius: 0.0325,
  wheel_base: 0.17,
  motor_torque: 0.5,
  friction: 1.0,
}

const PARAM_LABELS: Record<string, { label: string; unit: string; step: number }> = {
  wheel_radius: { label: 'Wheel Radius', unit: 'm', step: 0.005 },
  wheel_base: { label: 'Wheel Base', unit: 'm', step: 0.01 },
  motor_torque: { label: 'Motor Torque', unit: 'Nm', step: 0.1 },
  friction: { label: 'Friction', unit: 'μ', step: 0.1 },
}

// ── Component ──

export default function SimulatorTab() {
  const { currentProjectId, queryAgent } = useProjectStore()

  // MuJoCo viewer ref
  const viewerRef = useRef<MuJoCoViewerHandle>(null)

  // Parameters
  const [params, setParams] = useState<Record<string, number>>({ ...DEFAULT_PARAMS })
  const [leftSpeed, setLeftSpeed] = useState(1.0)
  const [rightSpeed, setRightSpeed] = useState(1.0)
  const [nSteps, setNSteps] = useState(500)
  const [dt, setDt] = useState(0.01)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)

  // Results
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([])
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])

  // UI state
  const [playing, setPlaying] = useState(false)
  const [wasmReady, setWasmReady] = useState(false)
  const [wasmError, setWasmError] = useState(false)
  const [modelSource, setModelSource] = useState<'default' | 'upload' | 'onshape'>('default')
  const [modelLoading, setModelLoading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepCount, setStepCount] = useState(0)

  // Update viewer controls when speeds change
  useEffect(() => {
    viewerRef.current?.setControls(leftSpeed, rightSpeed)
  }, [leftSpeed, rightSpeed])

  useEffect(() => {
    viewerRef.current?.setTimestep(dt)
  }, [dt])

  // ── Handlers ──

  const handlePlay = useCallback(() => {
    if (!wasmReady) {
      // Fallback to backend
      runBackendSimulation()
      return
    }
    viewerRef.current?.setControls(leftSpeed, rightSpeed)
    viewerRef.current?.play()
    setPlaying(true)
  }, [wasmReady, leftSpeed, rightSpeed])

  const handlePause = useCallback(() => {
    viewerRef.current?.pause()
    setPlaying(false)
  }, [])

  const handleReset = useCallback(() => {
    viewerRef.current?.reset()
    setPlaying(false)
    setTrajectory([])
    setDiscrepancies([])
    setStepCount(0)
    setError(null)
  }, [])

  const handleTrajectoryUpdate = useCallback((traj: TrajectoryPoint[]) => {
    setTrajectory([...traj])
    setStepCount(traj.length)
  }, [])

  const handleSimComplete = useCallback(() => {
    setPlaying(false)
  }, [])

  // Backend fallback simulation
  const runBackendSimulation = useCallback(async () => {
    if (!currentProjectId) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n_steps: nSteps,
          left_speed: leftSpeed,
          right_speed: rightSpeed,
          dt,
          parameters: params,
        }),
      })
      if (!res.ok) throw new Error(`Simulation failed: ${res.statusText}`)
      const result = await res.json()
      setTrajectory(result.trajectory.map((p: any, i: number) => ({ ...p, step: i + 1 })))
      setStepCount(result.trajectory.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    }
  }, [currentProjectId, nSteps, leftSpeed, rightSpeed, dt, params])

  // Model loading handlers
  const handleLoadDefault = useCallback(() => {
    setModelSource('default')
    // Viewer loads default on mount, just reset
    handleReset()
  }, [handleReset])

  const handleUploadFile = useCallback(async (xmlFile: File, meshFiles: File[]) => {
    if (!viewerRef.current) return
    setModelLoading(true)
    try {
      const xml = await xmlFile.text()
      const meshMap = new Map<string, ArrayBuffer>()
      for (const mf of meshFiles) {
        meshMap.set(mf.name, await mf.arrayBuffer())
      }
      await viewerRef.current.loadModelFromXml(xml, meshMap)
      setModelSource('upload')
      handleReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model')
    } finally {
      setModelLoading(false)
    }
  }, [handleReset])

  const handleImportOnshape = useCallback(async (url: string) => {
    if (!currentProjectId) return
    setModelLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/import-onshape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error('Onshape import failed')
      setModelSource('onshape')
      handleReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onshape import failed')
    } finally {
      setModelLoading(false)
    }
  }, [currentProjectId, handleReset])

  // Compare with mock runtime data
  const runComparison = useCallback(async () => {
    if (!currentProjectId || trajectory.length === 0) return
    setComparing(true)
    setError(null)
    try {
      const last = trajectory[trajectory.length - 1]
      const simData = [
        { signal: 'final_x', value: Math.round(last.x * 1000) / 1000 },
        { signal: 'final_y', value: Math.round(last.y * 1000) / 1000 },
        { signal: 'avg_speed', value: Math.round(last.v_linear * 1000) / 1000 },
        { signal: 'turn_radius', value: last.v_angular !== 0 ? Math.round((last.v_linear / last.v_angular) * 1000) / 1000 : 999 },
      ]
      const runtimeData = simData.map(d => ({
        signal: d.signal,
        value: d.value * (1 + (Math.random() * 0.3 - 0.1)),
      }))
      const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sim_data: simData, runtime_data: runtimeData, threshold: 0.01 }),
      })
      if (!res.ok) throw new Error(`Comparison failed: ${res.statusText}`)
      const result = await res.json()
      setDiscrepancies(result.discrepancies)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed')
    } finally {
      setComparing(false)
    }
  }, [currentProjectId, trajectory])

  if (!currentProjectId) {
    return <EmptyState title="No project selected" description="Select a project from the Workspace tab to use the simulator." />
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-solus-border">
        <div>
          <h2 className="text-sm font-semibold text-solus-text">Simulator</h2>
          <p className="text-xs text-solus-text-muted">
            {wasmReady ? 'MuJoCo WASM — real physics simulation' : 'Differential drive kinematics (WASM loading...)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-solus-text-dim bg-solus-elevated border border-solus-border rounded-md hover:bg-solus-surface transition-colors cursor-pointer">
            <RotateCcw size={14} /> Reset
          </button>
          {playing ? (
            <button onClick={handlePause} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-solus-warning rounded-md hover:opacity-90 transition-colors cursor-pointer">
              <Pause size={14} /> Pause
            </button>
          ) : (
            <button onClick={handlePlay} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-solus-accent rounded-md hover:bg-solus-accent-bright transition-colors cursor-pointer">
              <Play size={14} /> Run Simulation
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-solus-error/10 border-b border-solus-error/30 px-4 py-1.5 flex items-center gap-2">
          <AlertTriangle size={14} className="text-solus-error" />
          <span className="text-xs text-solus-error">{error}</span>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Parameters */}
        <div className="w-72 border-r border-solus-border overflow-y-auto p-4 space-y-4">
          <Card title="Robot Parameters" compact>
            <div className="space-y-3">
              {Object.entries(PARAM_LABELS).map(([key, { label, unit, step }]) => (
                <div key={key}>
                  <label className="flex items-center justify-between text-xs text-solus-text-dim mb-1">
                    <span>{label}</span>
                    <span className="font-mono text-solus-text-muted">{unit}</span>
                  </label>
                  <input type="number" value={params[key] ?? 0} step={step}
                    onChange={e => setParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent" />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Wheel Speeds (rad/s)" compact>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Left Wheel</label>
                <input type="number" value={leftSpeed} step={0.5}
                  onChange={e => setLeftSpeed(parseFloat(e.target.value) || 0)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent" />
              </div>
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Right Wheel</label>
                <input type="number" value={rightSpeed} step={0.5}
                  onChange={e => setRightSpeed(parseFloat(e.target.value) || 0)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent" />
              </div>
            </div>
          </Card>

          <Card title="Simulation Settings" compact>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Max Steps</label>
                <input type="number" value={nSteps} step={100} min={1}
                  onChange={e => setNSteps(parseInt(e.target.value) || 100)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent" />
              </div>
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Time Step (s)</label>
                <input type="number" value={dt} step={0.005} min={0.001}
                  onChange={e => setDt(parseFloat(e.target.value) || 0.01)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent" />
              </div>
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Playback Speed</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={0.25} max={4} step={0.25} value={playbackSpeed}
                    onChange={e => setPlaybackSpeed(parseFloat(e.target.value))}
                    className="flex-1" />
                  <span className="text-xs font-mono text-solus-text w-10 text-right">{playbackSpeed}x</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Step counter */}
          {stepCount > 0 && (
            <Card title="Progress" compact>
              <div className="font-mono text-xs text-solus-text">
                <div className="flex justify-between">
                  <span className="text-solus-text-dim">Steps</span>
                  <span>{stepCount} / {nSteps}</span>
                </div>
                <div className="mt-2 h-1.5 bg-solus-elevated rounded-full overflow-hidden">
                  <div className="h-full bg-solus-accent rounded-full transition-all"
                    style={{ width: `${Math.min(100, (stepCount / nSteps) * 100)}%` }} />
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right Panel: Viewer + Charts */}
        <div className="flex-1 overflow-y-auto">
          {/* Model source bar */}
          <ModelSourceBar
            activeSource={modelSource}
            loading={modelLoading}
            onLoadDefault={handleLoadDefault}
            onUploadFile={handleUploadFile}
            onImportOnshape={handleImportOnshape}
          />

          <div className="p-4 space-y-4">
            {/* 3D Viewer */}
            <MuJoCoViewer
              ref={viewerRef}
              maxSteps={nSteps}
              playbackSpeed={playbackSpeed}
              onTrajectoryUpdate={handleTrajectoryUpdate}
              onSimComplete={handleSimComplete}
              onReady={() => setWasmReady(true)}
              onError={() => setWasmError(true)}
            />

            {/* Charts */}
            {trajectory.length > 0 && (
              <>
                <Card title="Trajectory (X-Y Path)">
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trajectory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                        <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 11 }} formatter={(value: number) => [value.toFixed(4), '']} />
                        <Line type="monotone" dataKey="y" stroke="#6366f1" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Velocity Over Time">
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trajectory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                        <XAxis dataKey="timestamp" stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 11 }} formatter={(value: number) => [value.toFixed(4), '']} />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                        <Line type="monotone" dataKey="v_linear" name="Linear (m/s)" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                        <Line type="monotone" dataKey="v_angular" name="Angular (rad/s)" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <div className="flex items-center gap-2">
                  <button onClick={runComparison} disabled={comparing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-solus-text-dim bg-solus-elevated border border-solus-border rounded-md hover:bg-solus-surface transition-colors disabled:opacity-50 cursor-pointer">
                    {comparing ? <LoadingSpinner size="sm" /> : <ArrowRight size={14} />}
                    Compare Sim vs Runtime
                  </button>
                  {discrepancies.length === 0 && !comparing && (
                    <span className="text-xs text-solus-text-muted">Generates mock runtime data with noise for demo</span>
                  )}
                </div>

                {discrepancies.length > 0 && (
                  <Card title="Discrepancies (Sim vs Runtime)">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-solus-border">
                          <th className="text-left py-2 px-2 text-solus-text-dim font-medium">Signal</th>
                          <th className="text-right py-2 px-2 text-solus-text-dim font-medium">Simulated</th>
                          <th className="text-right py-2 px-2 text-solus-text-dim font-medium">Observed</th>
                          <th className="text-right py-2 px-2 text-solus-text-dim font-medium">Delta</th>
                          <th className="text-right py-2 px-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {discrepancies.map((d, i) => (
                          <DiscrepancyRow key={i} discrepancy={d} />
                        ))}
                      </tbody>
                    </table>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Discrepancy Row ──

function DiscrepancyRow({ discrepancy }: { discrepancy: Discrepancy }) {
  const { currentProjectId, queryAgent } = useProjectStore()
  const [explaining, setExplaining] = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)

  const handleExplain = async () => {
    if (!currentProjectId) return
    setExplaining(true)
    try {
      const result = await queryAgent(currentProjectId,
        `Explain this simulation discrepancy: The signal "${discrepancy.signal}" has a simulated value of ${discrepancy.simulated} but the observed runtime value is ${discrepancy.observed} (delta: ${discrepancy.delta}). What could cause this difference?`,
        'general'
      ) as { response_text: string }
      setExplanation(result.response_text)
    } catch { setExplanation('Failed to get explanation.') }
    finally { setExplaining(false) }
  }

  return (
    <>
      <tr className="border-b border-solus-border/50 hover:bg-solus-elevated/50">
        <td className="py-2 px-2 font-mono text-solus-text">{discrepancy.signal}</td>
        <td className="py-2 px-2 font-mono text-right text-solus-text">{discrepancy.simulated.toFixed(4)}</td>
        <td className="py-2 px-2 font-mono text-right text-solus-warning">{discrepancy.observed.toFixed(4)}</td>
        <td className="py-2 px-2 font-mono text-right text-solus-error">{discrepancy.delta.toFixed(4)}</td>
        <td className="py-2 px-2 text-right">
          <button onClick={handleExplain} disabled={explaining}
            className="text-xs text-solus-accent hover:text-solus-accent-bright cursor-pointer disabled:opacity-50">
            {explaining ? '...' : 'Explain'}
          </button>
        </td>
      </tr>
      {explanation && (
        <tr><td colSpan={5} className="px-2 py-2 text-xs text-solus-text-dim bg-solus-elevated/30">
          <div className="max-h-32 overflow-y-auto whitespace-pre-wrap">{explanation}</div>
        </td></tr>
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd apps/desktop && npx vite build --mode development 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx
git commit -m "feat: SimulatorTab — integrate MuJoCo 3D viewer with fallback to backend sim"
```

---

## Task 6: End-to-End Verification

**Files:** None new.

**Depends on:** Task 5.

- [ ] **Step 1: Start both servers**

```bash
# Backend (if not running)
cd apps/backend && source .venv/bin/activate && uvicorn src.main:app --reload --port 8000 &
# Frontend
cd apps/desktop && pnpm run dev:web &
```

- [ ] **Step 2: Open the Simulator tab**

Open http://localhost:5173, click the CPU icon (Simulator tab).

Verify:
1. "Model: Default Rover" is active in the source bar
2. 3D viewer shows loading spinner → then the Elegoo rover on a ground plane (or error fallback message)
3. If WASM loaded: subtitle says "MuJoCo WASM — real physics simulation"
4. If WASM failed: subtitle says "Differential drive kinematics" and simulation falls back to backend

- [ ] **Step 3: Test simulation**

1. Set Left Wheel = 2.0, Right Wheel = 2.0
2. Click "Run Simulation"
3. If WASM: rover drives forward in 3D, wheels spin, trajectory chart updates live
4. If fallback: trajectory chart appears after backend responds
5. Change to Left = 1.0, Right = 3.0 → Reset → Run → rover should turn

- [ ] **Step 4: Test model upload**

1. Click "Upload MJCF"
2. Select any `.xml` MuJoCo model file
3. Viewer should load the new model

- [ ] **Step 5: Test Onshape mock**

1. Click "Import from Onshape"
2. Enter `https://cad.onshape.com/documents/test123`
3. Click Import
4. Should show "Loading model..." then load the default rover

- [ ] **Step 6: Test comparison**

1. After a simulation run, click "Compare Sim vs Runtime"
2. Discrepancy table should appear
3. Click "Explain" on a row → AI explanation appears

- [ ] **Step 7: Run backend tests**

```bash
source apps/backend/.venv/bin/activate && python -m pytest apps/backend/tests/ -v
```
Expected: All tests pass (including new Onshape stub tests)

- [ ] **Step 8: Commit any fixes**

```bash
git status
# If fixes needed:
git add -A
git commit -m "fix: SimulatorTab adjustments from e2e testing"
```
