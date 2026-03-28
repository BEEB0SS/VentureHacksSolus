import { useState, useEffect, useCallback } from 'react'
import { Play, RotateCcw, AlertTriangle, ArrowRight } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useProjectStore } from '../../stores/projectStore'
import { API_BASE } from '../../constants/api'
import { Card } from '../shared/Card'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { EmptyState } from '../shared/EmptyState'

// ── Types ──

interface TrajectoryPoint {
  x: number
  y: number
  theta: number
  v_linear: number
  v_angular: number
  timestamp: number
}

interface SimState {
  parameters: Record<string, number>
  trajectory: TrajectoryPoint[]
  position: { x: number; y: number; theta: number }
}

interface Discrepancy {
  signal: string
  simulated: number
  observed: number
  delta: number
}

interface CompareResult {
  discrepancies: Discrepancy[]
  match: boolean
}

interface RunResult {
  n_steps: number
  trajectory: TrajectoryPoint[]
  final_position: { x: number; y: number; theta: number }
}

// ── Default Parameters ──

const DEFAULT_PARAMS: Record<string, number> = {
  wheel_radius: 0.05,
  wheel_base: 0.3,
  motor_torque: 0.5,
  friction: 0.1,
}

const PARAM_LABELS: Record<string, { label: string; unit: string; step: number }> = {
  wheel_radius: { label: 'Wheel Radius', unit: 'm', step: 0.01 },
  wheel_base: { label: 'Wheel Base', unit: 'm', step: 0.05 },
  motor_torque: { label: 'Motor Torque', unit: 'Nm', step: 0.1 },
  friction: { label: 'Friction', unit: 'μ', step: 0.01 },
}

// ── Component ──

