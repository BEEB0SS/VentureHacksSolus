# Teammate 1 — Claude Code Prompt

Paste this entire block into Claude Code after running `claude` in the repo root.

---

Read these files in order before doing anything:
1. PRODUCT_CONTEXT.md
2. packages/shared-types/src/models.py
3. apps/backend/src/database.py
4. team-briefs/TEAMMATE_1_LIVEBENCH_MEMORY.md

I'm building Demo B (Live Bench) + Demo C (Team Memory) with real robot support (Elegoo V4, Yahboom ROSMASTER). Build all 4 files:

## FILE 1: apps/backend/src/live_bench.py

LiveBench class with 4 connection modes. Import models via sys.path to packages/shared-types/src. Use try/except for serial and socket imports.

__init__(project_id): signal_history dict[str,deque], signal_thresholds dict, anomalies list, listeners list, running bool.

async ingest_packet(packet) -> list[Anomaly]: track history, check min/max thresholds, check rate of change, severity warning/error/critical, notify listeners with {packet, anomalies}.

get_current_state(), get_recent_anomalies(), set_thresholds(), add/remove_listener(), stop(), @staticmethod list_serial_ports().

start_simulated(interval=0.1): left_motor=0.5+0.3*sin(t*0.5)+gauss(0,0.02), right_motor=0.5+0.3*cos(t*0.5)+gauss(0,0.02), distance=max(5,50+30*sin(t*0.2)+gauss(0,2)), battery=max(0,12.6-t*0.001+gauss(0,0.05)), imu_roll/pitch=gauss(0,2), motor_temp=25+t*0.01+gauss(0,0.5). 2% chance spike left_motor to random.choice([-0.5,1.5,0]).

start_serial(port, baud=115200): read lines, parse JSON or CSV fallback, don't crash on bad lines.

start_elegoo_wifi(ip="192.168.4.1", port=100): TCP socket to Elegoo V4 ESP32 AP. Send {"N":21} for ultrasonic etc. Best-effort, graceful failure.

start_yahboom_serial(port="/dev/ttyUSB0"): like start_serial but expects Yahboom signal names (motor1-4_speed, imu_roll/pitch/yaw, battery_voltage). Skip binary lines.

## FILE 2: apps/backend/src/routes_livebench.py

FastAPI APIRouter. live_benches dict keyed by project_id. Try/except import MemoryStore.

POST /api/projects/{pid}/live-bench/start — StartConnectionRequest(mode,port,baud,ip,interval), dispatch by mode, set default thresholds.
POST .../start-simulated (backwards compat), .../stop, .../thresholds, .../packet
GET .../state, .../serial-ports
POST /api/projects/{pid}/issues — SQLite + semantic memory
GET .../issues
POST .../fixes — store + update issue status + memory
GET .../similar-issues?query=
WebSocket /ws/projects/{pid}/live-bench

## FILE 3: apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx

Top: mode dropdown (Simulated/Serial/Elegoo WiFi/Yahboom), conditional port/baud/ip fields, Connect/Disconnect, status dot. Signal grid: cards with name, large value (colored), Recharts sparkline (50pts), min/avg/max, status dot. Right sidebar: anomaly feed with severity badge, "Diagnose" button. WebSocket + polling fallback. Tailwind solus-* colors. Hardcode projectId="demo".

## FILE 4: apps/desktop/src/renderer/components/agent/AgentTab.tsx

Chat UI. POST /api/projects/demo/agent/query. User bubbles right, agent left. Query type dropdown (general/debug/search_parts/extract_values/impact_analysis/plan). Basic formatting. Loading dots. Auto-scroll. Local useState.

# Teammate 1 — Claude Code Master Prompt

Read these files in order before doing anything:
1. PRODUCT_CONTEXT.md
2. packages/shared-types/src/models.py
3. apps/backend/src/database.py
4. team-briefs/TEAMMATE_1_LIVEBENCH_MEMORY.md

I'm building Demo B (Live Bench) + Demo C (Team Memory) with real Elegoo V4 robot support, including flashing Arduino code directly from the app.

## WHAT I OWN

