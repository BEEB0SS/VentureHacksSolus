import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { EmptyState } from '../shared/EmptyState'

// ── Types ──

export interface MuJoCoViewerHandle {
  playTrajectory: (trajectory: TrajectoryPoint[]) => void
  pause: () => void
  reset: () => void
  isPlaying: () => boolean
  getTrajectory: () => TrajectoryPoint[]
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
  playbackSpeed?: number
  onTrajectoryUpdate?: (trajectory: TrajectoryPoint[], currentIndex: number) => void
  onSimComplete?: () => void
  onError?: (error: string) => void
  onReady?: () => void
}

const DEFAULT_MODEL_URL = '/models/elegoo-rover.xml'

// ── Component ──

const MuJoCoViewer = forwardRef<MuJoCoViewerHandle, MuJoCoViewerProps>(({
  modelUrl = DEFAULT_MODEL_URL,
  playbackSpeed = 1.0,
  onTrajectoryUpdate,
  onSimComplete,
  onError,
  onReady,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)

  // Car model group — we move this as a whole along the trajectory
  const carGroupRef = useRef<THREE.Group | null>(null)
  // Wheel meshes for rotation animation
  const wheelMeshesRef = useRef<THREE.Mesh[]>([])

  // Animation refs
  const animFrameRef = useRef<number>(0)
  const loopRunningRef = useRef(false)
  const playingRef = useRef(false)
  const trajectoryDataRef = useRef<TrajectoryPoint[]>([])
  const currentFrameRef = useRef(0)
  const playbackSpeedRef = useRef(playbackSpeed)

  // Callback refs (avoid stale closures)
  const onTrajectoryUpdateRef = useRef(onTrajectoryUpdate)
  const onSimCompleteRef = useRef(onSimComplete)
  useEffect(() => { onTrajectoryUpdateRef.current = onTrajectoryUpdate }, [onTrajectoryUpdate])
  useEffect(() => { onSimCompleteRef.current = onSimComplete }, [onSimComplete])
  useEffect(() => { playbackSpeedRef.current = playbackSpeed }, [playbackSpeed])

  // ── Initialize MuJoCo (for static model geometry only) + Three.js ──

  const init = useCallback(async () => {
    try {
      setStatus('loading')

      // Set up Three.js first
      if (!containerRef.current) throw new Error('Container not mounted')
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight || 400

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0a0a0f)
      sceneRef.current = scene

      // Camera — overhead-ish view to see car driving
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100)
      camera.position.set(0.4, 0.6, 0.8)
      camera.lookAt(0, 0, 0)
      cameraRef.current = camera

      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(window.devicePixelRatio)
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
      const groundGeo = new THREE.PlaneGeometry(4, 4)
      const groundMat = new THREE.MeshPhongMaterial({ color: 0x1a1a22 })
      const ground = new THREE.Mesh(groundGeo, groundMat)
      ground.rotation.x = -Math.PI / 2
      ground.position.y = -0.001
      scene.add(ground)

      // Grid helper on the ground
      const grid = new THREE.GridHelper(4, 40, 0x333340, 0x222230)
      scene.add(grid)

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

      // Try to load MuJoCo for the car model geometry
      await buildCarModel(scene)

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

  // ── Build car model from MuJoCo MJCF (static geometry) ──

  const buildCarModel = useCallback(async (scene: THREE.Scene) => {
    // The car group lives in Three.js Y-up space.
    // We position and rotate this group based on trajectory (x, y, theta).
    const carGroup = new THREE.Group()
    scene.add(carGroup)
    carGroupRef.current = carGroup

    try {
      const loadMujocoModule = await import('mujoco-js')
      const loadMujoco = loadMujocoModule.default
      const mj = await loadMujoco()

      try { mj.FS.mkdir('/working') } catch { /* exists */ }
      try { if (mj.MEMFS) mj.FS.mount(mj.MEMFS, { root: '.' }, '/working') } catch { /* mounted */ }

      const xmlRes = await fetch(modelUrl)
      if (!xmlRes.ok) throw new Error(`Failed to fetch model: ${xmlRes.statusText}`)
      mj.FS.writeFile('/working/model.xml', await xmlRes.text())

      let model: any, data: any
      if (mj.MjModel?.loadFromXML) {
        model = mj.MjModel.loadFromXML('/working/model.xml')
        data = new mj.MjData(model)
      } else if (mj.Model?.loadFromXML) {
        model = mj.Model.loadFromXML('/working/model.xml')
        data = new mj.Data(model)
      } else {
        throw new Error('Cannot find MuJoCo model loader')
      }

      // Run mj_forward to get initial geom positions
      mj.mj_forward(model, data)

      // Build Three.js meshes from MuJoCo geoms
      // All positions are relative to car group (subtract chassis origin)
      const chassisX = data.geom_xpos[1 * 3 + 0] || 0  // geom 1 = chassis_lower
      const chassisY = data.geom_xpos[1 * 3 + 1] || 0
      const chassisZ = data.geom_xpos[1 * 3 + 2] || 0

      const wheels: THREE.Mesh[] = []

      for (let i = 0; i < model.ngeom; i++) {
        const geomType = model.geom_type[i]
        const geomSize = [model.geom_size[i * 3], model.geom_size[i * 3 + 1], model.geom_size[i * 3 + 2]]
        const geomRgba = [model.geom_rgba[i * 4], model.geom_rgba[i * 4 + 1], model.geom_rgba[i * 4 + 2], model.geom_rgba[i * 4 + 3]]

        if (geomRgba[3] === 0) continue
        if (geomType === 0) continue  // skip ground plane (we made our own)

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

        // Position relative to chassis, converting MuJoCo Z-up to Three.js Y-up
        const gx = data.geom_xpos[i * 3 + 0] - chassisX
        const gy = data.geom_xpos[i * 3 + 1] - chassisY
        const gz = data.geom_xpos[i * 3 + 2] - chassisZ
        mesh.position.set(gx, gz, -gy)  // Z-up → Y-up: (x, z, -y)

        // Orientation from geom_xmat
        const m = data.geom_xmat
        const off = i * 9
        const mat4 = new THREE.Matrix4()
        // Convert MuJoCo Z-up rotation matrix to Three.js Y-up
        // MuJoCo: [Xx,Xy,Xz, Yx,Yy,Yz, Zx,Zy,Zz] (row-major, Z-up)
        // Three.js Y-up: swap Y↔Z rows and columns
        mat4.set(
          m[off + 0], m[off + 2], -m[off + 1], 0,
          m[off + 6], m[off + 8], -m[off + 7], 0,
          -m[off + 3], -m[off + 5], m[off + 4], 0,
          0, 0, 0, 1,
        )
        const quat = new THREE.Quaternion()
        quat.setFromRotationMatrix(mat4)
        mesh.quaternion.copy(quat)

        // Cylinder axis correction (Three.js Y-axis vs MuJoCo Z-axis)
        if (geomType === 5) {
          const correction = new THREE.Quaternion()
          correction.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
          mesh.quaternion.multiply(correction)
        }

        carGroup.add(mesh)

        // Track wheel geoms by name pattern (they're cylinders with "wheel" in geom name)
        // Wheel geom indices in the MJCF: the tire cylinders are the ones with friction
        // We identify wheels as cylinders with size[0] > 0.02 (tire-sized, not motor boxes)
        if (geomType === 5 && geomSize[0] > 0.02) {
          wheels.push(mesh)
        }
      }

      wheelMeshesRef.current = wheels

      // Lift car to ground level
      carGroup.position.y = chassisZ

      // Clean up MuJoCo (we only needed it for geometry)
      data.delete?.()
      model.delete?.()

      console.log(`[MuJoCoViewer] Built car model: ${carGroup.children.length} geoms, ${wheels.length} wheels`)
    } catch (err) {
      console.warn('[MuJoCoViewer] MuJoCo model load failed, using fallback box car:', err)

      // Fallback: simple box car
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.04, 0.15),
        new THREE.MeshPhongMaterial({ color: 0x1a1a2e }),
      )
      body.position.y = 0.055
      carGroup.add(body)

      const wheelGeo = new THREE.CylinderGeometry(0.0325, 0.0325, 0.025, 16)
      const wheelMat = new THREE.MeshPhongMaterial({ color: 0x333333 })
      const wheelPositions = [
        [0.06, 0.0325, 0.085], [0.06, 0.0325, -0.085],
        [-0.06, 0.0325, 0.085], [-0.06, 0.0325, -0.085],
      ]
      const wheels: THREE.Mesh[] = []
      for (const [wx, wy, wz] of wheelPositions) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat)
        wheel.position.set(wx, wy, wz)
        wheel.rotation.x = Math.PI / 2
        carGroup.add(wheel)
        wheels.push(wheel)
      }
      wheelMeshesRef.current = wheels
    }
  }, [modelUrl])

  // ── Render Frame ──

  const renderFrame = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return
    controlsRef.current?.update()
    rendererRef.current.render(sceneRef.current, cameraRef.current)
  }, [])

  // ── Animation Loop — trajectory playback only ──

  const startRenderLoop = useCallback(() => {
    if (loopRunningRef.current) return
    loopRunningRef.current = true

    let lastTime = performance.now()

    const tick = () => {
      if (!loopRunningRef.current) return

      const car = carGroupRef.current
      const traj = trajectoryDataRef.current

      if (car && traj.length > 0 && playingRef.current) {
        const now = performance.now()
        const deltaMs = now - lastTime
        lastTime = now

        // Advance frame based on playback speed
        // Each trajectory point is ~0.01s apart (dt from simulation)
        // At 60fps, advance ~0.6 points per frame at 1x speed
        const dt = traj.length > 1 ? (traj[1].timestamp - traj[0].timestamp) : 0.01
        const framesPerSecond = 60
        const pointsPerFrame = (playbackSpeedRef.current / dt) / framesPerSecond
        currentFrameRef.current += Math.max(0.5, pointsPerFrame)

        const idx = Math.min(Math.floor(currentFrameRef.current), traj.length - 1)
        const point = traj[idx]

        // Move car: trajectory is in MuJoCo Z-up coords (x forward, y left)
        // Three.js Y-up: x stays, y=height, z=-y(mujoco)
        car.position.x = point.x
        car.position.z = -point.y

        // Rotate car around Y axis (yaw = theta around Z in MuJoCo = Y in Three.js)
        car.rotation.y = -point.theta

        // Spin wheels based on forward velocity
        const wheelRotationDelta = (point.v_linear / 0.0325) * (deltaMs / 1000)
        for (const wheel of wheelMeshesRef.current) {
          wheel.rotation.z += wheelRotationDelta
        }

        // Update trajectory callback (throttled)
        if (idx % 5 === 0) {
          onTrajectoryUpdateRef.current?.(traj, idx)
        }

        // Done?
        if (idx >= traj.length - 1) {
          playingRef.current = false
          onTrajectoryUpdateRef.current?.(traj, traj.length - 1)
          onSimCompleteRef.current?.()
        }
      }

      renderFrame()
      animFrameRef.current = requestAnimationFrame(tick)
    }

    lastTime = performance.now()
    animFrameRef.current = requestAnimationFrame(tick)
  }, [renderFrame])

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
    }
  }, [init, stopRenderLoop])

  useEffect(() => {
    if (status === 'ready') startRenderLoop()
    return () => stopRenderLoop()
  }, [status, startRenderLoop, stopRenderLoop])

  // ── Imperative Handle ──

  useImperativeHandle(ref, () => ({
    playTrajectory: (trajectory: TrajectoryPoint[]) => {
      trajectoryDataRef.current = trajectory
      currentFrameRef.current = 0
      playingRef.current = true
      // Reset car to start
      const car = carGroupRef.current
      if (car && trajectory.length > 0) {
        car.position.x = trajectory[0].x
        car.position.z = -trajectory[0].y
        car.rotation.y = -trajectory[0].theta
      }
    },
    pause: () => { playingRef.current = false },
    reset: () => {
      playingRef.current = false
      trajectoryDataRef.current = []
      currentFrameRef.current = 0
      const car = carGroupRef.current
      if (car) {
        car.position.set(0, car.position.y, 0)
        car.rotation.y = 0
      }
    },
    isPlaying: () => playingRef.current,
    getTrajectory: () => [...trajectoryDataRef.current],
  }), [])

  // ── Render ──
  // Always render the container div so containerRef is available when init runs.
  // Loading/error states are overlaid on top.

  return (
    <div
      ref={containerRef}
      className="h-[400px] w-full bg-solus-bg border border-solus-border rounded-lg overflow-hidden relative"
    >
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-solus-bg z-10">
          <LoadingSpinner size="lg" label="Loading 3D model..." />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-solus-bg z-10">
          <EmptyState
            title="3D viewer unavailable"
            description={`${errorMsg}. Using 2D charts.`}
          />
        </div>
      )}
    </div>
  )
})

MuJoCoViewer.displayName = 'MuJoCoViewer'
export default MuJoCoViewer
