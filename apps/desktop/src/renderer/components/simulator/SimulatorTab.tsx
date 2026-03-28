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
  const [leftSpeed, setLeftSpeed] = useState(6.0)
  const [rightSpeed, setRightSpeed] = useState(8.0)
  const [nSteps, setNSteps] = useState(2000)
  const [dt, setDt] = useState(0.01)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)

  // Results
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([])
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])

  // UI state
  const [playing, setPlaying] = useState(false)
  const [modelSource, setModelSource] = useState<'default' | 'upload' | 'onshape'>('default')
  const [modelLoading, setModelLoading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [backendLoading, setBackendLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepCount, setStepCount] = useState(0)

  // Optimization
  const [optimizing, setOptimizing] = useState(false)
  const [showOptimizeInput, setShowOptimizeInput] = useState(false)
  const [optimGoal, setOptimGoal] = useState('Tune PID gains to drive a straight line with minimal drift')
  const [viewingOptimized, setViewingOptimized] = useState(false)
  const [optimResult, setOptimResult] = useState<{
    best_params: Record<string, number | null>
    best_score: number
    baseline_score: number
    best_trajectory: TrajectoryPoint[]
    baseline_trajectory: TrajectoryPoint[]
    trials_run: number
    new_mjcf: string | null
    mjcf_changed: boolean
    explanation: string
    changes_summary: string[]
    search_space: Record<string, number[]>
    scoring_function: string
    graph_constraints_used: string[]
  } | null>(null)

  // ── Handlers ──

  const handleReset = useCallback(() => {
    viewerRef.current?.reset()
    setPlaying(false)
    setTrajectory([])
    setDiscrepancies([])
    setStepCount(0)
    setError(null)
    setOptimResult(null)
    setViewingOptimized(false)
    setShowOptimizeInput(false)
  }, [])

  const handlePlay = useCallback(() => {
    if (optimResult) {
      const bp = optimResult.best_params
      if (viewingOptimized) {
        // After: use best params from search
        if (bp.left_speed != null && bp.right_speed != null) {
          viewerRef.current?.play(bp.left_speed as number, bp.right_speed as number)
        } else {
          viewerRef.current?.playWithPID(
            (bp.pid_kp as number) || 0,
            (bp.pid_ki as number) || 0,
            (bp.pid_kd as number) || 0,
            (bp.target_speed as number) || 1.0,
          )
        }
      } else {
        // Before: no PID correction (baseline)
        viewerRef.current?.playWithPID(0, 0, 0, 1.0)
      }
    } else {
      viewerRef.current?.play(leftSpeed, rightSpeed)
    }
    setTrajectory([])
    setStepCount(0)
    setPlaying(true)
  }, [leftSpeed, rightSpeed, optimResult, viewingOptimized])

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

  // Model loading handlers (simplified — model loads automatically)
  const handleLoadDefault = useCallback(() => {
    setModelSource('default')
    handleReset()
  }, [handleReset])

  const handleUploadFile = useCallback(async (_xmlFile: File, _meshFiles: File[]) => {
    setError('Custom model upload not yet supported')
  }, [])

  const handleImportOnshape = useCallback(async (_url: string) => {
    setError('Onshape import not yet supported')
  }, [])

  const runOptimization = useCallback(async () => {
    if (!currentProjectId) return
    setOptimizing(true)
    setError(null)
    setOptimResult(null)
    try {
      // Fetch current MJCF
      const mjcfRes = await fetch('/models/elegoo-rover.xml')
      const currentMjcf = await mjcfRes.text()

      const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/ai-tune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: optimGoal,
          current_mjcf: currentMjcf,
          current_params: {
            left_speed: leftSpeed,
            right_speed: rightSpeed,
            pid_gains: { kp: 0, ki: 0, kd: 0 },
            target_speed: 1.0,
          },
          n_trials: 100,
          n_steps: 200,
        }),
      })
      if (!res.ok) throw new Error(`AI tuning failed: ${res.statusText}`)
      const result = await res.json()
      setOptimResult(result)
      setViewingOptimized(true)
      setTrajectory(result.best_trajectory)
      setShowOptimizeInput(false)

      // If MJCF was changed, reload the model in the viewer
      if (result.mjcf_changed && result.new_mjcf) {
        try {
          await viewerRef.current?.loadModelFromXml(result.new_mjcf)
        } catch (err) {
          console.warn('Failed to reload model:', err)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI tuning failed')
    } finally {
      setOptimizing(false)
    }
  }, [currentProjectId, optimGoal, leftSpeed, rightSpeed])

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
            Differential drive simulation — adjust parameters and compare before/after optimization
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
              {backendLoading ? <LoadingSpinner size="sm" /> : <Play size={14} />}
              {optimResult ? (viewingOptimized ? 'Simulate (After)' : 'Simulate (Before)') : 'Run Simulation'}
            </button>
          )}
          <button
            onClick={() => setShowOptimizeInput(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              showOptimizeInput
                ? 'text-white bg-green-600'
                : 'text-solus-text-dim bg-solus-elevated border border-solus-border hover:bg-solus-surface'
            }`}
          >
            Optimize
          </button>
          {optimResult && (
            <div className="flex items-center bg-solus-elevated border border-solus-border rounded-md overflow-hidden">
              <button
                onClick={() => { setViewingOptimized(false); setTrajectory(optimResult.baseline_trajectory) }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  !viewingOptimized ? 'bg-red-600 text-white' : 'text-solus-text-dim hover:bg-solus-surface'
                }`}
              >
                Before
              </button>
              <button
                onClick={() => { setViewingOptimized(true); setTrajectory(optimResult.best_trajectory) }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  viewingOptimized ? 'bg-green-600 text-white' : 'text-solus-text-dim hover:bg-solus-surface'
                }`}
              >
                After
              </button>
            </div>
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

      {/* Optimize input panel */}
      {showOptimizeInput && (
        <div className="px-4 py-3 border-b border-solus-border bg-solus-surface/50">
          <label className="text-xs text-solus-text-dim mb-1.5 block">What do you want to optimize?</label>
          <div className="flex gap-2">
            <input
              value={optimGoal}
              onChange={e => setOptimGoal(e.target.value)}
              placeholder="e.g. Tune PID gains to drive straight..."
              className="flex-1 bg-solus-elevated border border-solus-border rounded px-3 py-1.5 text-sm text-solus-text focus:outline-none focus:border-solus-accent"
            />
            <button
              onClick={runOptimization}
              disabled={optimizing}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-500 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {optimizing ? <LoadingSpinner size="sm" /> : <Play size={14} />}
              {optimizing ? 'Optimizing...' : 'Run'}
            </button>
          </div>
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
              onReady={() => {}}
              onError={() => {}}
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
                <Card title="AI Optimization Result">
                  <div className="space-y-3">
                    {/* Score improvement */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-solus-text-dim">Score improvement</span>
                      <span className="text-sm font-mono font-semibold text-green-400">
                        {optimResult.baseline_score.toFixed(4)} → {optimResult.best_score.toFixed(4)}
                        {optimResult.baseline_score > 0 && (
                          <> ({((1 - optimResult.best_score / optimResult.baseline_score) * 100).toFixed(0)}% better)</>
                        )}
                      </span>
                    </div>

                    {/* Gemini's explanation */}
                    <div className="bg-solus-elevated/50 rounded-md p-3">
                      <p className="text-xs text-solus-text-dim mb-1 font-semibold">AI Analysis</p>
                      <p className="text-xs text-solus-text whitespace-pre-wrap">{optimResult.explanation}</p>
                    </div>

                    {/* Changes summary */}
                    {optimResult.changes_summary.length > 0 && (
                      <div>
                        <p className="text-xs text-solus-text-dim mb-1 font-semibold">Changes Made</p>
                        <ul className="text-xs text-solus-text space-y-0.5">
                          {optimResult.changes_summary.map((c, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <span className="text-solus-accent mt-0.5">•</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Graph constraints used */}
                    {optimResult.graph_constraints_used.length > 0 && (
                      <div>
                        <p className="text-xs text-solus-text-dim mb-1 font-semibold">Context Model Constraints</p>
                        <ul className="text-xs text-solus-text-muted space-y-0.5">
                          {optimResult.graph_constraints_used.map((c, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <span className="text-solus-warning mt-0.5">⚡</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Search space */}
                    {Object.keys(optimResult.search_space).length > 0 && (
                      <div>
                        <p className="text-xs text-solus-text-dim mb-1 font-semibold">Search Space</p>
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(optimResult.search_space).map(([key, range]) => (
                            <div key={key} className="bg-solus-elevated rounded px-2 py-1 text-xs font-mono">
                              <span className="text-solus-text-muted">{key}:</span>{' '}
                              <span className="text-solus-text">[{(range as number[])[0]}, {(range as number[])[1]}]</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Best params */}
                    <div>
                      <p className="text-xs text-solus-text-dim mb-1 font-semibold">Best Parameters</p>
                      <div className="grid grid-cols-3 gap-1">
                        {Object.entries(optimResult.best_params).filter(([, v]) => v != null).map(([key, value]) => (
                          <div key={key} className="bg-solus-elevated rounded px-2 py-1 text-center">
                            <div className="text-[10px] text-solus-text-muted">{key}</div>
                            <div className="text-xs font-mono font-semibold text-solus-accent">
                              {typeof value === 'number' ? value.toFixed(3) : String(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="text-xs text-solus-text-muted">
                      Tested {optimResult.trials_run} candidates
                      {optimResult.mjcf_changed && ' • Model XML modified'}
                    </div>

                    {/* Before/After trajectory overlay */}
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                          <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <Tooltip contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                          <Line data={optimResult.baseline_trajectory} dataKey="y" name="Before" stroke="#ef4444" dot={false} strokeWidth={2} strokeDasharray="5 5" />
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
