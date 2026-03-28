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

#demos #hackathon #features
