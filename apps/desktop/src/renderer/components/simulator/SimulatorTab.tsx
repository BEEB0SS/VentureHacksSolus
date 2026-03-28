import { useState, useCallback, useRef } from 'react'
import { Play, Pause, RotateCcw, AlertTriangle, ArrowRight } from 'lucide-react'
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
  const [modelSource, setModelSource] = useState<'default' | 'upload' | 'onshape'>('default')
  const [modelLoading, setModelLoading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [backendLoading, setBackendLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepCount, setStepCount] = useState(0)

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

  // ── Handlers ──

  const handleReset = useCallback(() => {
    viewerRef.current?.reset()
    setPlaying(false)
    setTrajectory([])
    setDiscrepancies([])
    setStepCount(0)
    setError(null)
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
      setTrajectory(result.trajectory.map((p: TrajectoryPoint & { step?: number }, i: number) => ({ ...p, step: i + 1 })))
      setStepCount(result.trajectory.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    }
  }, [currentProjectId, nSteps, leftSpeed, rightSpeed, dt, params])

  const handlePlay = useCallback(() => {
    if (!wasmReady) {
      // Fallback to backend
      setBackendLoading(true)
      runBackendSimulation().finally(() => setBackendLoading(false))
      return
    }
    viewerRef.current?.setControls(leftSpeed, rightSpeed)
    viewerRef.current?.play()
    setPlaying(true)
  }, [wasmReady, leftSpeed, rightSpeed, runBackendSimulation])

  const handlePause = useCallback(() => {
    viewerRef.current?.pause()
    setPlaying(false)
  }, [])

  const handleTrajectoryUpdate = useCallback((traj: TrajectoryPoint[]) => {
    setTrajectory([...traj])
    setStepCount(traj.length)
  }, [])

  const handleSimComplete = useCallback(() => {
    setPlaying(false)
  }, [])

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
      setTrajectory(result.best_trajectory)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
    } finally {
      setOptimizing(false)
    }
  }, [currentProjectId])

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
            <button onClick={handlePlay} disabled={backendLoading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-solus-accent rounded-md hover:bg-solus-accent-bright transition-colors disabled:opacity-50 cursor-pointer">
              {backendLoading ? <LoadingSpinner size="sm" /> : <Play size={14} />} Run Simulation
            </button>
          )}
          <button
            onClick={runOptimization}
            disabled={optimizing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-500 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {optimizing ? <LoadingSpinner size="sm" /> : <Play size={14} />}
            {optimizing ? 'Optimizing...' : 'Optimize PID'}
          </button>
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
              onError={() => setWasmReady(false)}
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
