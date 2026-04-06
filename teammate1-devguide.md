# Teammate 1 — Full Development Guide

Demo B (Live Bench) + Demo C (Team Memory) with Elegoo + Yahboom support.

## 4 Terminals

| Terminal | Purpose |
|----------|---------|
| 1 | Claude Code backend agent (live_bench.py + routes_livebench.py) |
| 2 | Claude Code frontend agent (LiveBenchTab.tsx + AgentTab.tsx) |
| 3 | uvicorn backend (testing) |
| 4 | pnpm run dev:web (testing) |

## Step 0: Branch
```bash
cd ~/Desktop/solus && git checkout -b feature/livebench-memory
```
No API keys needed. No extra installs.

## Step 1: Terminal 1 — Backend Agent
```bash
cd ~/Desktop/solus && claude
```
Paste the contents of claude-prompts/teammate1-prompt.md. The agent reads PRODUCT_CONTEXT.md, models.py, database.py, and your team brief, then builds live_bench.py and routes_livebench.py.

## Step 2: Terminal 2 — Frontend Agent
```bash
cd ~/Desktop/solus && claude
```
Paste the same prompt (it covers all 4 files). Or tell it: "Build only FILE 3 and FILE 4 from claude-prompts/teammate1-prompt.md"

## Step 3: Wire for testing

After backend agent finishes, add to apps/backend/src/main.py:
```python
try:
    from .routes_livebench import router as livebench_router
    app.include_router(livebench_router)
except ImportError:
    print("[warn] routes_livebench not available")
```

After frontend agent finishes, update App.tsx placeholders:
```tsx
import LiveBenchTab from './components/live-bench/LiveBenchTab'
import AgentTab from './components/agent/AgentTab'
```

## Step 4: Test
```bash
# Terminal 3
cd apps/backend && source .venv/bin/activate && uvicorn src.main:app --reload --port 8000

# Terminal 4
cd apps/desktop && pnpm run dev:web
```

```bash
# Simulated
curl -X POST http://localhost:8000/api/projects/demo/live-bench/start \
  -H "Content-Type: application/json" -d '{"mode":"simulated"}'
curl http://localhost:8000/api/projects/demo/live-bench/state
wscat -c ws://localhost:8000/ws/projects/demo/live-bench

# Real Elegoo V4 (connect laptop to ELEGOO-xxxx WiFi first)
curl -X POST .../live-bench/start -d '{"mode":"elegoo_wifi"}'

# Issue (Demo C)
curl -X POST http://localhost:8000/api/projects/demo/issues \
  -H "Content-Type: application/json" \
  -d '{"title":"SLAM map wont save","description":"map_saver not subscribed to /map"}'

# Stop
curl -X POST http://localhost:8000/api/projects/demo/live-bench/stop
```

## Step 5: Commit
```bash
git add -A
git commit -m "Demo B+C: live bench multi-robot, anomaly detection, agent chat, issues/fixes"
git push origin feature/livebench-memory
```

## Optional: Arduino sketch for Elegoo serial mode
Flash to Arduino Uno (remove BT module first):
```arduino
void setup() { Serial.begin(115200); }
void loop() {
  int dist = analogRead(A5); // placeholder for ultrasonic
  float batt = analogRead(A3) * (5.0/1023.0) * 3.0;
  Serial.print("{\"signals\":[");
  Serial.print("{\"name\":\"distance_cm\",\"value\":"); Serial.print(dist);
  Serial.print("},{\"name\":\"battery_v\",\"value\":"); Serial.print(batt,2);
  Serial.println("}]}");
  delay(100);
}
```
Then: `{"mode":"serial","port":"/dev/ttyUSB0","baud":115200}`