export default function SimulatorTab() {
  const { currentProjectId } = useProjectStore()

  // Parameters
  const [params, setParams] = useState<Record<string, number>>({ ...DEFAULT_PARAMS })
  const [leftSpeed, setLeftSpeed] = useState(1.0)
  const [rightSpeed, setRightSpeed] = useState(1.0)
  const [nSteps, setNSteps] = useState(200)
  const [dt, setDt] = useState(0.01)

  // Results
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([])
  const [finalPosition, setFinalPosition] = useState<{ x: number; y: number; theta: number } | null>(null)
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])

  // UI state
  const [loading, setLoading] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load state from backend on mount
  useEffect(() => {
    if (!currentProjectId) return
    fetch(`${API_BASE}/api/projects/${currentProjectId}/simulator/state`)
      .then(res => res.json())
      .then((state: SimState) => {
        if (state.parameters) {
          setParams(prev => ({ ...prev, ...state.parameters }))
        }
        if (state.trajectory?.length > 0) {
          setTrajectory(state.trajectory)
          setFinalPosition(state.position)
        }
      })
      .catch(() => {})
  }, [currentProjectId])

  // Run simulation
  const runSimulation = useCallback(async () => {
    if (!currentProjectId) return
    setLoading(true)
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
      const result: RunResult = await res.json()
      setTrajectory(result.trajectory)
      setFinalPosition(result.final_position)
      setDiscrepancies([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    } finally {
      setLoading(false)
    }
  }, [currentProjectId, nSteps, leftSpeed, rightSpeed, dt, params])

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
      const result: CompareResult = await res.json()
      setDiscrepancies(result.discrepancies)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed')
    } finally {
      setComparing(false)
    }
  }, [currentProjectId, trajectory])

  // Reset
  const resetSimulator = useCallback(() => {
    setParams({ ...DEFAULT_PARAMS })
    setLeftSpeed(1.0)
    setRightSpeed(1.0)
    setNSteps(200)
    setDt(0.01)
    setTrajectory([])
    setFinalPosition(null)
    setDiscrepancies([])
    setError(null)
  }, [])

  if (!currentProjectId) {
    return <EmptyState title="No project selected" description="Select a project from the Workspace tab to use the simulator." />
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-solus-border">
        <div>
          <h2 className="text-sm font-semibold text-solus-text">Simulator</h2>
          <p className="text-xs text-solus-text-muted">Differential drive kinematics — adjust parameters and compare sim vs runtime</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetSimulator}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-solus-text-dim bg-solus-elevated border border-solus-border rounded-md hover:bg-solus-surface transition-colors cursor-pointer"
          >
            <RotateCcw size={14} />
            Reset
          </button>
          <button
            onClick={runSimulation}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-solus-accent rounded-md hover:bg-solus-accent-bright transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? <LoadingSpinner size="sm" /> : <Play size={14} />}
            Run Simulation
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
                  <input
                    type="number"
                    value={params[key] ?? 0}
                    step={step}
                    onChange={e => setParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent"
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Wheel Speeds (rad/s)" compact>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Left Wheel</label>
                <input
                  type="number"
                  value={leftSpeed}
                  step={0.1}
                  onChange={e => setLeftSpeed(parseFloat(e.target.value) || 0)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent"
                />
              </div>
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Right Wheel</label>
                <input
                  type="number"
                  value={rightSpeed}
                  step={0.1}
                  onChange={e => setRightSpeed(parseFloat(e.target.value) || 0)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent"
                />
              </div>
            </div>
          </Card>

          <Card title="Simulation Settings" compact>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Steps</label>
                <input
                  type="number"
                  value={nSteps}
                  step={50}
                  min={1}
                  onChange={e => setNSteps(parseInt(e.target.value) || 100)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent"
                />
              </div>
              <div>
                <label className="text-xs text-solus-text-dim mb-1 block">Time Step (s)</label>
                <input
                  type="number"
                  value={dt}
                  step={0.005}
                  min={0.001}
                  onChange={e => setDt(parseFloat(e.target.value) || 0.01)}
                  className="w-full bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text focus:outline-none focus:border-solus-accent"
                />
              </div>
            </div>
          </Card>

          {finalPosition && (
            <Card title="Final Position" compact>
              <div className="space-y-1 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-solus-text-dim">x</span>
                  <span className="text-solus-text">{finalPosition.x.toFixed(4)} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-solus-text-dim">y</span>
                  <span className="text-solus-text">{finalPosition.y.toFixed(4)} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-solus-text-dim">θ</span>
                  <span className="text-solus-text">{(finalPosition.theta * 180 / Math.PI).toFixed(2)}°</span>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right Panel: Charts + Discrepancies */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {trajectory.length === 0 ? (
            <EmptyState
              title="No simulation data"
              description="Set parameters and click 'Run Simulation' to see the trajectory."
            />
          ) : (
            <>
              <Card title="Trajectory (X-Y Path)">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trajectory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                      <XAxis dataKey="x" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'x (m)', position: 'insideBottom', offset: -5, style: { fontSize: 10, fill: '#94a3b8' } }} />
                      <YAxis dataKey="y" type="number" domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'y (m)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                      <Tooltip contentStyle={{ backgroundColor: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 11 }} labelStyle={{ color: '#94a3b8' }} formatter={(value: number) => [value.toFixed(4), '']} />
                      <Line type="monotone" dataKey="y" stroke="#6366f1" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Velocity Over Time">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trajectory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                      <XAxis dataKey="timestamp" stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, style: { fontSize: 10, fill: '#94a3b8' } }} />
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
                <button
                  onClick={runComparison}
                  disabled={comparing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-solus-text-dim bg-solus-elevated border border-solus-border rounded-md hover:bg-solus-surface transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {comparing ? <LoadingSpinner size="sm" /> : <ArrowRight size={14} />}
                  Compare Sim vs Runtime
                </button>
                {discrepancies.length === 0 && trajectory.length > 0 && !comparing && (
                  <span className="text-xs text-solus-text-muted">Generates mock runtime data with noise for demo</span>
                )}
              </div>

              {discrepancies.length > 0 && (
                <Card title="Discrepancies (Sim vs Runtime)">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-solus-border">
                          <th className="text-left py-2 px-2 text-solus-text-dim font-medium">Signal</th>
                          <th className="text-right py-2 px-2 text-solus-text-dim font-medium">Simulated</th>
                          <th className="text-right py-2 px-2 text-solus-text-dim font-medium">Observed</th>
                          <th className="text-right py-2 px-2 text-solus-text-dim font-medium">Delta</th>
                          <th className="text-right py-2 px-2 text-solus-text-dim font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {discrepancies.map((d, i) => (
                          <DiscrepancyRow key={i} discrepancy={d} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Discrepancy Row with Explain Button ──

function DiscrepancyRow({ discrepancy }: { discrepancy: Discrepancy }) {
  const { currentProjectId, queryAgent } = useProjectStore()
  const [explaining, setExplaining] = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)

  const handleExplain = async () => {
    if (!currentProjectId) return
    setExplaining(true)
    try {
      const result = await queryAgent(
        currentProjectId,
        `Explain this simulation discrepancy: The signal "${discrepancy.signal}" has a simulated value of ${discrepancy.simulated} but the observed runtime value is ${discrepancy.observed} (delta: ${discrepancy.delta}). What could cause this difference and what should I check?`,
        'general'
      ) as { response_text: string }
      setExplanation(result.response_text)
    } catch {
      setExplanation('Failed to get explanation.')
    } finally {
      setExplaining(false)
    }
  }

  return (
    <>
      <tr className="border-b border-solus-border/50 hover:bg-solus-elevated/50">
        <td className="py-2 px-2 font-mono text-solus-text">{discrepancy.signal}</td>
        <td className="py-2 px-2 font-mono text-right text-solus-text">{discrepancy.simulated.toFixed(4)}</td>
        <td className="py-2 px-2 font-mono text-right text-solus-warning">{discrepancy.observed.toFixed(4)}</td>
        <td className="py-2 px-2 font-mono text-right text-solus-error">{discrepancy.delta.toFixed(4)}</td>
        <td className="py-2 px-2 text-right">
          <button
            onClick={handleExplain}
            disabled={explaining}
            className="text-xs text-solus-accent hover:text-solus-accent-bright cursor-pointer disabled:opacity-50"
          >
            {explaining ? '...' : 'Explain'}
          </button>
        </td>
      </tr>
      {explanation && (
        <tr>
          <td colSpan={5} className="px-2 py-2 text-xs text-solus-text-dim bg-solus-elevated/30">
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap">{explanation}</div>
          </td>
        </tr>
      )}
    </>
  )
}
