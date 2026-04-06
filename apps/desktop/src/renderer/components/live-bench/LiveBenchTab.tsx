import { useState, useEffect, useRef, useCallback } from 'react'
import { LineChart, Line } from 'recharts'
import {
  RefreshCw, Play, Square, RotateCcw,
  Send, Loader2, AlertCircle, Camera, CheckCircle2, ClipboardList,
} from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ID = 'demo'
const API_BASE   = 'http://localhost:8000'
const WS_BASE    = 'ws://localhost:8000'
const BAUD_OPTIONS = [9600, 115200]

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortInfo {
  device: string
  description: string
  is_arduino: boolean
}

interface SignalState {
  current: number
  unit: string
  status: string
  history: number[]
}

interface AnomalyData {
  id: string
  signal_name: string
  severity: 'warning' | 'error' | 'critical'
  description: string
  actual_value: number
  created_at: string
}

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error'

// ─── Signal rendering helpers ─────────────────────────────────────────────────

function getValueColor(name: string, value: number): string {
  if (name === 'running')    return value === 1 ? 'text-solus-success' : 'text-solus-text-muted'
  if (name === 'bug_active') return value === 1 ? 'text-solus-error'   : 'text-solus-success'
  if (name === 'kp_value')   return value > 10  ? 'text-solus-error'   : 'text-solus-success'
  if (name === 'kd_value')   return value === 0 ? 'text-solus-error'   : 'text-solus-success'
  if (name === 'pid_error') {
    const a = Math.abs(value)
    return a > 15 ? 'text-solus-error' : a > 5 ? 'text-solus-warning' : 'text-solus-success'
  }
  if (name.includes('motor')) {
    return (value < -0.2 || value > 1.2) ? 'text-solus-error' : 'text-solus-success'
  }
  return 'text-solus-text'
}

function formatValue(name: string, value: number, unit: string): string {
  if (name === 'running')    return value === 1 ? 'RUNNING'    : 'STOPPED'
  if (name === 'bug_active') return value === 1 ? 'BUG ACTIVE' : 'CLEAN'
  if (unit === 'cm') return `${Math.round(value)} cm`
  if (unit === 'norm') return value.toFixed(3)
  if (unit === 'V') return `${value.toFixed(2)} V`
  return value.toFixed(2)
}

function sparkColor(name: string, history: number[]): string {
  if (!history.length) return '#6366f1'
  const c = getValueColor(name, history[history.length - 1])
  if (c.includes('success')) return '#22c55e'
  if (c.includes('warning')) return '#f59e0b'
  if (c.includes('error'))   return '#ef4444'
  return '#6366f1'
}

// ─── SignalCard ───────────────────────────────────────────────────────────────

function SignalCard({ name, signal }: { name: string; signal: SignalState }) {
  const h = signal.history
  const min = h.length ? Math.min(...h) : 0
  const max = h.length ? Math.max(...h) : 0
  const avg = h.length ? h.reduce((s, v) => s + v, 0) / h.length : 0
  const chartData = h.map((v, i) => ({ v, i }))

  return (
    <div className="bg-solus-elevated border border-solus-border rounded-lg p-3">
      <div className="text-[10px] font-mono text-solus-text-muted uppercase tracking-widest">
        {name.replace(/_/g, ' ')}
      </div>
      <div className={`text-xl font-mono font-bold mt-1 ${getValueColor(name, signal.current)}`}>
        {formatValue(name, signal.current, signal.unit)}
      </div>
      <LineChart width={160} height={36} data={chartData} style={{ marginTop: 4 }}>
        <Line
          type="monotone" dataKey="v"
          stroke={sparkColor(name, h)}
          dot={false} strokeWidth={1.5}
          isAnimationActive={false}
        />
      </LineChart>
      <div className="text-[10px] font-mono text-solus-text-muted mt-1">
        min {min.toFixed(1)} · avg {avg.toFixed(1)} · max {max.toFixed(1)}
      </div>
    </div>
  )
}

// ─── AnomalyItem (simplified — no inline diagnosis) ───────────────────────────

