# Solus — Product Context

This file is the single source of truth for what Solus is, who it's for,
and what we're building. Every Claude Code agent should read this first.

---

## What Solus Is

Solus is a team robotics development workspace centered on a **Robotics Context Model** —
a living graph that continuously ingests design files, code, documents, runtime telemetry,
and simulation state, then uses that shared context to help teams plan, detect change
impact, debug, and reuse knowledge.

**One-liner:** "A system that makes robotics development observable, understandable, and debuggable."

---

## Why This Exists (Customer Discovery Summary)

We interviewed robotics engineers across academia and startups (CMU RI, competition teams,
exoskeleton projects, autonomous vehicles, search-and-rescue robots). Here are the validated
problems:

### Problem 1: Integration is the #1 Time Sink
Engineers spend most of their time making systems work together (ROS + hardware + simulation +
dependencies), not building functionality. "Making sure everything is compatible" was universal.

### Problem 2: No System-Level Understanding
No tool understands the robot as a full system. Engineers manually trace ROS topics, nodes,
messages, wires. They hold the entire system model in their heads.

### Problem 3: Debugging is Manual and Fragmented
Checking ROS messages, running components one by one, googling errors, wire checking hardware.
No structured assistance. "Lot of googling."

### Problem 4: Hardware Mistakes Are Catastrophic and Slow
PCB takes 2 days + shipping. Small mistake = full redesign. Engineers cross-reference datasheets
AND research papers AND community posts to validate component values. "Research papers are more
reliable than datasheets" — engineers triangulate truth from multiple sources.

### Problem 5: Pre-Build Validation > Post-Build Debugging
"He wants to have less things to debug... figure things out before building." Current tools
only help AFTER something breaks.

### Problem 6: Visualization is Underserved but Critical
Tools like rerun.io, viser, Foxglove are hard to use, require configuration, high learning curve.
"Visualization is underrated and super helpful."

### Problem 7: Team Knowledge is Lost
People run into the same errors. Solutions exist but aren't discoverable. Documentation is
inconsistent. "A lot of people are running into the same errors and people can post their
solutions there."

### Problem 8: Engineers Want Augmentation, Not Replacement
"He likes that it doesn't solve everything, he wants to use his brain." The product should
augment thinking, not replace it.

### The Deeper Truth
Robotics engineers are constantly trying to answer:
**"What is actually happening in my system right now?"**
And they have no unified context, no system understanding, no reliable feedback loop.

---

## Product Architecture

### The Robotics Context Model (Core)

A hybrid data structure:

**Structured Graph** — deterministic project structure and impact analysis:
- Node types: Project, TeamMember, MechanicalPart, ElectricalPart, SoftwareModule,
  Interface, RuntimeSignal, Document, Paper, Issue, Fix, Run, SimulationAsset,
  ExternalPartCandidate
- Edge types: connected_to, depends_on, configured_by, documented_by, publishes,
  subscribes_to, drives, reads_from, changed_by, impacts, observed_in, resolved_by,
  similar_to

**Semantic Memory** — fuzzy recall and issue reuse via embeddings over issue descriptions,
fix summaries, paper values, datasheet chunks, project notes.

**Runtime State Layer** — live updates: current status, telemetry, health, anomaly flags
for every component.

**Change Log Layer** — when any source changes, create snapshot, diff, impacted entities,
suggested follow-up.

### The Rule
Everything in the app either **creates**, **updates**, **queries**, or **validates** the
Robotics Context Model. If a feature doesn't do one of those four things, it doesn't belong.

---

## The Five Demo Flows (Hackathon)

These are what we're presenting. Every feature must serve at least one of these.

### Demo A: Change Propagation
1. User syncs a KiCad project (or Onshape)
2. A chip was swapped on the PCB (e.g., motor driver changed)
3. Context model detects the change via snapshot diff
4. Impact analysis traverses the graph → highlights impacted software modules
5. AI agent explains: "The motor driver changed from DRV8825 to TMC2209. This impacts
   your stepper control code in motor_controller.py because the microstepping protocol
   changed. Here's what to update."

**Proves:** The system understands your robot as a whole.

### Demo B: Live Bench Monitoring
1. Robot streams real-time telemetry (serial or simulated)
2. Dashboard shows live sensor values, motor speeds, battery voltage
3. Anomaly detected: motor speed spikes beyond threshold
4. AI agent diagnoses using context model + runtime data + past issues
5. "Left motor speed exceeded safe range. Based on your system graph, this motor is
   driven by the DRV8825 on net MOTOR_L. A similar issue was reported 3 days ago —
   it was a loose wire on pin 4."

**Proves:** Not just static design analysis — works with live robots.

### Demo C: Team Memory Reuse
1. Engineer encounters an issue (e.g., "SLAM map won't save")
2. They log it in Solus with description
3. Later, another engineer hits a similar problem
4. Solus retrieves the similar past issue + fix via semantic search
5. "This looks like an issue Person X had on March 15. The root cause was the map_saver
   node wasn't subscribed to the correct topic. Here's how it was fixed — want me to
   walk through the same steps?"

**Proves:** Real team value — institutional knowledge that scales.

### Demo D: External Knowledge + Grounded Planning
1. Engineer asks: "I need a motor driver for a NEMA 17 stepper, 12V supply, must support
   microstepping and work with our Teensy 4.1"
2. Agent searches datasheets, cross-references with system constraints from the context model
3. Returns: "TMC2209 — supports up to 2A, UART interface compatible with Teensy, 256
   microstep interpolation. Rated voltage range 4.75V-29V. Here's the wiring diagram
   for your existing power rail."
4. Alternatively: "Extract the PID values from this research paper for our motor setup"
5. Agent reads paper, extracts values with confidence levels, cites sources

**Proves:** The external knowledge layer grounds answers in real data, doesn't hallucinate.

### Demo E: Simulator Loop
1. A design parameter changes (wheel radius, motor torque constant)
2. Context model updates
3. MuJoCo simulation runs with updated parameters
4. Simulated behavior compared against real runtime observations
5. "After the wheel radius change, simulated turn radius is 15cm but your Live Bench
   shows 22cm. The discrepancy suggests your friction model may need updating."

**Proves:** Design → simulation → runtime continuity.

---

## Tech Stack

- **Desktop:** Electron + React + TypeScript + Tailwind CSS
- **Backend:** Python FastAPI (localhost, bundled with Electron)
- **Database:** SQLite (hackathon) → PostgreSQL (production)
- **Graph:** In-memory with SQLite persistence (hackathon) → Neo4j (production)
- **Embeddings:** TF-IDF cosine similarity (hackathon) → sentence-transformers (production)
- **AI:** Google Gemini API (multimodal, structured output)
- **Simulator:** MuJoCo (or physics stub for hackathon)
- **Telemetry:** pyserial + WebSocket streaming

---

## Target User

**Primary:** Robotics engineer (research lab / startup / competition team) who works across
hardware + software, uses multiple disconnected tools, spends more time debugging than building.

**Secondary:** Technical founder / team lead who manages system architecture, onboards
new engineers, wants faster iteration and team productivity.

---

## What We Are NOT Building

- ❌ Full simulation platform
- ❌ Full ROS replacement
- ❌ CAD editor
- ❌ PCB editor
- ❌ Marketplace
- ❌ Generic AI chatbot
- ❌ Hardware automation

We READ from these tools (Onshape, KiCad, GitHub). We don't replace them.