# Demo Flows

> Part of [[Product]]

The 5 demo flows we're presenting at the hackathon. Every feature must serve at least one of these.

## Demo A: Change Propagation (Pratham)
1. User syncs a KiCad project
2. A chip was swapped on the PCB (e.g., motor driver DRV8825 → TMC2209)
3. Context model detects the change via snapshot diff
4. Impact analysis traverses the graph → highlights impacted software modules
5. AI agent explains what breaks and why

**Proves:** The system understands your robot as a whole.
**Wow moment:** Chip swap → instant visual impact on the graph

## Demo B: Live Bench Monitoring (Teammate 1)
1. Robot streams real-time telemetry (simulated for demo)
2. Dashboard shows live sensor values with sparklines
3. Anomaly detected: motor speed spikes beyond threshold
4. AI agent diagnoses using context model + runtime data + past issues

**Proves:** Not just static design analysis — works with live robots.
**Wow moment:** Real-time anomaly → AI diagnosis with historical context

## Demo C: Team Memory Reuse (Teammate 1)
1. Engineer logs an issue ("SLAM map won't save")
2. Adds a fix ("map_saver node wasn't subscribed to correct topic")
3. Later, another engineer hits a similar problem
4. System retrieves the similar past issue + fix via semantic search

**Proves:** Institutional knowledge that scales.
**Wow moment:** "This looks like an issue Person X had on March 15"

## Demo D: External Knowledge + Grounded Planning (Teammate 2)
1. Engineer asks for a motor driver with specific constraints
2. Agent searches datasheets, cross-references with system constraints
3. Returns recommendations with specs, compatibility reasoning, wiring diagram
4. Also: extract PID values from research papers with confidence levels

**Proves:** The external knowledge layer grounds answers in real data.
**Wow moment:** Grounded component recommendation with wiring for YOUR system

## Demo E: Simulator Loop (Teammate 2)
1. Design parameter changes (wheel radius, motor torque constant)
2. Context model updates → MuJoCo simulation runs with updated params
3. Simulated behavior compared against real runtime observations
4. Shows discrepancies between sim and reality

**Proves:** Design → simulation → runtime continuity.
**Wow moment:** "Simulated turn radius is 15cm but Live Bench shows 22cm"

---

## Verified Test Scenarios (March 28, 2026)

These queries have been tested end-to-end against the seeded "Differential Drive Robot" project and confirmed working. Use them for demo practice and regression testing.

### Agent Tab — Debug (Demo C)
- **Query:** "My motor keeps stalling at low RPM" (query type: Debug)
- **Expected:** Agent finds similar past issue in memory (motor stall / microstepping fix), returns diagnosis with memory hits. Expand Sources to see similarity scores.

### Agent Tab — Memory Panel (Demo C)
- **Search:** "motor stall" in the Memory side panel
- **Expected:** Returns seeded issue summaries and reference notes with similarity percentages and metadata tags.

### Agent Tab — General Knowledge
- **Query:** "What components are connected to the ESP32?"
- **Expected:** Agent lists I2C bus, DRV8825, motor controller, sensor reader, and related components from the project graph.

### Agent Tab — Impact Analysis (Demo A)
- **Query type:** Impact → Select "DRV8825 (electrical part)" from dropdown
- **Query:** "What breaks if I replace this with a TMC2209?"
- **Expected:** Agent runs BFS impact analysis, returns impacted entities (NEMA17, motor_rpm) and explains how each is affected.

### Agent Tab — Find Parts (Demo D)
- **Query:** "Recommend a replacement motor driver for the DRV8825 that supports 1/8 microstepping and is compatible with our 12V battery"
- **Expected:** Agent returns component recommendations grounded in the project's context model.

### Context Tab — Graph + Impact
- **Action:** Click DRV8825 node → "Analyze Impact" button
- **Expected:** 2 nodes highlight red (NEMA17, motor_rpm). ESP32 impact shows 6 nodes.

### Workspace Tab — Sources
- **Expected:** Shows "Motor Controller PCB" (KiCad) and "Robot Firmware Repo" (GitHub) as synced sources.

#demos #hackathon #features #testing
