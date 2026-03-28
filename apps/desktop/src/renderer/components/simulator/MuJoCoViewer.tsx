import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
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

// ── Constants (module-level to avoid re-creation on render) ──

const DEFAULT_MODEL_URL = '/models/elegoo-rover.xml'
const DEFAULT_MESH_URLS: string[] = []

// ── Component ──

const MuJoCoViewer = forwardRef<MuJoCoViewerHandle, MuJoCoViewerProps>(({
  modelUrl = DEFAULT_MODEL_URL,
  meshUrls = DEFAULT_MESH_URLS,
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
  const geomMeshesRef = useRef<Map<number, THREE.Mesh>>(new Map())
  const mujocoRootRef = useRef<THREE.Group | null>(null)
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

      // Dynamically import mujoco-js (official DeepMind WASM bindings)
      const loadMujocoModule = await import('mujoco-js')
      const loadMujoco = loadMujocoModule.default
      if (!loadMujoco) throw new Error('mujoco-js module has no default export')
      const mj = await loadMujoco()
      if (!mj) throw new Error('mujoco-js loadMujoco() returned null')
      mujocoRef.current = mj

      // Debug: log available API to find correct method names
      console.log('[MuJoCo] Module keys:', Object.keys(mj).filter(k => !k.startsWith('_')).sort().join(', '))
      console.log('[MuJoCo] Has FS:', !!mj.FS)
      console.log('[MuJoCo] Has MjModel:', !!mj.MjModel)
      console.log('[MuJoCo] Has Model:', !!mj.Model)
      console.log('[MuJoCo] Has MEMFS:', !!mj.MEMFS)
      console.log('[MuJoCo] Has mj_step:', !!mj.mj_step)

      // Set up VFS — try MEMFS mount, fall back to just mkdir
      try { mj.FS.mkdir('/working') } catch (e: any) { /* exists */ }
      try {
        if (mj.MEMFS) {
          mj.FS.mount(mj.MEMFS, { root: '.' }, '/working')
        }
      } catch (e: any) {
        console.log('[MuJoCo] MEMFS mount failed (may already be mounted):', e.message)
      }
      try { mj.FS.mkdir('/working/meshes') } catch (e: any) { /* exists */ }

      // Fetch and write MJCF XML to VFS
      const xmlRes = await fetch(modelUrl)
      if (!xmlRes.ok) throw new Error(`Failed to fetch model: ${xmlRes.statusText}`)
      const xmlText = await xmlRes.text()
      mj.FS.writeFile('/working/model.xml', xmlText)

      // Fetch and write STL meshes to VFS
      for (const meshUrl of meshUrls) {
        const meshRes = await fetch(meshUrl)
        if (!meshRes.ok) throw new Error(`Failed to fetch mesh: ${meshUrl}`)
        const meshBuf = new Uint8Array(await meshRes.arrayBuffer())
        const meshName = meshUrl.split('/').pop() || 'mesh.stl'
        mj.FS.writeFile(`/working/meshes/${meshName}`, meshBuf)
      }

      // Load MuJoCo model — try different API names
      let model: any
      let data: any
      if (mj.MjModel?.loadFromXML) {
        model = mj.MjModel.loadFromXML('/working/model.xml')
        data = new mj.MjData(model)
      } else if (mj.Model?.loadFromXML) {
        model = mj.Model.loadFromXML('/working/model.xml')
        data = new mj.Data(model)
      } else if (mj.load) {
        model = mj.load('/working/model.xml')
        data = new mj.Simulation(model)
      } else {
        // Log all available constructors/functions for debugging
        const fns = Object.keys(mj).filter(k => typeof mj[k] === 'function')
        throw new Error(`Cannot find model loader. Available functions: ${fns.join(', ')}`)
      }
      console.log('[MuJoCo] Model loaded successfully')
      modelRef.current = model
      dataRef.current = data

      // Initialize Three.js
      initThreeJs()

      // Build scene from MuJoCo geoms (pass meshUrls explicitly to avoid stale closure)
      buildSceneFromModel(mj, model, data, meshUrls)

      setStatus('ready')
      onReady?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[MuJoCo] Init failed:', err)
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
    sceneRef.current = scene

    // MuJoCo root group — rotated to convert Z-up to Y-up
    // Using a child group (not scene) so OrbitControls work correctly
    const mujocoRoot = new THREE.Group()
    mujocoRoot.rotation.x = -Math.PI / 2
    scene.add(mujocoRoot)
    mujocoRootRef.current = mujocoRoot

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
    // Store for cleanup
    ;(containerRef.current as any)._resizeHandler = handleResize
  }, [])

  // ── Build Three.js Scene from MuJoCo Model ──
  // Each geom gets its own Three.js mesh, placed directly in the mujocoRoot.
  // syncVisuals reads world-space geom transforms from data.geom_xpos + data.geom_xmat.

  const buildSceneFromModel = useCallback((mj: any, model: any, data: any, currentMeshUrls: string[]) => {
    const root = mujocoRootRef.current
    if (!root) return

    // Clear old meshes
    geomMeshesRef.current.forEach(mesh => root.remove(mesh))
    geomMeshesRef.current.clear()

    const ngeom = model.ngeom

    for (let i = 0; i < ngeom; i++) {
      const geomType = model.geom_type[i]
      const geomSize = [model.geom_size[i * 3], model.geom_size[i * 3 + 1], model.geom_size[i * 3 + 2]]
      const geomRgba = [model.geom_rgba[i * 4], model.geom_rgba[i * 4 + 1], model.geom_rgba[i * 4 + 2], model.geom_rgba[i * 4 + 3]]

      // Skip invisible geoms (rgba alpha = 0)
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
          // Three.js cylinder axis is Y; we'll get the correct orientation
          // from data.geom_xmat in syncVisuals
          geometry = new THREE.CylinderGeometry(geomSize[0], geomSize[0], geomSize[1] * 2, 16)
          break
        case 6: // box
          geometry = new THREE.BoxGeometry(geomSize[0] * 2, geomSize[1] * 2, geomSize[2] * 2)
          break
        default:
          continue
      }

      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material)
        root.add(mesh)
        geomMeshesRef.current.set(i, mesh)
      }
    }

    // Initial forward pass to compute geom transforms, then sync + render
    mj.mj_forward(model, data)
    syncVisuals()
    renderFrame()
  }, [])

  // ── Render Frame ──

  const renderFrame = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return
    controlsRef.current?.update()
    rendererRef.current.render(sceneRef.current, cameraRef.current)
  }, [])

  // ── Update Three.js Transforms from MuJoCo State ──
  // Uses per-geom world transforms: data.geom_xpos (3 per geom) and data.geom_xmat (9 per geom).
  // This gives us the fully-resolved world position + orientation for each geom,
  // including body transforms + geom-local euler rotations.

  const syncVisuals = useCallback(() => {
    const data = dataRef.current
    if (!data) return

    geomMeshesRef.current.forEach((mesh, geomIdx) => {
      // World position from data.geom_xpos
      mesh.position.set(
        data.geom_xpos[geomIdx * 3 + 0],
        data.geom_xpos[geomIdx * 3 + 1],
        data.geom_xpos[geomIdx * 3 + 2],
      )

      // World orientation from data.geom_xmat (3x3 rotation matrix, row-major)
      // Convert to Three.js Matrix4, then extract quaternion
      const m = data.geom_xmat
      const off = geomIdx * 9
      const mat4 = new THREE.Matrix4()
      // MuJoCo xmat is row-major: [r00,r01,r02, r10,r11,r12, r20,r21,r22]
      // Three.js Matrix4.set() takes row-major arguments
      mat4.set(
        m[off + 0], m[off + 1], m[off + 2], 0,
        m[off + 3], m[off + 4], m[off + 5], 0,
        m[off + 6], m[off + 7], m[off + 8], 0,
        0, 0, 0, 1,
      )

      // But Three.js cylinders have Y as their axis, while MuJoCo uses Z.
      // We need to pre-rotate the cylinder geometry's local frame.
      // Since we can't distinguish geom types here easily, we apply a
      // correction: multiply by a -90° X rotation for cylinders.
      // Actually — the xmat already includes the geom's euler rotation,
      // so we just need to account for Three.js vs MuJoCo cylinder axis convention.

      const quat = new THREE.Quaternion()
      quat.setFromRotationMatrix(mat4)
      mesh.quaternion.copy(quat)

      // For cylinders (Y-axis in Three.js vs Z-axis in MuJoCo),
      // apply a local correction rotation
      if ((mesh.geometry as any)?.type === 'CylinderGeometry') {
        const correction = new THREE.Quaternion()
        correction.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
        mesh.quaternion.multiply(correction)
      }
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
      // Clean up resize listener
      const handler = (containerRef.current as any)?._resizeHandler
      if (handler) window.removeEventListener('resize', handler)
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

      // Write new XML to VFS
      mj.FS.writeFile('/working/model.xml', xml)

      // Write mesh files if provided
      const uploadedMeshUrls: string[] = []
      if (meshFiles) {
        meshFiles.forEach((buf, name) => {
          mj.FS.writeFile(`/working/meshes/${name}`, new Uint8Array(buf))
          uploadedMeshUrls.push(`/working/meshes/${name}`)
        })
      }

      // Load with correct API
      const model = mj.MjModel.loadFromXML('/working/model.xml')
      const data = new mj.MjData(model)
      modelRef.current = model
      dataRef.current = data

      // Rebuild scene (pass uploaded mesh URLs to avoid stale closure)
      buildSceneFromModel(mj, model, data, uploadedMeshUrls)
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
