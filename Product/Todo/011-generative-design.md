# Feature: Generative Design

> Status: **idea** | Priority: **bonus** | Demo: D, E
> Owner: unassigned

## Problem

Robotics engineers currently make design decisions by manually cross-referencing datasheets, research papers, community forums, and their own experience. When they need to choose a component, define a wiring topology, or tune parameters, they start from scratch every time — even when their Context Model already contains enough constraints to narrow the solution space dramatically.

Demo D (External Knowledge) already answers "which motor driver should I use?" with grounded recommendations. Generative Design goes further: instead of answering one question at a time, the system proposes **complete design alternatives** that satisfy all known constraints simultaneously.

## User Story

> As a robotics engineer, I want to describe a design goal or constraint change, and have Solus generate one or more complete design proposals — with component selections, wiring, parameter values, and tradeoff analysis — so I can evaluate alternatives instead of manually iterating on a single design.

## Concept

The Context Model already knows:
- Every component in the system (nodes)
- How they connect (edges)
- What interfaces they expose (topics, pins, protocols)
- Electrical constraints (voltage, current, power budget)
- Software dependencies (ROS nodes, libraries)
- Runtime behavior (telemetry baselines, anomaly history)
- External knowledge (datasheets, papers, community data)

Generative Design uses all of this context as **constraints** and produces candidate designs that satisfy them.

## Example Scenarios

### Scenario 1: "I need to swap to a more powerful motor"

**Input:** "Replace the NEMA17 with something that can handle 2x the torque, keeping everything else compatible."

**Solus generates:**

```
╔═══════════════════════════════════════════════════════════╗
║  DESIGN PROPOSAL A                          confidence: 87%  ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Motor: NEMA23 (2.0 N·m holding torque)                   ║
║                                                           ║
║  Cascading changes:                                       ║
║  ├─ Motor driver: DRV8825 → TB6600                        ║
║  │  └─ Reason: NEMA23 draws 2.8A, DRV8825 max is 2.5A    ║
║  ├─ Power supply: 12V 5A → 12V 10A                        ║
║  │  └─ Reason: new driver + motor draw 6.2A total         ║
║  ├─ motor_controller.py: update step_angle from 1.8° to   ║
║  │  1.8° (same), but microstep config changes             ║
║  ├─ Mounting: M3 bolt pattern → M5 bolt pattern           ║
║  │  └─ Flag: check chassis clearance (URDF update needed) ║
║  └─ Simulation: torque_constant param update required      ║
║                                                           ║
║  Estimated cost delta: +$18.50                             ║
║  Compatibility score: 9/10 (mounting is only flag)         ║
║                                                           ║
║  [Apply to Context Model]  [Compare]  [Dismiss]           ║
╚═══════════════════════════════════════════════════════════╝
```

### Scenario 2: "Design the sensor suite for a mapping robot"

**Input:** "I need sensors for indoor SLAM. Budget under $100. Must work with ROS2."

**Solus generates 2-3 proposals** with different tradeoff profiles:

| | Proposal A: Budget | Proposal B: Accuracy | Proposal C: Compact |
|---|---|---|---|
| Lidar | RPLidar A1 ($99) | RPLidar A2M12 ($300) | LD06 ($12) |
| IMU | MPU6050 ($3) | BNO055 ($25) | MPU9250 ($8) |
| Depth | — | Intel D435 ($250) | — |
| Total | $102 | $575 | $20 |
| SLAM quality | Good for small rooms | Production-grade | Basic, short range |
| ROS2 support | Community driver | Official package | Community driver |

Each proposal includes: wiring diagram for the user's specific MCU, ROS2 launch file snippet, and a list of Context Model entities/relations that would be created.

### Scenario 3: "Optimize my control loop parameters"

**Input:** "My robot overshoots on turns. Suggest PID tuning based on my system specs and runtime data."

