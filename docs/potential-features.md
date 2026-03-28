# Potential New Features

Features beyond the current 5-demo plan. Ranked by technical impressiveness.

## Approved for Implementation

### 1. Automatic Relation Discovery
Infer relations automatically by analyzing code (Python AST for imports/function calls/topic names), KiCad netlists (shared nets between components), and config files (YAML parameter references). Outputs discovered edges with confidence scores. "Solus discovered 8 relations you didn't explicitly define."

**Technical depth:** Multi-modal static analysis, confidence scoring per inferred edge, graph diffing (inferred vs. declared).

### 2. Causal Debugging
When an anomaly fires, trace the causal chain backwards through the graph with temporal constraints. "Motor RPM anomaly → malformed /cmd_vel → nav_planner NaN → stale IMU data → I2C bus lock → MPU6050 NACK." Reverse BFS with probabilistic confidence decay per hop.

**Technical depth:** Reverse temporal BFS, probabilistic causal inference, runtime + graph fusion.

### 3. Live Graph Mutation Visualization
Animate BFS propagation on the D3 graph in real-time. The wave ripples outward hop by hop — edges glow as traversed, nodes change color as reached. Depth limit visible as the wave stops. The algorithm made visible.

**Technical depth:** Generator-pattern BFS with step-by-step yield, WebSocket streaming of traversal state, D3 transition choreography.

## Code Patch Pipeline (Designed, Not Yet Built)

Spec at: `docs/superpowers/specs/2026-03-28-code-patch-pipeline-design.md`

Universal "Apply fix" button on any AI-suggested code change. Agent outputs structured patches, frontend previews with syntax validation, one-click apply to filesystem with backup and auto re-sync.

## Backlog (Not Yet Designed)

### Predictive Impact Analysis — "What Would Happen If?"
Speculative graph mutations before making a change. "What if I swap ESP32 for Raspberry Pi Pico?" — checks pin compatibility, voltage, interfaces, software drivers without touching files. Constraint propagation with compatibility scoring.

### Design Rule Checker
Encode constraints on graph edges (voltage levels, interface speeds, protocol compatibility). Auto-check all constraints on any mutation. "You connected a 5V sensor to the 3.3V I2C bus without a level shifter." Constraint propagation across hardware, software, and interfaces.

### Natural Language Graph Query Engine
Translate English questions into graph traversals. "Which software modules depend on the I2C bus?" → BFS query → results with explanation. NL-to-graph-query translation with custom DSL.

### Cross-Domain Semantic Search
Unified search across entities, relations, issues, fixes, agent responses, and runtime data. "motors" returns the NEMA17, DRV8825, motor_controller.py, /cmd_vel, the stall issue, the fix, and the RPM signal — all ranked and linked to the graph.

### Provenance Graph / Compliance Trace
Event-sourced audit DAG tracking the full chain: change detected → impact traced → agent queried → patch suggested → patch applied. Graph-of-graphs referencing the context model. Queryable temporal history for regulatory compliance.

### Multi-Platform Graph
Cross-platform impact analysis for companies with multiple robot variants sharing code. One change traces through shared libraries into platform-specific graphs. Requires multi-project seed data.