Backend:
- apps/backend/src/live_bench.py
- apps/backend/src/arduino_flasher.py (NEW)
- apps/backend/src/routes_livebench.py

Frontend:
- apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx
- apps/desktop/src/renderer/components/agent/AgentTab.tsx

## THE DEMO FLOW

1. User opens Live Bench, sees code editor with Arduino telemetry sketch
2. Clicks "Flash to Robot" → arduino-cli compiles and uploads to /dev/ttyACM0
3. Serial connection auto-starts → real sensor data streams in (distance, motors, battery, IMU, line tracking)
4. All signals show green, sparklines animate
5. User clicks "BUG_ON" quick button → sends command over serial to robot
6. Robot's PID values change from KP=2.0 to KP=50.0 → motors oscillate violently
7. Anomaly feed explodes with warnings (rate-of-change on motor signals)
8. User clicks "Diagnose" on anomaly → INLINE diagnosis panel appears (NOT a chatbot)
9. Agent reads robot source code, identifies KP=50.0 as the problem
10. User clicks "BUG_OFF" → robot stabilizes

## BACKEND FILES TO BUILD

### live_bench.py — CRITICAL FIX: serial.readline() blocks asyncio

The #1 bug: serial.readline() is synchronous. It blocks the event loop so WebSocket listeners never fire. Fix with:
```python
loop = asyncio.get_event_loop()
line = await loop.run_in_executor(None, ser.readline)
```

Support 4 modes: simulated (sin waves + 2% anomaly spikes), serial (JSON from Arduino on /dev/ttyACM0), elegoo_wifi (TCP socket 192.168.4.1:100), yahboom (USB serial with Yahboom signal names).

Parser must handle: JSON lines, plain text "Distance: 9 cm", CSV "key=val,key=val". Add logging for every line received/parsed/dropped.

Store serial connection reference as self.serial_connection so we can write commands to it (for BUG_ON/BUG_OFF).

### arduino_flasher.py — Flash sketches from Solus

Uses arduino-cli (must be installed on system). ArduinoFlasher class with: list_boards(), save_sketch(name, code), compile_and_upload(name, code, port, fqbn="arduino:avr:uno"), get_saved_sketches(). Compile and upload are async (subprocess). Stop serial connection before flashing.

### routes_livebench.py — All routes

Live bench: POST start (mode dispatch), start-simulated, stop, thresholds, packet. GET state, serial-ports.
Arduino: POST /api/arduino/flash, /api/arduino/boards, /api/arduino/sketches.
Issues: POST/GET issues, POST fixes, GET similar-issues.
WebSocket: /ws/projects/{pid}/live-bench — forward {"type":"send_serial","command":"..."} to serial port.

## FRONTEND FILES TO BUILD

### LiveBenchTab.tsx — NOT a chatbot, an instrumentation dashboard

Top bar: mode selector, port/baud fields, Connect/Disconnect, status dot.
Command bar (serial mode): text input + Send + quick buttons "BUG_ON" / "BUG_OFF".
Signal grid: cards with name, large value (colored), Recharts sparkline, min/avg/max.
Anomaly feed: severity badges, "Diagnose" button → INLINE diagnosis panel (not Agent tab).
Code editor (collapsible "Robot Code" section): textarea with default telemetry sketch, "Flash to Robot" button, compile/upload status, board auto-detect.

Key: diagnosis appears INLINE below the anomaly, not in a separate chat tab. This makes it feel like an instrumentation tool.

### AgentTab.tsx — Secondary tool, not the main interface

Chat interface for open-ended questions. POST /api/projects/demo/agent/query. Query type dropdown, message history, basic formatting. This is a SECONDARY interface — the primary AI interaction happens inline in Live Bench via the Diagnose button.

## IMPORTANT CONSTRAINTS

- serial.readline MUST use run_in_executor — this is why serial mode is broken
- Diagnosis is INLINE in Live Bench, not in the Agent tab
- The code editor lets users edit and flash Arduino code without leaving Solus
- Do NOT touch context_engine.py, connectors, main.py, store, simulator files, or solus_agent.py

Do NOT touch any other files.