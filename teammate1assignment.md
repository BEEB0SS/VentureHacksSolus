# Teammate 1 Assignment: Demo B (Live Bench) + Demo C (Team Memory)

**Branch:** `feature/livebench-memory`

You own the real-time monitoring system and the team knowledge reuse system,
end-to-end — backend engines, API routes, and frontend tabs.

---

## Demo B Recap — Live Bench Monitoring

1. User clicks "Start Simulated" → robot telemetry streams in
2. Dashboard shows live sensor values with sparklines
3. Anomaly detected (motor speed spike) → red indicator
4. User clicks "Diagnose This" → AI agent (Teammate 2's code) analyzes it
5. Agent uses context model + past issues to explain what went wrong

## Demo C Recap — Team Memory Reuse

1. Engineer logs an issue ("SLAM map won't save")
2. Adds a fix ("map_saver node wasn't subscribed to correct topic")
3. Later, another engineer hits a similar problem
4. System retrieves the past issue + fix via semantic search
5. Shows: "This looks like a past issue. Here's how it was fixed."

---

## Files You Own

### Backend
- `apps/backend/src/live_bench.py` — telemetry engine + anomaly detection
- `apps/backend/src/routes_livebench.py` — your API routes

### Frontend
- `apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx`
- `apps/desktop/src/renderer/components/agent/AgentTab.tsx` (the chat UI)

---

## Backend: What to Build

### live_bench.py — LiveBench class

```python
class LiveBench:
    def __init__(self, project_id: str)
    def set_thresholds(self, thresholds: dict)
    def add_listener(self, callback) / remove_listener(callback)
    async def ingest_packet(self, packet: RuntimePacket) -> list[Anomaly]
    def get_current_state(self) -> dict
    def get_recent_anomalies(self, limit=20) -> list[dict]
    @staticmethod
    def list_serial_ports() -> list[dict]
    async def start_serial(self, port, baud=115200, parser=None)
    async def start_simulated(self, interval=0.1)  # FOR THE DEMO
    def stop(self)
```

**`start_simulated` must look convincing.** Generate:
- `left_motor_speed`: 0.5 + 0.3*sin(t*0.5) + gaussian noise
- `right_motor_speed`: 0.5 + 0.3*cos(t*0.5) + gaussian noise
- `distance_cm`: 50 + 30*sin(t*0.2) + noise
- `battery_voltage`: slowly decreasing from 12.6V
- `imu_roll`, `imu_pitch`: gaussian noise around 0
- `motor_temp`: slowly increasing from 25°C
- **2% chance per tick: inject anomaly spike** (this is what triggers the demo moment)

**Anomaly detection:** check each signal against thresholds (min/max bounds + rate of change).

**Listeners:** when a packet is ingested, notify all WebSocket listeners with `{packet, anomalies}`.

### routes_livebench.py — Your API Routes

Use `APIRouter(prefix="/api")`:

```python
POST /api/projects/{id}/live-bench/start-simulated
POST /api/projects/{id}/live-bench/stop
POST /api/projects/{id}/live-bench/thresholds
POST /api/projects/{id}/live-bench/packet
GET  /api/projects/{id}/live-bench/state
GET  /api/projects/{id}/live-bench/serial-ports

# Team memory routes
POST /api/projects/{id}/issues
GET  /api/projects/{id}/issues
POST /api/projects/{id}/fixes
GET  /api/projects/{id}/similar-issues?query=

# WebSocket
WS   /ws/projects/{id}/live-bench
```

For issues/fixes: store in SQLite, and ALSO store in semantic memory (import MemoryStore
from Teammate 2's code — if it doesn't exist yet, write the import and it'll resolve later).

For WebSocket: accept connection, add as listener to LiveBench, forward packets as JSON.

---

## Frontend: What to Build

### LiveBenchTab.tsx — THE most visually impressive tab

- **Top:** "Start Simulated" / "Stop" buttons
- **Signal grid** (2-3 columns), each card:
  - Signal name (monospace font)
  - Current value (LARGE, colored by status)
  - Sparkline of last 50 values (Recharts LineChart, tiny, no axis labels)
  - Status dot: green/yellow/red
- **Right sidebar: Anomaly feed**
  - Scrolling list with severity badge + timestamp
  - **"Diagnose This" button** → navigate to Agent tab with pre-filled debug query
- **Data:** WebSocket `ws://localhost:8000/ws/projects/{id}/live-bench`
  - On message: update signal cards + anomaly list
  - Fallback: poll `GET /live-bench/state` every 500ms

### AgentTab.tsx — Chat interface for ALL agent queries

This is shared across demos but YOU build the UI:

- Message history (scrollable)
- Input: text field + query type dropdown (general, debug, search_parts, extract_values, impact_analysis, plan)
- Send → `POST /api/projects/{id}/agent/query`
- Show agent response with basic formatting
- Loading spinner while waiting
- When "Diagnose This" is clicked from Live Bench, pre-fill with the anomaly description

---

## Claude Code Prompt

```
Read PRODUCT_CONTEXT.md first, then packages/shared_types/src/models.py and
apps/backend/src/database.py.

I'm building Demo B (Live Bench) + Demo C (Team Memory). Read my full spec at
team-briefs/TEAMMATE_1_LIVEBENCH_MEMORY.md.

Build in this order:
1. apps/backend/src/live_bench.py
2. apps/backend/src/routes_livebench.py (use FastAPI APIRouter(prefix="/api"))
3. apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx
4. apps/desktop/src/renderer/components/agent/AgentTab.tsx

For routes, use APIRouter so it can be included in main.py without conflicts.
Import MemoryStore from src.memory.memory_store — if it doesn't exist yet,
write the import anyway, it'll resolve when Teammate 2 merges.
```