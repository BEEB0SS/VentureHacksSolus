# Solus — Architecture (Slide Version)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      ELECTRON + REACT + TYPESCRIPT                        │
│                                                                          │
│  Workspace │ Context Model │ Agent │ Live Bench │ Simulator              │
│  Projects    D3 Force Graph  Gemini   Telemetry    MuJoCo 3D             │
│  Sources     Impact BFS      Chat     Anomalies    PID Optimize          │
│  Sync        AI Explain      Memory   Issues       Before/After          │
│                                                                          │
│  Zustand Store · Recharts · Three.js · WebSocket · Tailwind v4           │
└──────────────────────────────┬───────────────────────────────────────────┘
                          REST + WS
┌──────────────────────────────┴───────────────────────────────────────────┐
│                       FASTAPI BACKEND (Python)                            │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │               ROBOTICS CONTEXT MODEL (Graph Engine)                 │  │
│  │                                                                     │  │
│  │  Nodes (14 types)                  Edges (13 types)                │  │
│  │  ├ ElectricalPart (DRV8825)       ├ drives (chip → motor)         │  │
│  │  ├ SoftwareModule (ctrl.py)       ├ depends_on (code → code)      │  │
│  │  ├ MechanicalPart (chassis)       ├ connected_to (shared PCB net) │  │
│  │  ├ Interface (/cmd_vel topic)     ├ publishes / subscribes_to     │  │
│  │  ├ RuntimeSignal (motor_speed)    ├ configured_by (yaml → entity) │  │
│  │  ├ Document / Paper               ├ impacts / changed_by          │  │
│  │  ├ Issue / Fix                    ├ reads_from / documented_by    │  │
│  │  └ SimulationAsset / ExtPart      └ resolved_by / similar_to      │  │
│  │                                                                     │  │
│  │  Operations: BFS impact traversal · Snapshot diff (added/modified/ │  │
│  │  removed) · Subgraph extraction · Change event tracking            │  │
│  └──────────────────────────────┬──────────────────────────────────────┘  │
│                                  │                                        │
│          ┌───────────────────────┼───────────────────────┐                │
│          │                       │                       │                │
│          ▼                       ▼                       ▼                │
│  ┌───────────────┐  ┌────────────────────┐  ┌────────────────────────┐   │
│  │ Memory Store  │  │    Solus Agent      │  │   Discovery Engine    │   │
│  │               │  │                     │  │                       │   │
│  │ TF-IDF cosine │  │  Context Assembly:  │  │ Auto-populates graph: │   │
│  │ similarity    │  │  ┌───────────────┐  │  │ Python AST → imports, │   │
│  │ (pure Python) │  │  │ Graph subgraph│  │  │   ROS topics, hw refs │   │
│  │               │  │  │ around query  │  │  │ KiCad netlists →      │   │
│  │ Stores:       │  │  │ entities      │  │  │   shared nets, driver │   │
│  │ ├ issues      │  │  ├───────────────┤  │  │   motor pairs         │   │
│  │ ├ fixes       │  │  │ Semantic      │  │  │ YAML/JSON/TOML →      │   │
│  │ ├ doc chunks  │  │  │ memory hits   │  │  │   configured_by refs  │   │
│  │ └ notes       │  │  │ (similar      │  │  │                       │   │
│  │               │  │  │ issues/fixes) │  │  │ Cross-modal boosting  │   │
│  │ Tokenizer:    │  │  ├───────────────┤  │  │ + confidence scoring  │   │
│  │ lowercase +   │  │  │ Recent change │  │  │ + batch dedup         │   │
│  │ stop-word     │  │  │ events from   │  │  └────────────────────── │   │
│  │ filter        │  │  │ snapshot diff │  │                          │   │
│  └───────┬───────┘  │  ├───────────────┤  │                          │   │
│          │          │  │ Runtime       │  │                          │   │
│          │          │  │ telemetry     │  │                          │   │
│          │          │  │ (anomalies)   │  │                          │   │
│          │          │  └───────┬───────┘  │                          │   │
│          │          │          │          │                          │   │
│          │          │          ▼          │                          │   │
│          └──────────┤  Assembled prompt   │                          │   │
│                     │  → Gemini API       │                          │   │
│                     │                     │                          │   │
│                     │  Fallback chain:    │                          │   │
│                     │  2.5-flash →        │                          │   │
│                     │  2.0-flash →        │                          │   │
│                     │  2.0-flash-lite →   │                          │   │
│                     │  no-AI summary      │                          │   │
│                     │                     │                          │   │
│                     │  6 query modes:     │                          │   │
│                     │  general · debug    │                          │   │
│                     │  search_parts ·     │                          │   │
│                     │  extract_values ·   │                          │   │
│                     │  impact_analysis ·  │                          │   │
│                     │  plan               │                          │   │
│                     └─────────────────────┘                          │   │
│                                                                       │   │
│  ┌─────────────┐ ┌───────────┐ ┌────────────────────────────────────┐│   │
│  │ Connectors  │ │Live Bench │ │           Simulator                ││   │
│  │             │ │           │ │                                    ││   │
│  │ GitHub      │ │ 8-signal  │ │ Diff-drive kinematics · PID ctrl  ││   │
│  │ KiCad       │ │ telemetry │ │ 300-trial random search optimizer  ││   │
│  │ Onshape     │ │ Anomaly   │ │ MuJoCo WASM 3D model viewer       ││   │
│  │ PDF         │ │ detection │ │ Trajectory playback + wheel anim  ││   │
│  │             │ │ WS 2 Hz   │ │ Before/after comparison            ││   │
│  │ → sync →    │ │ Issue/fix │ │                                    ││   │
│  │   snapshot  │ │ → memory  │ │                                    ││   │
│  │   → diff    │ │   store   │ │                                    ││   │
│  └─────────────┘ └───────────┘ └────────────────────────────────────┘│   │
│                                                                       │   │
│  SQLite (WAL, 11 tables) ─────────── Google Gemini 2.5 Flash API     │   │
└──────────────────────────────────────────────────────────────────────────┘
```