function AnomalyItem({ anomaly }: { anomaly: AnomalyData }) {
  const sev = anomaly.severity
  const sevBadge =
    sev === 'critical' ? 'bg-red-400/15 text-red-400' :
    sev === 'error'    ? 'bg-solus-error/15 text-solus-error' :
                         'bg-solus-warning/15 text-solus-warning'

  return (
    <div className="p-3 border-b border-solus-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${sevBadge}`}>
            {sev.toUpperCase()}
          </span>
          <span className="text-xs font-mono text-solus-text-dim">
            {anomaly.signal_name.replace(/_/g, ' ')}
          </span>
        </div>
        <span className="text-[10px] text-solus-text-muted font-mono">
          {new Date(anomaly.created_at).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          })}
        </span>
      </div>
      <div className="text-[11px] text-solus-text-dim mt-1">{anomaly.description}</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LiveBenchTab() {
  const [connState, setConnState]             = useState<ConnState>('disconnected')
  const [mode, setMode]                       = useState<'simulated' | 'serial'>('simulated')
  const [ports, setPorts]                     = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort]       = useState('')
  const [selectedBaud, setSelectedBaud]       = useState(9600)
  const [cameraIp, setCameraIp]               = useState('192.168.4.1')
  const [cameraAvailable, setCameraAvailable] = useState(false)

  const [signals, setSignals]     = useState<Record<string, SignalState>>({})
  const [anomalies, setAnomalies] = useState<AnomalyData[]>([])

  const [cmdInput, setCmdInput]       = useState('')
  const [toast, setToast]             = useState<string | null>(null)
  const [logsSent, setLogsSent]       = useState(false)
  const [cameraRetryKey, setCameraRetryKey] = useState(0)
  const cameraRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flash notification banner from WS event
  const [flashBanner, setFlashBanner] = useState<{ message: string } | null>(null)

  const wsRef    = useRef<WebSocket | null>(null)
  const connRef  = useRef<ConnState>('disconnected')
  connRef.current = connState

  // ── Port loading ─────────────────────────────────────────────────────────────

  const loadPorts = useCallback(() => {
    fetch(`${API_BASE}/api/serial-ports`)
      .then(r => r.json())
      .then(data => {
        const list: PortInfo[] = data.ports ?? []
        const sorted = [...list.filter(p => p.is_arduino), ...list.filter(p => !p.is_arduino)]
        setPorts(sorted)
        if (!selectedPort) {
          const arduino = sorted.find(p => p.is_arduino)
          setSelectedPort(arduino?.device ?? sorted[0]?.device ?? '/dev/ttyUSB0')
        }
      })
      .catch(() => {
        setPorts([])
        if (!selectedPort) setSelectedPort('/dev/ttyUSB0')
      })
  }, [selectedPort])

  useEffect(() => { loadPorts() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera status check on mode/ip change ────────────────────────────────────

  useEffect(() => {
    if (mode === 'serial' && cameraIp) {
      fetch(`${API_BASE}/api/projects/${PROJECT_ID}/live-bench/camera/status?ip=${cameraIp}`)
        .then(r => r.json())
        .then(data => setCameraAvailable(data.available ?? false))
        .catch(() => setCameraAvailable(false))
    }
  }, [mode, cameraIp, connState])

  // ── Toast helper ──────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }, [])

  // ── Connect ───────────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    // Clear stale state BEFORE connecting
    setSignals({})
    setAnomalies([])
    setLogsSent(false)
    setConnState('connecting')

    const body = mode === 'simulated'
      ? { mode: 'simulated' }
      : { mode: 'serial', port: selectedPort, baud: selectedBaud }

    try {
      await fetch(`${API_BASE}/api/projects/${PROJECT_ID}/live-bench/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const ws = new WebSocket(`${WS_BASE}/ws/projects/${PROJECT_ID}/live-bench`)

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data as string)
        console.log('[WS]', data)

        // Disconnected event — zero out
        if (data.event === 'disconnected') {
          setSignals({})
          setAnomalies([])
          return
        }

        // Code flashed notification
        if (data.event === 'code_flashed') {
          setFlashBanner({ message: data.message ?? 'New code deployed to robot. Reconnect to see the fix.' })
          setTimeout(() => setFlashBanner(null), 15000)
          return
        }

        // Telemetry packet
        if (data.packet?.signals) {
          setSignals(prev => {
            const next = { ...prev }
            for (const sig of data.packet.signals as { name: string; value: number; unit?: string }[]) {
              const old = next[sig.name] || { history: [] as number[], current: 0, unit: '', status: 'healthy' }
              next[sig.name] = {
                current: sig.value,
                unit: sig.unit ?? '',
                status: data.packet.status ?? 'healthy',
                history: [...old.history.slice(-49), sig.value],
              }
            }
            return next
          })
        }

        if (data.anomalies?.length > 0) {
          setAnomalies(prev => [
            ...(data.anomalies as AnomalyData[]).map(a => ({ ...a, id: a.id || crypto.randomUUID() })),
            ...prev,
          ].slice(0, 100))
        }

        setConnState('connected')
      }

      ws.onerror = () => setConnState('error')
      ws.onclose = () => {
        if (connRef.current === 'connected') setConnState('disconnected')
      }

      wsRef.current = ws
    } catch (err) {
      console.error('[LiveBench] connect failed:', err)
      setConnState('error')
    }
  }, [mode, selectedPort, selectedBaud])

  // ── Disconnect ────────────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onmessage = null  // prevent queued packets from firing after close
      wsRef.current.close()
      wsRef.current = null
    }
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/live-bench/stop`, { method: 'POST' }).catch(() => {})
    // Zero out everything
    setSignals({})
    setAnomalies([])
    setLogsSent(false)
    setFlashBanner(null)
    setConnState('disconnected')
  }, [])

  // ── Send command ──────────────────────────────────────────────────────────────

  const sendCommand = useCallback((cmd: string) => {
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/live-bench/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    }).catch(() => {})
    showToast(`Sent: ${cmd}`)
    setCmdInput('')
  }, [showToast])

  // ── Send Logs to Agent ────────────────────────────────────────────────────────

  const sendLogsToAgent = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${PROJECT_ID}/live-bench/logs`)
      const logsResponse = await res.json()

      window.localStorage.setItem('solus_agent_context', JSON.stringify({
        source: 'live_bench',
        logs: logsResponse,
        timestamp: Date.now(),
        prompt: `The robot is experiencing anomalies. Here is the telemetry data:\n\n${logsResponse.summary}\n\nThe robot runs on an Elegoo V4 with a TB6612 motor driver. The Arduino code uses PID obstacle avoidance. Analyze these logs, identify the bug in the Arduino code, and generate corrected code that I can flash to the robot.`,
      }))

      setLogsSent(true)
      showToast('Logs sent — switch to Agent tab')
    } catch (err) {
      showToast('Failed to fetch logs')
      console.error('[LiveBench] sendLogsToAgent failed:', err)
    }
  }, [showToast])

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  useEffect(() => () => {
    if (wsRef.current) {
      wsRef.current.onmessage = null
      wsRef.current.close()
    }
    if (cameraRetryTimer.current) clearTimeout(cameraRetryTimer.current)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  const isConnected  = connState === 'connected'
  const isConnecting = connState === 'connecting'
  const isSerial     = mode === 'serial'
  const signalList   = Object.entries(signals)
  const sigCount     = signalList.length
  const anomCount    = anomalies.length

  const statusDotClass =
    isConnected  ? 'bg-solus-success animate-pulse' :
    isConnecting ? 'bg-solus-warning animate-pulse' :
    connState === 'error' ? 'bg-solus-error' :
    'bg-solus-text-muted'

  return (
    <div className="h-full flex flex-col bg-solus-bg overflow-hidden">

      {/* ── Flash notification banner ─────────────────────────────────────────── */}
      {flashBanner && (
        <div className="flex-shrink-0 mx-3 mt-3 bg-solus-success/15 border border-solus-success/30 text-solus-success p-3 rounded-lg flex items-center gap-3">
          <CheckCircle2 size={14} className="flex-shrink-0" />
          <span className="flex-1 text-xs font-mono">
            {flashBanner.message} Click Reconnect to start monitoring.
          </span>
          <button
            onClick={() => { setFlashBanner(null); handleDisconnect(); setTimeout(handleConnect, 300) }}
            className="px-2.5 py-1 text-xs font-mono bg-solus-success/20 hover:bg-solus-success/30 border border-solus-success/40 rounded transition-colors"
          >
            Reconnect
          </button>
          <button
            onClick={() => setFlashBanner(null)}
            className="text-solus-success/60 hover:text-solus-success transition-colors text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 1. Connection Bar ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 bg-solus-surface border-b border-solus-border p-2 flex-wrap mt-0">

        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDotClass}`} />

        <select
          value={mode}
          onChange={e => { setMode(e.target.value as 'simulated' | 'serial'); setSignals({}); setAnomalies([]) }}
          disabled={isConnected || isConnecting}
          className="bg-solus-elevated border border-solus-border rounded px-2 py-1 text-sm text-solus-text disabled:opacity-50"
        >
          <option value="simulated">Simulated</option>
          <option value="serial">Serial</option>
        </select>

        {isSerial && (
          <>
            <div className="flex items-center gap-1">
              <select
                value={selectedPort}
                onChange={e => setSelectedPort(e.target.value)}
                disabled={isConnected || isConnecting}
                className="bg-solus-elevated border border-solus-border rounded px-2 py-1 text-sm font-mono text-solus-text disabled:opacity-50 max-w-[220px]"
              >
                {ports.length === 0
                  ? <option value="" disabled>No ports detected</option>
                  : ports.map(p => (
                      <option key={p.device} value={p.device}>
                        {p.device} — {p.description}{p.is_arduino ? ' ✓' : ''}
                      </option>
                    ))}
              </select>
              <button
                onClick={loadPorts}
                disabled={isConnected || isConnecting}
                title="Refresh ports"
                className="p-1 text-solus-text-muted hover:text-solus-text-dim transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} />
              </button>
            </div>

            <select
              value={selectedBaud}
              onChange={e => setSelectedBaud(Number(e.target.value))}
              disabled={isConnected || isConnecting}
              className="bg-solus-elevated border border-solus-border rounded px-2 py-1 text-sm font-mono text-solus-text disabled:opacity-50"
            >
              {BAUD_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            <input
              value={cameraIp}
              onChange={e => { setCameraIp(e.target.value); setCameraAvailable(false) }}
              placeholder="Camera IP"
              className="w-32 bg-solus-elevated border border-solus-border rounded px-2 py-1 text-sm font-mono text-solus-text placeholder:text-solus-text-muted focus:outline-none focus:border-solus-accent/60"
            />
          </>
        )}

        {!isConnected
          ? <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-3 py-1 bg-solus-success text-white text-sm font-mono rounded hover:bg-solus-success/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting && <Loader2 size={12} className="animate-spin" />}
              {isConnecting ? 'Connecting…' : 'Connect'}
            </button>
          : <button
              onClick={handleDisconnect}
              className="px-3 py-1 bg-solus-error text-white text-sm font-mono rounded hover:bg-solus-error/80 transition-colors"
            >
              Disconnect
            </button>}

        {sigCount > 0 && (
          <span className="ml-auto text-xs text-solus-text-muted font-mono">
            {sigCount} signals · {anomCount} anomalies
          </span>
        )}
      </div>

      {/* ── 2. Robot Control Bar (serial + connected only) ─────────────────────── */}
      {isConnected && isSerial && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-solus-surface/50 border-b border-solus-border p-2 flex-wrap">

          {[
            { cmd: 'START', icon: <Play size={11} />,      cls: 'bg-solus-success/15 text-solus-success border-solus-success/30 hover:bg-solus-success/25' },
            { cmd: 'STOP',  icon: <Square size={11} />,    cls: 'bg-solus-error/15 text-solus-error border-solus-error/30 hover:bg-solus-error/25' },
            { cmd: 'SWEEP', icon: <RotateCcw size={11} />, cls: 'bg-solus-elevated text-solus-text-dim border-solus-border hover:bg-solus-border' },
          ].map(({ cmd, icon, cls }) => (
            <button key={cmd}
              onClick={() => sendCommand(cmd)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-mono border rounded transition-colors ${cls}`}
            >
              {icon} {cmd}
            </button>
          ))}

          <div className="w-px h-6 bg-solus-border mx-1" />

          <input
            value={cmdInput}
            onChange={e => setCmdInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && cmdInput.trim() && sendCommand(cmdInput.trim())}
            placeholder="Custom command…"
            className="w-36 bg-solus-elevated border border-solus-border rounded px-2 py-1.5 text-xs font-mono text-solus-text placeholder:text-solus-text-muted focus:outline-none focus:border-solus-accent/60"
          />
          <button
            onClick={() => cmdInput.trim() && sendCommand(cmdInput.trim())}
            className="flex items-center gap-1 px-2 py-1.5 text-xs bg-solus-elevated hover:bg-solus-border border border-solus-border text-solus-text-dim rounded transition-colors"
          >
            <Send size={11} /> Send
          </button>

          {toast && (
            <span className="ml-auto text-xs font-mono text-solus-success animate-pulse">{toast}</span>
          )}
        </div>
      )}

      {/* ── 3. Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0">

        {/* Left column */}
        <div className="flex-1 overflow-y-auto p-3">

          {connState === 'disconnected' && (
            <div className="h-full flex flex-col items-center justify-center text-solus-text-muted gap-3">
              <div className="text-4xl opacity-20">◎</div>
              <p className="text-sm">Connect to your robot to start monitoring</p>
              {isSerial && ports.length > 0 && (
                <p className="text-xs font-mono">{selectedPort || ports[0]?.device}</p>
              )}
            </div>
          )}

          {isConnecting && (
            <div className="h-full flex flex-col items-center justify-center text-solus-text-muted gap-2">
              <Loader2 size={28} className="animate-spin opacity-50" />
              <p className="text-sm">Connecting…</p>
              {isSerial && <p className="text-xs font-mono opacity-50">(waiting for Arduino boot)</p>}
            </div>
          )}

          {connState === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <AlertCircle size={28} className="text-solus-error opacity-60" />
              <p className="text-sm text-solus-error">Connection failed</p>
              <button onClick={handleConnect}
                className="px-3 py-1.5 text-xs font-mono bg-solus-elevated border border-solus-border text-solus-text-dim rounded hover:bg-solus-border transition-colors">
                Retry
              </button>
            </div>
          )}

          {isConnected && (
            <>
              {/* Camera feed */}
              {isSerial && cameraIp && (
                <div className="mx-0 mb-3 bg-black rounded-lg overflow-hidden relative">
                  {cameraAvailable
                    ? <>
                        <img
                          src={`${API_BASE}/api/projects/${PROJECT_ID}/live-bench/camera?ip=${cameraIp}&_r=${cameraRetryKey}`}
                          alt="Robot Camera"
                          className="w-full h-auto max-h-48 object-contain"
                          onError={() => {
                            if (cameraRetryTimer.current) clearTimeout(cameraRetryTimer.current)
                            cameraRetryTimer.current = setTimeout(() => setCameraRetryKey(k => k + 1), 3000)
                          }}
                        />
                        <span className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                          LIVE
                        </span>
                      </>
                    : <div className="h-32 flex items-center justify-center gap-2 text-solus-text-muted">
                        <Camera size={14} className="opacity-40" />
                        <span className="text-xs">Camera unavailable — connect laptop to ELEGOO WiFi network</span>
                      </div>}
                </div>
              )}

              {sigCount === 0
                ? <div className="h-40 flex items-center justify-center">
                    <p className="text-sm text-solus-text-muted animate-pulse">Waiting for telemetry…</p>
                  </div>
                : <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                    {signalList.map(([name, sig]) => (
                      <SignalCard key={name} name={name} signal={sig} />
                    ))}
                  </div>}
            </>
          )}
        </div>

        {/* Right column — anomaly sidebar */}
        <div className="w-72 flex-shrink-0 border-l border-solus-border bg-solus-surface flex flex-col">
          <div className="p-3 border-b border-solus-border flex items-center">
            <span className="text-[10px] font-mono tracking-widest text-solus-text-muted">ANOMALIES</span>
            {anomCount > 0 && (
              <span className="bg-solus-error/20 text-solus-error text-[10px] px-1.5 rounded-full ml-2 font-mono">
                {anomCount}
              </span>
            )}
          </div>

          {/* Send Logs to Agent button */}
          <div className="p-2 border-b border-solus-border">
            <button
              onClick={sendLogsToAgent}
              disabled={anomCount === 0}
              className={`w-full py-2 rounded text-xs font-mono flex items-center justify-center gap-1.5 border transition-colors ${
                logsSent
                  ? 'bg-solus-success/15 text-solus-success border-solus-success/30'
                  : 'bg-solus-accent/15 text-solus-accent border-solus-accent/30 hover:bg-solus-accent/25 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {logsSent
                ? <><CheckCircle2 size={11} /> Logs sent to Agent tab ✓</>
                : <><ClipboardList size={11} /> Send Logs to Agent</>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {anomalies.length === 0
              ? <div className="flex flex-col items-center justify-center h-full text-solus-text-muted text-xs gap-2">
                  <AlertCircle size={20} className="opacity-20" />
                  No anomalies
                </div>
              : anomalies.map(a => (
                  <AnomalyItem key={a.id} anomaly={a} />
                ))}
          </div>
        </div>

      </div>
    </div>
  )
}
