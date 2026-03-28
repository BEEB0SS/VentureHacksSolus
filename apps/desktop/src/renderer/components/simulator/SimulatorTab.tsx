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
  const [leftSpeed, setLeftSpeed] = useState(8.0)
  const [rightSpeed, setRightSpeed] = useState(8.0)
  const [nSteps, setNSteps] = useState(500)
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
  const [optimGoal, setOptimGoal] = useState('')
  const [viewingOptimized, setViewingOptimized] = useState(false)
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
    setOptimResult(null)
    setViewingOptimized(false)
    setShowOptimizeInput(false)
  }, [])

  const handlePlay = useCallback(async () => {
    // Pick the trajectory to play
    let traj: TrajectoryPoint[]

    if (optimResult) {
      // Use the before/after trajectory based on toggle
      traj = viewingOptimized ? optimResult.best_trajectory : optimResult.bad_trajectory
    } else {
      // No optimization yet — run PID sim with bad gains (no correction = car drifts)
      if (!currentProjectId) return
      setBackendLoading(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/run-pid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kp: 0, ki: 0, kd: 0, n_steps: nSteps, dt }),
        })
        if (!res.ok) throw new Error(`Simulation failed: ${res.statusText}`)
        const result = await res.json()
        traj = result.trajectory
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Simulation failed')
        setBackendLoading(false)
        return
      }
      setBackendLoading(false)
    }

    // Normalize trajectory to start at origin (backend sim accumulates position)
    const x0 = traj[0]?.x ?? 0
    const y0 = traj[0]?.y ?? 0
    const theta0 = traj[0]?.theta ?? 0
    const normalizedTraj = traj.map((p: TrajectoryPoint & { step?: number }, i: number) => ({
      ...p,
      x: p.x - x0,
      y: p.y - y0,
      theta: p.theta - theta0,
      step: i + 1,
    }))

    // Update charts
    setTrajectory(normalizedTraj)
    setStepCount(normalizedTraj.length)

    // Animate in 3D viewer
    viewerRef.current?.playTrajectory(normalizedTraj)
    setPlaying(true)
  }, [currentProjectId, nSteps, leftSpeed, rightSpeed, dt, params, optimResult, viewingOptimized])

  const handlePause = useCallback(() => {
    viewerRef.current?.pause()
    setPlaying(false)
  }, [])

  const handleTrajectoryUpdate = useCallback((traj: TrajectoryPoint[], currentIndex: number) => {
    setStepCount(currentIndex + 1)
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
      const res = await fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n_trials: 300, n_steps: 500 }),
      })
      if (!res.ok) throw new Error(`Optimization failed: ${res.statusText}`)
      const result = await res.json()
      // Brief pause so the loading state feels substantial
      await new Promise(resolve => setTimeout(resolve, 1500))
      setOptimResult(result)
      setViewingOptimized(true)
      setTrajectory(result.best_trajectory)
      setShowOptimizeInput(false)
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
    return <EmptyState title="No project selected" description="Select a project from the Workspace tab." />
  }

  const inputCls = "w-full bg-solus-bg border border-solus-border/50 rounded-lg px-3 py-2 text-[13px] font-mono text-solus-text focus:outline-none focus:border-solus-accent/50 transition-colors"

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-solus-border/40 shrink-0">
        <span className="text-[14px] font-medium text-solus-text tracking-wide">Simulator</span>
        <div className="flex items-center gap-4">
          <button
            onClick={handleReset}
            className="flex items-center gap-2.5 px-6 py-3 text-[13px] font-medium rounded-lg bg-[#16161d] border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#3a3a4a] transition-colors cursor-pointer"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <div className="w-px h-8 bg-[#1e1e2a]" />
          {playing ? (
            <button
              onClick={handlePause}
              className="flex items-center gap-2.5 px-6 py-3 text-[13px] font-medium rounded-lg text-white bg-amber-600 hover:bg-amber-500 transition-colors cursor-pointer"
            >
              <Pause size={14} /> Pause
            </button>
          ) : (
            <button
              onClick={handlePlay}
              disabled={backendLoading}
              className="flex items-center gap-2.5 px-6 py-3 text-[13px] font-medium rounded-lg text-white bg-[#6366f1] hover:bg-[#818cf8] disabled:opacity-40 transition-colors cursor-pointer"
            >
              {backendLoading ? <LoadingSpinner size="sm" /> : <Play size={14} />}
              {optimResult ? (viewingOptimized ? 'Simulate After' : 'Simulate Before') : 'Simulate'}
            </button>
          )}
          <button
            onClick={runOptimization}
            disabled={optimizing}
            className={`flex items-center gap-2.5 px-6 py-3 text-[13px] font-medium rounded-lg transition-colors cursor-pointer ${
              optimizing
                ? 'text-white bg-emerald-600'
                : 'bg-[#16161d] border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#3a3a4a]'
            }`}
          >
            {optimizing ? <><LoadingSpinner size="sm" /> Optimizing...</> : 'Optimize'}
          </button>
          {optimResult && (
            <>
              <div className="w-px h-8 bg-[#1e1e2a]" />
              <div className="flex items-center rounded-lg overflow-hidden border border-[#2a2a3a]">
                <button
                  onClick={() => { setViewingOptimized(false); setTrajectory(optimResult.bad_trajectory) }}
                  className={`px-6 py-3 text-[13px] font-medium transition-colors cursor-pointer ${
                    !viewingOptimized ? 'bg-red-500/15 text-red-400' : 'text-[#4e4e62] hover:text-[#8b8b9e]'
                  }`}
                >
                  Before
                </button>
                <div className="w-px h-6 bg-[#2a2a3a]" />
                <button
                  onClick={() => { setViewingOptimized(true); setTrajectory(optimResult.best_trajectory) }}
                  className={`px-6 py-3 text-[13px] font-medium transition-colors cursor-pointer ${
                    viewingOptimized ? 'bg-emerald-500/15 text-emerald-400' : 'text-[#4e4e62] hover:text-[#8b8b9e]'
                  }`}
                >
                  After
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-solus-error/5 border-b border-solus-error/10 px-8 py-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-solus-error/60" />
          <span className="text-[12px] text-solus-error/70">{error}</span>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — Settings */}
        <div className="w-60 border-r border-solus-border/40 overflow-y-auto px-7 py-7 space-y-7">
          <div className="space-y-6">
            <div>
              <label className="text-[13px] text-solus-text-dim mb-2.5 block">Steps</label>
              <input type="number" value={nSteps} step={100} min={1}
                onChange={e => setNSteps(parseInt(e.target.value) || 100)} className={inputCls} />
            </div>
            <div>
              <label className="text-[13px] text-solus-text-dim mb-2.5 block">Playback Speed</label>
              <div className="flex items-center gap-4 mt-1">
                <input type="range" min={0.25} max={4} step={0.25} value={playbackSpeed}
                  onChange={e => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="flex-1" />
                <span className="text-[12px] font-mono text-solus-text-muted w-8 text-right">{playbackSpeed}x</span>
              </div>
            </div>
          </div>

          {/* PID Gains — read-only, shows current policy */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[13px] text-solus-text-dim">PID Gains</label>
              {(!optimResult || !viewingOptimized) && (
                <span className="text-[10px] text-red-400/70 uppercase tracking-wider">Untuned</span>
              )}
              {optimResult && viewingOptimized && (
                <span className="text-[10px] text-emerald-400/70 uppercase tracking-wider">Optimized</span>
              )}
            </div>
            {['kp', 'ki', 'kd'].map((key) => {
              const value = optimResult && viewingOptimized
                ? optimResult.best_gains[key as keyof typeof optimResult.best_gains]
                : 0
              return (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-[12px] font-mono text-solus-text-muted uppercase">{key}</span>
                  <span className={`text-[14px] font-mono ${optimResult && viewingOptimized ? 'text-emerald-400' : 'text-red-400/70'}`}>
                    {value.toFixed(3)}
                  </span>
                </div>
              )
            })}
          </div>

          {stepCount > 0 && (
            <div>
              <div className="flex justify-between text-[12px] font-mono text-solus-text-muted mb-2.5">
                <span>Progress</span>
                <span>{stepCount} / {nSteps}</span>
              </div>
              <div className="h-1.5 bg-solus-border/20 rounded-full overflow-hidden">
                <div className="h-full bg-solus-accent/50 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (stepCount / nSteps) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Right — Viewer + Charts */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8 space-y-8">
            <MuJoCoViewer
              ref={viewerRef}
              playbackSpeed={playbackSpeed}
              onTrajectoryUpdate={handleTrajectoryUpdate}
              onSimComplete={handleSimComplete}
              onReady={() => {}}
              onError={() => {}}
            />

            {trajectory.length > 0 && (
              <div className="space-y-8">
                <Card title="Trajectory">
                  <div className="h-52 mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      {optimResult ? (
                        <LineChart margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" />
                          <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                          <Tooltip contentStyle={{ backgroundColor: '#0f0f13', border: '1px solid #1e1e2a', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#8b8b9e', paddingTop: 8 }} />
                          <Line data={optimResult.bad_trajectory} dataKey="y" name="Before" stroke="#f87171" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
                          <Line data={optimResult.best_trajectory} dataKey="y" name="After" stroke="#34d399" dot={false} strokeWidth={2} />
                        </LineChart>
                      ) : (
                        <LineChart data={trajectory} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" />
                          <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                          <Tooltip contentStyle={{ backgroundColor: '#0f0f13', border: '1px solid #1e1e2a', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} formatter={(value: number) => [value.toFixed(4), '']} />
                          <Line type="monotone" dataKey="y" stroke="#6366f1" dot={false} strokeWidth={1.5} />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Velocity">
                  <div className="h-44 mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trajectory} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" />
                        <XAxis dataKey="timestamp" stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                        <YAxis stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f0f13', border: '1px solid #1e1e2a', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} formatter={(value: number) => [value.toFixed(4), '']} />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#8b8b9e', paddingTop: 8 }} />
                        <Line type="monotone" dataKey="v_linear" name="Linear" stroke="#34d399" dot={false} strokeWidth={1.5} />
                        <Line type="monotone" dataKey="v_angular" name="Angular" stroke="#fbbf24" dot={false} strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {optimResult && (
                  <Card title="Optimization Result">
                    <div className="space-y-5 mt-1">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12px] text-solus-text-muted">Score</span>
                        <div className="font-mono text-[13px]">
                          <span className="text-red-400/70">{optimResult.bad_score.toFixed(4)}</span>
                          <span className="text-solus-text-muted mx-2">&rarr;</span>
                          <span className="text-emerald-400">{optimResult.best_score.toFixed(4)}</span>
                          <span className="text-emerald-400/50 ml-2 text-[11px]">
                            {((1 - optimResult.best_score / optimResult.bad_score) * 100).toFixed(0)}% better
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        {Object.entries(optimResult.best_gains).map(([key, value]) => (
                          <div key={key} className="bg-solus-bg rounded-lg px-4 py-3 text-center">
                            <div className="text-[10px] text-solus-text-muted uppercase tracking-[0.1em] mb-1">{key}</div>
                            <div className="text-[16px] font-mono text-solus-accent-bright">{value.toFixed(3)}</div>
                          </div>
                        ))}
                      </div>

                      <div className="text-[11px] text-solus-text-muted">{optimResult.trials_run} candidates tested</div>

                      <div className="h-48 mt-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" />
                            <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                            <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#4e4e62" tick={{ fontSize: 11, fill: '#8b8b9e' }} />
                            <Tooltip contentStyle={{ backgroundColor: '#0f0f13', border: '1px solid #1e1e2a', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} />
                            <Legend wrapperStyle={{ fontSize: 11, color: '#8b8b9e', paddingTop: 8 }} />
                            <Line data={optimResult.bad_trajectory} dataKey="y" name="Before" stroke="#f87171" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
                            <Line data={optimResult.best_trajectory} dataKey="y" name="After" stroke="#34d399" dot={false} strokeWidth={1.5} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </Card>
                )}

                <div className="pt-2">
                  <button onClick={runComparison} disabled={comparing} className="flex items-center gap-2.5 px-6 py-3 text-[13px] font-medium rounded-lg bg-[#16161d] border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#3a3a4a] disabled:opacity-40 transition-colors cursor-pointer">
                    {comparing ? <LoadingSpinner size="sm" /> : <ArrowRight size={14} />}
                    Compare Sim vs Runtime
                  </button>
                </div>

                {discrepancies.length > 0 && (
                  <Card title="Discrepancies">
                    <table className="w-full text-[12px] mt-2">
                      <thead>
                        <tr className="border-b border-solus-border/30">
                          <th className="text-left py-2.5 px-3 text-solus-text-muted font-normal">Signal</th>
                          <th className="text-right py-2.5 px-3 text-solus-text-muted font-normal">Sim</th>
                          <th className="text-right py-2.5 px-3 text-solus-text-muted font-normal">Real</th>
                          <th className="text-right py-2.5 px-3 text-solus-text-muted font-normal">Delta</th>
                          <th className="w-16"></th>
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
              </div>
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
