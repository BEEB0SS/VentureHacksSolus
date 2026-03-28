import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { EmptyState } from '../shared/EmptyState'

// ── Types ──

export interface MuJoCoViewerHandle {
  play: (leftSpeed: number, rightSpeed: number) => void
  playWithPID: (kp: number, ki: number, kd: number, targetSpeed: number) => void
  pause: () => void
  reset: () => void
  isPlaying: () => boolean
  getTrajectory: () => TrajectoryPoint[]
  loadModelFromXml: (xml: string) => Promise<void>
}

export interface TrajectoryPoint {
  x: number
  y: number
  theta: number
  v_linear: number
  v_angular: number
  timestamp: number
  step?: number
}

interface MuJoCoViewerProps {
  modelUrl?: string
  maxSteps?: number
  playbackSpeed?: number
  onTrajectoryUpdate?: (trajectory: TrajectoryPoint[]) => void
  onSimComplete?: () => void
  onError?: (error: string) => void
  onReady?: () => void
}

const DEFAULT_MODEL_URL = '/models/elegoo-rover.xml'

// ── Component ──

const MuJoCoViewer = forwardRef<MuJoCoViewerHandle, MuJoCoViewerProps>(({
  modelUrl = DEFAULT_MODEL_URL,
  maxSteps = 2000,
  playbackSpeed = 1.0,
  onTrajectoryUpdate,
  onSimComplete,
  onError,
  onReady,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')

  // MuJoCo refs — kept alive for live physics
  const mjRef = useRef<any>(null)
  const modelRef = useRef<any>(null)
  const dataRef = useRef<any>(null)

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)

  // Per-geom Three.js meshes (indexed by geom ID)
  const geomMeshesRef = useRef<Map<number, THREE.Mesh>>(new Map())
  // Chassis body ID for trajectory extraction
  const chassisBodyIdRef = useRef(1)

  // Animation/simulation refs
  const animFrameRef = useRef<number>(0)
  const loopRunningRef = useRef(false)
  const playingRef = useRef(false)
  const trajectoryRef = useRef<TrajectoryPoint[]>([])
  const stepCountRef = useRef(0)
  const maxStepsRef = useRef(maxSteps)
  const playbackSpeedRef = useRef(playbackSpeed)

  // Control mode refs
  const leftSpeedRef = useRef(0)
  const rightSpeedRef = useRef(0)
  const pidModeRef = useRef(false)
  const pidGainsRef = useRef({ kp: 0, ki: 0, kd: 0 })
  const pidTargetSpeedRef = useRef(1.0)
  const pidIntegralRef = useRef(0)
  const pidPrevErrorRef = useRef(0)

  // Callback refs
  const onTrajectoryUpdateRef = useRef(onTrajectoryUpdate)
  const onSimCompleteRef = useRef(onSimComplete)
  useEffect(() => { onTrajectoryUpdateRef.current = onTrajectoryUpdate }, [onTrajectoryUpdate])
  useEffect(() => { onSimCompleteRef.current = onSimComplete }, [onSimComplete])
  useEffect(() => { maxStepsRef.current = maxSteps }, [maxSteps])
  useEffect(() => { playbackSpeedRef.current = playbackSpeed }, [playbackSpeed])

  // ── Initialize MuJoCo WASM + Three.js ──

  const init = useCallback(async () => {
    try {
      if (rendererRef.current) return // Guard against double-init
      setStatus('loading')
      if (!containerRef.current) throw new Error('Container not mounted')

      // ── Three.js setup ──
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight || 400

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0a0a0f)
      sceneRef.current = scene

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100)
      camera.position.set(0.4, 0.6, 0.8)
      camera.lookAt(0, 0, 0)
      cameraRef.current = camera

      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(window.devicePixelRatio)
      // Clear old canvases
      Array.from(containerRef.current.children).forEach(child => {
        if (child instanceof HTMLCanvasElement) child.remove()
      })
      containerRef.current.appendChild(renderer.domElement)
      rendererRef.current = renderer

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 0, 0)
      controls.enableDamping = false
      controlsRef.current = controls

      scene.add(new THREE.AmbientLight(0x404050, 2))
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
      dirLight.position.set(2, 3, 2)
      scene.add(dirLight)

      // Ground plane
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 4),
        new THREE.MeshPhongMaterial({ color: 0x1a1a22 }),
      )
      ground.rotation.x = -Math.PI / 2
      ground.position.y = -0.001
      scene.add(ground)
      scene.add(new THREE.GridHelper(4, 40, 0x333340, 0x222230))

      // Resize handler
      const handleResize = () => {
        if (!containerRef.current) return
        const w = containerRef.current.clientWidth
        const h = containerRef.current.clientHeight || 400
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
      window.addEventListener('resize', handleResize)
      ;(containerRef.current as any)._resizeHandler = handleResize

      // ── MuJoCo WASM setup ──
      const loadMujocoModule = await import('mujoco-js')
      const loadMujoco = loadMujocoModule.default
      const mj = await loadMujoco()
      mjRef.current = mj

      try { mj.FS.mkdir('/working') } catch { /* exists */ }
      try { if (mj.MEMFS) mj.FS.mount(mj.MEMFS, { root: '.' }, '/working') } catch { /* mounted */ }

      const xmlRes = await fetch(modelUrl)
      if (!xmlRes.ok) throw new Error(`Failed to fetch model: ${xmlRes.statusText}`)
      mj.FS.writeFile('/working/model.xml', await xmlRes.text())

      let model: any, data: any
      if (mj.MjModel?.loadFromXML) {
        model = mj.MjModel.loadFromXML('/working/model.xml')
        data = new mj.MjData(model)
      } else {
        throw new Error('Cannot find MuJoCo model loader')
      }
      modelRef.current = model
      dataRef.current = data

      // Initial forward pass
      mj.mj_forward(model, data)

      // ── Build Three.js meshes from geoms ──
      buildGeomMeshes(scene, model, data)

      console.log(`[MuJoCoViewer] Live physics ready. ${model.ngeom} geoms, ${model.nbody} bodies`)
      setStatus('ready')
      onReady?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[MuJoCoViewer] Init failed:', err)
      setStatus('error')
      setErrorMsg(msg)
      onError?.(msg)
    }
  }, [modelUrl, onReady, onError])

  // ── Build Three.js meshes from MuJoCo geoms (one mesh per geom) ──

  const buildGeomMeshes = useCallback((scene: THREE.Scene, model: any, data: any) => {
    geomMeshesRef.current.clear()

    for (let i = 0; i < model.ngeom; i++) {
      const geomType = model.geom_type[i]
      const geomSize = [model.geom_size[i * 3], model.geom_size[i * 3 + 1], model.geom_size[i * 3 + 2]]
      const geomRgba = [model.geom_rgba[i * 4], model.geom_rgba[i * 4 + 1], model.geom_rgba[i * 4 + 2], model.geom_rgba[i * 4 + 3]]

      if (geomRgba[3] === 0) continue // invisible (collision only)
      if (geomType === 0) continue     // skip plane (we have our own ground)

      let geometry: THREE.BufferGeometry | null = null
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(geomRgba[0], geomRgba[1], geomRgba[2]),
        transparent: geomRgba[3] < 1,
        opacity: geomRgba[3],
      })

      switch (geomType) {
        case 2: geometry = new THREE.SphereGeometry(geomSize[0], 16, 16); break
        case 3: geometry = new THREE.CapsuleGeometry(geomSize[0], geomSize[1] * 2, 8, 16); break
        case 5: geometry = new THREE.CylinderGeometry(geomSize[0], geomSize[0], geomSize[1] * 2, 16); break
        case 6: geometry = new THREE.BoxGeometry(geomSize[0] * 2, geomSize[1] * 2, geomSize[2] * 2); break
        default: continue
      }

      if (!geometry) continue

      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)
      geomMeshesRef.current.set(i, mesh)
    }

    // Initial visual sync
    syncVisuals(data)
  }, [])

  // ── Sync Three.js mesh transforms from MuJoCo state ──

  const syncVisuals = useCallback((data: any) => {
    geomMeshesRef.current.forEach((mesh, geomIdx) => {
      // World position: convert MuJoCo Z-up (x,y,z) → Three.js Y-up (x,z,-y)
      const mx = data.geom_xpos[geomIdx * 3 + 0]
      const my = data.geom_xpos[geomIdx * 3 + 1]
      const mz = data.geom_xpos[geomIdx * 3 + 2]
      mesh.position.set(mx, mz, -my)

      // World orientation: convert MuJoCo Z-up 3x3 rotation matrix → Three.js Y-up
      const m = data.geom_xmat
      const off = geomIdx * 9
      // MuJoCo row-major: [Xx,Xy,Xz, Yx,Yy,Yz, Zx,Zy,Zz] in Z-up
      // Three.js Y-up: swap Y↔Z rows and columns
      const mat4 = new THREE.Matrix4()
      mat4.set(
        m[off + 0], m[off + 2], -m[off + 1], 0,
        m[off + 6], m[off + 8], -m[off + 7], 0,
       -m[off + 3],-m[off + 5],  m[off + 4], 0,
        0,          0,           0,           1,
      )
      const quat = new THREE.Quaternion()
      quat.setFromRotationMatrix(mat4)
      mesh.quaternion.copy(quat)
    })
  }, [])

  // ── Render frame ──

  const renderFrame = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return
    controlsRef.current?.update()
    rendererRef.current.render(sceneRef.current, cameraRef.current)
  }, [])

  // ── Animation loop with LIVE MuJoCo physics stepping ──

  const startRenderLoop = useCallback(() => {
    if (loopRunningRef.current) return
    loopRunningRef.current = true

    let frameCounter = 0

    const tick = () => {
      if (!loopRunningRef.current) return

      const mj = mjRef.current
      const model = modelRef.current
      const data = dataRef.current

      if (mj && model && data && playingRef.current && stepCountRef.current < maxStepsRef.current) {
        // MuJoCo timestep is 0.002s. At 60fps we need ~8 steps/frame for real-time.
        // playbackSpeed multiplies this.
        const baseStepsPerFrame = 8
        const stepsPerFrame = Math.max(1, Math.round(baseStepsPerFrame * playbackSpeedRef.current))

        for (let i = 0; i < stepsPerFrame && stepCountRef.current < maxStepsRef.current; i++) {
          // ── Compute ctrl values ──
          if (pidModeRef.current) {
            // PID heading correction: try to keep theta=0 (straight ahead)
            const bodyId = chassisBodyIdRef.current
            const qw = data.xquat[bodyId * 4 + 0]
            const qx = data.xquat[bodyId * 4 + 1]
            const qy = data.xquat[bodyId * 4 + 2]
            const qz = data.xquat[bodyId * 4 + 3]
            const theta = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))

            const error = -theta
            const { kp, ki, kd } = pidGainsRef.current
            const simDt = model.opt.timestep
            pidIntegralRef.current += error * simDt
            const derivative = (error - pidPrevErrorRef.current) / simDt
            pidPrevErrorRef.current = error

            const correction = kp * error + ki * pidIntegralRef.current + kd * derivative

            // Base angular speed from target linear speed
            const wheelRadius = 0.0325
            const baseAngularSpeed = pidTargetSpeedRef.current / wheelRadius
            const leftCtrl = baseAngularSpeed - correction
            const rightCtrl = baseAngularSpeed + correction

            data.ctrl[0] = leftCtrl   // left-front
            data.ctrl[1] = rightCtrl  // right-front
            data.ctrl[2] = leftCtrl   // left-rear
            data.ctrl[3] = rightCtrl  // right-rear
          } else {
            // Direct speed mode
            data.ctrl[0] = leftSpeedRef.current
            data.ctrl[1] = rightSpeedRef.current
            data.ctrl[2] = leftSpeedRef.current
            data.ctrl[3] = rightSpeedRef.current
          }

          // Step physics
          mj.mj_step(model, data)
          stepCountRef.current++

          // Extract chassis position for trajectory
          const bodyId = chassisBodyIdRef.current
          const x = data.xpos[bodyId * 3 + 0]
          const y = data.xpos[bodyId * 3 + 1]
          const qw = data.xquat[bodyId * 4 + 0]
          const qx = data.xquat[bodyId * 4 + 1]
          const qy = data.xquat[bodyId * 4 + 2]
          const qz = data.xquat[bodyId * 4 + 3]
          const theta = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))
          const vx = data.qvel[0] || 0
          const vy = data.qvel[1] || 0
          const v_linear = Math.sqrt(vx * vx + vy * vy)
          const v_angular = data.qvel[5] || 0

          trajectoryRef.current.push({
            x, y, theta, v_linear, v_angular,
            timestamp: data.time,
            step: stepCountRef.current,
          })
        }

        // Sync Three.js visuals from MuJoCo state
        syncVisuals(data)

        // Throttle trajectory callback to every 10th frame
        frameCounter++
        if (frameCounter % 10 === 0) {
          onTrajectoryUpdateRef.current?.(trajectoryRef.current)
        }

        // Check completion
        if (stepCountRef.current >= maxStepsRef.current) {
          playingRef.current = false
          onTrajectoryUpdateRef.current?.(trajectoryRef.current)
          onSimCompleteRef.current?.()
        }
      }

      renderFrame()
      animFrameRef.current = requestAnimationFrame(tick)
    }

    animFrameRef.current = requestAnimationFrame(tick)
  }, [syncVisuals, renderFrame])

  const stopRenderLoop = useCallback(() => {
    loopRunningRef.current = false
    cancelAnimationFrame(animFrameRef.current)
  }, [])

  // ── Lifecycle ──

  useEffect(() => {
    init()
    return () => {
      stopRenderLoop()
      const handler = (containerRef.current as any)?._resizeHandler
      if (handler) window.removeEventListener('resize', handler)
      rendererRef.current?.dispose()
      dataRef.current?.delete?.()
      modelRef.current?.delete?.()
    }
  }, [init, stopRenderLoop])

  useEffect(() => {
    if (status === 'ready') startRenderLoop()
    return () => stopRenderLoop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // ── Imperative Handle ──

  useImperativeHandle(ref, () => ({
    play: (leftSpeed: number, rightSpeed: number) => {
      // Reset simulation state
      const mj = mjRef.current
      const model = modelRef.current
      const data = dataRef.current
      if (mj && model && data) {
        mj.mj_resetData(model, data)
        mj.mj_forward(model, data)
      }
      pidModeRef.current = false
      leftSpeedRef.current = leftSpeed
      rightSpeedRef.current = rightSpeed
      stepCountRef.current = 0
      trajectoryRef.current = []
      playingRef.current = true
    },

    playWithPID: (kp: number, ki: number, kd: number, targetSpeed: number) => {
      // Reset simulation with initial heading offset
      const mj = mjRef.current
      const model = modelRef.current
      const data = dataRef.current
      if (mj && model && data) {
        mj.mj_resetData(model, data)
        // Apply initial heading offset to demonstrate PID correction
        // qpos[0..2] = position (x,y,z), qpos[3..6] = quaternion (w,x,y,z)
        // Rotate 0.1 radians around Z axis for initial misalignment
        const initTheta = 0.1
        data.qpos[3] = Math.cos(initTheta / 2)  // qw
        data.qpos[6] = Math.sin(initTheta / 2)  // qz
        mj.mj_forward(model, data)
      }
      pidModeRef.current = true
      pidGainsRef.current = { kp, ki, kd }
      pidTargetSpeedRef.current = targetSpeed
      pidIntegralRef.current = 0
      pidPrevErrorRef.current = 0
      stepCountRef.current = 0
      trajectoryRef.current = []
      playingRef.current = true
    },

    pause: () => {
      playingRef.current = false
    },

    reset: () => {
      playingRef.current = false
      stepCountRef.current = 0
      trajectoryRef.current = []
      pidIntegralRef.current = 0
      pidPrevErrorRef.current = 0
      const mj = mjRef.current
      const model = modelRef.current
      const data = dataRef.current
      if (mj && model && data) {
        mj.mj_resetData(model, data)
        mj.mj_forward(model, data)
        syncVisuals(data)
      }
    },

    isPlaying: () => playingRef.current,
    getTrajectory: () => [...trajectoryRef.current],

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
  }), [syncVisuals, buildGeomMeshes])

  // ── Render ──

  return (
    <div
      ref={containerRef}
      className="h-[400px] w-full bg-solus-bg border border-solus-border rounded-lg overflow-hidden relative"
    >
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-solus-bg z-10">
          <LoadingSpinner size="lg" label="Loading MuJoCo physics..." />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-solus-bg z-10">
          <EmptyState
            title="3D physics unavailable"
            description={`${errorMsg}. Using 2D charts.`}
          />
        </div>
      )}
    </div>
  )
})

MuJoCoViewer.displayName = 'MuJoCoViewer'
export default MuJoCoViewer
