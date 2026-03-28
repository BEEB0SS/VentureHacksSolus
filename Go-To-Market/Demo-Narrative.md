# Demo Narrative

> Part of [[Go-To-Market]]

The story we tell while demoing Solus. The order is designed to build understanding progressively.

## Suggested Demo Order

### 1. Start with the Problem (30 seconds)
"Robotics teams use 6+ disconnected tools. No tool understands the robot as a full system. When you swap a chip in your PCB, nobody knows what software breaks until it breaks. Engineers spend more time debugging integration than building features."

### 2. Demo A: Change Propagation (60 seconds)
Show the Context Model graph with a synced KiCad project. Swap a motor driver chip. Re-sync. Watch the graph light up with impacted software modules. AI explains what breaks and why.

**Key line:** "The system understands your robot as a whole — hardware AND software."

### 3. Demo B: Live Bench (45 seconds)
Start simulated telemetry. Show live sparklines updating in real-time. Wait for an anomaly spike. Click "Diagnose This." AI uses the context model + past issues to explain what went wrong.

**Key line:** "Not just static design analysis — it works with live robots."

### 4. Demo C: Team Memory (30 seconds)
Show a past logged issue. Type a similar query. System retrieves the past fix automatically.

**Key line:** "Your team's knowledge never gets lost."

### 5. Demo D: External Knowledge (30 seconds)
Ask for a motor driver with specific constraints. Show grounded recommendation with compatibility reasoning.

**Key line:** "Answers grounded in real data, not hallucinations."

### 6. Demo E: Simulator (30 seconds)
Change a wheel parameter. Run simulation. Show sim vs reality discrepancy.

**Key line:** "Design to simulation to runtime — one continuous loop."

### 7. Close with Vision (15 seconds)
"Solus makes robotics development observable, understandable, and debuggable. One context model that understands your entire system."

#demo #presentation #narrative
