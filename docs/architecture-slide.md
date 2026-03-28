# Solus — Architecture (Slide Version)

```
┌──────────────────────────────────────────────────────────────────────┐
│                     ELECTRON + REACT + TYPESCRIPT                     │
│                                                                      │
│  Workspace │ Context Model │ Agent │ Live Bench │ Simulator          │
│  Projects    D3 Force Graph  Gemini   Telemetry    MuJoCo 3D         │
│  Sources     Impact BFS      Chat     Anomalies    PID Optimize      │
│  Sync        AI Explain      Memory   Issues       Before/After      │
│                                                                      │
│  Zustand Store · Recharts · Three.js · WebSocket · Tailwind v4       │
└──────────────────────────────┬───────────────────────────────────────┘
                          REST + WS
┌──────────────────────────────┴───────────────────────────────────────┐
│                      FASTAPI BACKEND (Python)                         │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │              ROBOTICS CONTEXT MODEL (Graph Engine)              │  │
│  │                                                                 │  │
│  │  Nodes                         Edges                           │  │
│  │  ├ ElectricalPart (DRV8825)   ├ drives (chip → motor)         │  │
│  │  ├ SoftwareModule (ctrl.py)   ├ depends_on (code → code)      │  │
│  │  ├ MechanicalPart (chassis)   ├ connected_to (shared net)     │  │
│  │  ├ Interface (/cmd_vel)       ├ publishes / subscribes_to     │  │
│  │  ├ RuntimeSignal              ├ configured_by (yaml → entity) │  │
│  │  ├ Document / Paper           ├ impacts / changed_by          │  │
│  │  ├ Issue / Fix                ├ reads_from / documented_by    │  │
│  │  └ SimulationAsset            └ resolved_by / similar_to      │  │
│  │                                                                 │  │
│  │  Operations: BFS impact analysis · Snapshot diff · Subgraph    │  │
│  │  retrieval · Change tracking (added/modified/removed)          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ Solus Agent │ │Live Bench │ │Simulator │ │  Discovery Engine  │  │
│  │             │ │           │ │          │ │                    │  │
│  │ 6 query     │ │ 8-signal  │ │Diff-drive│ │ AST → depends_on  │  │
│  │ modes       │ │ telemetry │ │kinematics│ │ Nets → connected  │  │
│  │ Gemini API  │ │ Anomaly   │ │PID ctrl  │ │ Config→configured │  │
│  │ 4-tier      │ │ detection │ │300-trial │ │ Cross-modal       │  │
│  │ fallback    │ │ Issue/fix │ │optimizer │ │ boosting + dedup  │  │
│  │ Context     │ │ WebSocket │ │MuJoCo    │ │                    │  │
│  │ assembly    │ │ 2 Hz      │ │WASM 3D   │ │                    │  │
│  └─────────────┘ └───────────┘ └──────────┘ └────────────────────┘  │
│                                                                       │
│  ┌──────────────────┐ ┌─────────────┐                                │
│  │   Connectors     │ │Memory Store │                                │
│  │                   │ │             │                                │
│  │ GitHub · KiCad   │ │ TF-IDF      │   SQLite (WAL) ── 11 tables   │
│  │ Onshape · PDF    │ │ cosine sim  │   Gemini 2.5 Flash             │
│  │ → sync → snap →  │ │ pure Python │                                │
│  │   diff pipeline  │ │ no ML deps  │                                │
│  └──────────────────┘ └─────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```