**Solus uses:** motor specs from Context Model + runtime telemetry from Live Bench + PID values from papers (Demo D) + simulation results (Demo E) to propose parameter sets with predicted behavior.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    User Prompt                        │
│  "Swap NEMA17 for more torque"                       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Constraint Extraction                    │
│  • Parse intent (swap, add, optimize, design-from-   │
│    scratch)                                          │
│  • Pull current system state from Context Model       │
│  • Identify fixed constraints (MCU, voltage, budget)  │
│  • Identify flexible constraints (motor, driver,      │
│    mounting)                                          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Candidate Generation                     │
│  • Query External Knowledge for matching components   │
│  • Run impact analysis on each candidate swap         │
│  • For each candidate: trace cascading changes        │
│  • Score by: compatibility, cost, performance,        │
│    confidence                                        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Proposal Assembly                        │
│  • Package each candidate as a complete proposal      │
│  • Include: component list, wiring delta, code delta, │
│    sim params, cost estimate                         │
│  • Rank proposals by user's stated priority           │
│  • Generate diff against current Context Model        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Presentation                             │
│  • Side-by-side proposal cards with tradeoff table    │
│  • Graph diff view: green = added, red = removed,     │
│    yellow = changed                                  │
│  • "Apply" button → stages changes in Context Model   │
│  • "Simulate" button → runs proposal through MuJoCo   │
└─────────────────────────────────────────────────────┘
```

## Implementation

### Phase 1: Single-Swap Proposals (hackathon feasible)

Build on existing Demo D (external knowledge) + Demo A (impact analysis):

1. User types a swap request in the Agent tab
2. Solus Agent queries External Knowledge for compatible replacements
3. For each candidate, runs impact analysis via the Context Model
4. Presents results as a structured proposal card (not just chat text)
5. "Apply" button creates/updates entities and relations in the Context Model

**Backend:** Extend `routes_agent.py` with a `POST /api/projects/{id}/agent/generate-design` endpoint. The Solus Agent (Gemini) gets a structured prompt with the full Context Model graph + external knowledge results + the user's request, and returns structured JSON proposals.

**Frontend:** New `ProposalCard` component that renders a design proposal with component list, change summary, compatibility score, and action buttons. Displayed in the Agent tab below the chat.

### Phase 2: Multi-Component Generation (post-hackathon)

- Generate complete subsystem designs (sensor suite, drive train, power system)
- Compare multiple proposals side-by-side
- Graph diff visualization showing what changes per proposal

### Phase 3: Simulation-Validated Proposals (post-hackathon)

- Each proposal auto-runs through MuJoCo with updated parameters
- Predicted vs. current performance comparison
- "What-if" exploration: adjust one parameter, see ripple effects

## What Makes This a "Wow" Feature

This is the feature that makes judges say "wait, it can do that?"

Most robotics tools are **reactive** — they help you analyze what you already have. Generative Design is **proactive** — it proposes what you should build next. It's the difference between a debugger and a design partner.

The key insight: because Solus has the full Context Model (hardware + software + interfaces + runtime + external knowledge), it can reason about design changes **holistically** — something no single-domain tool can do.

**Demo moment:** Engineer says "I need more torque." Solus responds not with a motor datasheet, but with a complete, scored proposal showing the motor, the new driver it needs, the code changes required, the power budget impact, and a button that applies it all to the Context Model graph in one click.

## Acceptance Criteria

- [ ] User can describe a design goal or constraint change in natural language
- [ ] System generates at least one structured proposal with component selections and cascading changes
- [ ] Each proposal shows compatibility score and cost estimate
- [ ] Impact analysis runs automatically for each proposed change
- [ ] "Apply to Context Model" button stages the proposed changes
- [ ] (Stretch) Side-by-side comparison of multiple proposals
- [ ] (Stretch) Graph diff view showing additions/removals/modifications per proposal
- [ ] (Stretch) "Simulate" button runs proposal through MuJoCo

## Open Questions

1. How much of the proposal should Gemini generate vs. deterministic graph traversal? (Probably: Gemini picks candidates, graph engine traces impacts, Gemini assembles the narrative.)
2. Should "Apply" commit changes immediately or stage them as a draft/branch in the Context Model?
3. How to handle confidence levels? Some proposals are grounded in datasheets; others are educated guesses.
4. Should proposals be saveable/shareable for team review?

#todo #generative-design #ai #agent #bonus
