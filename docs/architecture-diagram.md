# Solus — Technical Architecture

## System Overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                      ELECTRON DESKTOP APPLICATION                             │
│                                                                               │
│  React 18 · TypeScript · Tailwind CSS v4 (Geist font) · Zustand store        │
│                                                                               │
│  ┌─────────────┐  ┌───────────────┐  ┌──────────┐  ┌──────────┐ ┌─────────┐ │
│  │ WorkspaceTab│  │ContextModelTab│  │ AgentTab │  │LiveBench │ │Simulator│ │
│  │             │  │               │  │          │  │   Tab    │ │   Tab   │ │
│  │ Project     │  │ D3 force-     │  │ 6-mode   │  │          │ │         │ │
│  │ selector    │  │ directed      │  │ query    │  │ Signal   │ │ MuJoCo  │ │
│  │             │  │ graph         │  │ router   │  │ grid +   │ │ WASM 3D │ │
│  │ Source      │  │               │  │          │  │ sparkline│ │ viewer  │ │
│  │ connections │  │ Node coloring │  │ Chat     │  │ charts   │ │ (Three) │ │
│  │ (GitHub,    │  │ by 14 entity  │  │ history  │  │          │ │         │ │
│  │  KiCad,     │  │ types         │  │          │  │ Anomaly  │ │ PID     │ │
│  │  Onshape,   │  │               │  │ Memory   │  │ feed     │ │ optim-  │ │
│  │  PDF)       │  │ Impact BFS    │  │ search   │  │          │ │ izer    │ │
│  │             │  │ visualization │  │ panel    │  │ Issue/   │ │         │ │
│  │ Change      │  │ + AI explain  │  │          │  │ fix CRUD │ │ Before/ │ │
│  │ timeline    │  │ per component │  │ Source   │  │          │ │ after   │ │
│  │             │  │               │  │ pills + │  │ Similar  │ │ compare │ │
│  │ Sync        │  │ Zoom/pan/drag │  │ confid-  │  │ issue    │ │         │ │
│  │ triggers    │  │ interaction   │  │ ence bar │  │ search   │ │ Target  │ │
│  │             │  │               │  │          │  │ (TF-IDF) │ │ line    │ │
│  └──────┬──────┘  └───────┬───────┘  └────┬─────┘  └────┬─────┘ └────┬────┘ │
│         │                 │               │              │            │       │
│         │     Zustand projectStore (shared state)        │            │       │
│         │     fetchProjects, fetchGraph, syncSource,     │            │       │
│         │     queryAgent, fetchImpact, fetchChanges      │            │       │
│         └─────────────────┴───────────────┴──────────────┴────────────┘       │
│                                    │                                          │
│                       HTTP REST + WebSocket                                   │
│                       useApi hook · useWebSocket hook                         │
└────────────────────────────────────┼──────────────────────────────────────────┘
                                     │
                             localhost:8000
                                     │
┌────────────────────────────────────┼──────────────────────────────────────────┐
│                        FASTAPI BACKEND (Python 3.11+)                         │
│                                                                               │
│  main.py — router wiring with try/except (graceful if module missing)        │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                          ROUTE MODULES                                  │  │
│  │                                                                         │  │
│  │  routes_core.py (14 endpoints)                                         │  │
│  │  Projects · Entities · Relations · Graph · Sources · Sync · Impact     │  │
│  │  Team members · Change events                                          │  │
│  │                                                                         │  │
│  │  routes_agent.py (10 endpoints)                                        │  │
│  │  Agent query · Memory store/search · Simulator run/state/compare       │  │
│  │  PID run · PID optimize · Onshape import stub                          │  │
│  │                                                                         │  │
│  │  routes_livebench.py (10 REST + 1 WebSocket)                           │  │
│  │  Start/stop simulated telemetry · Set thresholds · Ingest packets      │  │
│  │  Get state · Issues CRUD · Fixes · Similar issue search                │  │
│  │  WS /ws/projects/{id}/live-bench (2 Hz telemetry stream)               │  │
│  │                                                                         │  │
│  │  routes_discovery.py (1 endpoint)                                      │  │
│  │  Auto-discover relations from source code analysis                     │  │
│  └────────────┬────────────────────┬───────────────────┬──────────────────┘  │
│               │                    │                   │                      │
│  ┌────────────▼────────────┐  ┌────▼──────────┐  ┌────▼──────────────────┐  │
│  │    CONTEXT ENGINE       │  │  SOLUS AGENT  │  │   LIVE BENCH ENGINE   │  │
│  │   (context_engine.py)   │  │(solus_agent)  │  │   (live_bench.py)     │  │
│  │                         │  │               │  │                       │  │
│  │  Robotics Context       │  │  Query types: │  │  SimulatedTelemetry:  │  │
│  │  Model Graph            │  │  ├ general    │  │  8 signals per packet │  │
│  │  ├ 14 entity types      │  │  ├ debug      │  │  ├ left/right motor  │  │
│  │  │ (electrical_part,    │  │  ├ search_    │  │  ├ battery voltage    │  │
│  │  │  software_module,    │  │  │  parts     │  │  ├ IMU accel x/y     │  │
│  │  │  mechanical_part,    │  │  ├ extract_   │  │  ├ IMU gyro z        │  │
│  │  │  interface,          │  │  │  values    │  │  ├ CPU temperature    │  │
│  │  │  runtime_signal,     │  │  ├ impact_   │  │  └ lidar range       │  │
│  │  │  document, paper,    │  │  │  analysis  │  │                       │  │
│  │  │  issue, fix, run,    │  │  └ plan       │  │  Anomaly Detection:   │  │
│  │  │  simulation_asset,   │  │               │  │  Configurable per-    │  │
│  │  │  external_part_      │  │  Context      │  │  signal thresholds    │  │
│  │  │  candidate)          │  │  Assembly:    │  │  (min/max range)      │  │
│  │  │                      │  │  graph subgr  │  │                       │  │
│  │  ├ 13 relation types    │  │  + memory     │  │  Ring Buffer:         │  │
│  │  │ (connected_to,       │  │  + recent     │  │  Last 60 packets for  │  │
│  │  │  depends_on,         │  │  changes      │  │  sparkline history    │  │
│  │  │  drives, impacts,    │  │  → prompt     │  │                       │  │
│  │  │  publishes,          │  │  → Gemini     │  │  Issue/Fix CRUD:      │  │
│  │  │  subscribes_to,      │  │               │  │  Create issue →       │  │
│  │  │  configured_by,      │  │  Gemini       │  │  store in semantic    │  │
│  │  │  documented_by,      │  │  Fallback:    │  │  memory → create fix  │  │
│  │  │  reads_from,         │  │  2.5-flash →  │  │  → marks resolved    │  │
│  │  │  changed_by,         │  │  2.0-flash →  │  │                       │  │
│  │  │  observed_in,        │  │  lite →       │  │  Semantic Search:     │  │
│  │  │  resolved_by,        │  │  no-AI        │  │  Queries MemoryStore  │  │
│  │  │  similar_to)         │  │  summary      │  │  for similar past     │  │
│  │  │                      │  │               │  │  issues + fixes       │  │
│  │  ├ BFS Impact Analysis  │  └───────┬───────┘  └───────────────────────┘  │
│  │  │ Bidirectional graph  │          │                                      │
│  │  │ traversal, depth-    │          │                                      │
│  │  │ limited, returns     │          ▼                                      │
│  │  │ all affected         │  ┌───────────────┐  ┌───────────────────────┐  │
│  │  │ entities             │  │ MEMORY STORE  │  │     SIMULATOR         │  │
│  │  │                      │  │(memory_store) │  │  (pid_optimizer.py +  │  │
│  │  ├ Snapshot + Diff      │  │               │  │   mujoco_wrapper.py)  │  │
│  │  │ Take snapshot of     │  │ TF-IDF cosine │  │                       │  │
│  │  │ source state →       │  │ similarity    │  │  Kinematics Engine:   │  │
│  │  │ diff vs previous →   │  │ (pure Python, │  │  Differential drive   │  │
│  │  │ emit ChangeEvents    │  │  no numpy)    │  │  with configurable    │  │
│  │  │ (added/modified/     │  │               │  │  wheel_base,          │  │
│  │  │  removed)            │  │ Stores:       │  │  wheel_radius,        │  │
│  │  │                      │  │ ├ issues      │  │  steering_bias        │  │
│  │  ├ Subgraph Retrieval   │  │ ├ fixes       │  │                       │  │
│  │  │ Localized graph      │  │ ├ doc chunks  │  │  PID Controller:      │  │
│  │  │ view around any      │  │ └ notes       │  │  Heading correction   │  │
│  │  │ entity for AI        │  │               │  │  with kp/ki/kd gains  │  │
│  │  │ context building     │  │ Tokenizer:    │  │  fighting steering    │  │
│  │  │                      │  │ Lowercase +   │  │  bias                 │  │
│  │  └ Team/Project CRUD    │  │ stop-word     │  │                       │  │
│  │                         │  │ filter +      │  │  Optimizer:            │  │
│  └─────────────────────────┘  │ min length 2  │  │  Random search over   │  │
│                               │               │  │  300 candidates,      │  │
│                               └───────────────┘  │  score = mean(|y|) +  │  │
│                                                   │  mean(|θ|), returns   │  │
│                                                   │  best gains + both    │  │
│                                                   │  trajectories         │  │
│                                                   │                       │  │
│                                                   │  3D Viewer:           │  │
│                                                   │  MuJoCo WASM loads    │  │
│                                                   │  MJCF model for geom  │  │
│                                                   │  → Three.js meshes    │  │
│                                                   │  → trajectory playback│  │
│                                                   │  with wheel animation │  │
│                                                   └───────────────────────┘  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                        DATA CONNECTORS                                  │  │
│  │                                                                         │  │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────┐  ┌──────────┐ │  │
│  │  │ GitHub         │  │ KiCad          │  │ Onshape    │  │ PDF      │ │  │
│  │  │                │  │                │  │            │  │          │ │  │
│  │  │ Local walker:  │  │ S-expression   │  │ REST API   │  │ PyPDF2   │ │  │
│  │  │ os.walk() with │  │ tokenizer +    │  │ v6 for     │  │ text     │ │  │
│  │  │ file extension │  │ recursive      │  │ assemblies,│  │ extract  │ │  │
│  │  │ classification │  │ parser (pure   │  │ parts, mass│  │ → chunk  │ │  │
│  │  │ (.py, .cpp,    │  │ Python, no     │  │ properties,│  │ ~500     │ │  │
│  │  │  .urdf, .step, │  │ deps)          │  │ mates      │  │ words    │ │  │
│  │  │  .stl, .yaml)  │  │                │  │            │  │ → store  │ │  │
│  │  │                │  │ Parses:        │  │ Auth: HTTP │  │ in       │ │  │
│  │  │ ROS package    │  │ .kicad_sch →   │  │ Basic +    │  │ semantic │ │  │
│  │  │ detection via  │  │ components,    │  │ access/    │  │ memory   │ │  │
│  │  │ package.xml    │  │ values, refs,  │  │ secret key │  │          │ │  │
│  │  │                │  │ footprints     │  │            │  │          │ │  │
│  │  │ Classifies by  │  │                │  │            │  │          │ │  │
│  │  │ ref prefix:    │  │ .kicad_pcb →   │  │            │  │          │ │  │
│  │  │ U=IC, R=res,   │  │ footprints,    │  │            │  │          │ │  │
│  │  │ C=cap, J=conn, │  │ nets, pad-to-  │  │            │  │          │ │  │
│  │  │ M=mechanical   │  │ net connections│  │            │  │          │ │  │
│  │  └───────┬────────┘  └───────┬────────┘  └─────┬──────┘  └────┬─────┘ │  │
│  │          │                   │                  │              │       │  │
│  │          └───────────────────┴──────────────────┴──────────────┘       │  │
│  │                              │                                         │  │
│  │                    Connector.sync() → snapshot_dict                    │  │
│  └──────────────────────────────┼────────────────────────────────────────┘  │
│                                  │                                          │
│  ┌──────────────────────────────▼────────────────────────────────────────┐  │
│  │                    SYNC → SNAPSHOT → DIFF PIPELINE                    │  │
│  │                                                                       │  │
│  │  1. Connector.sync() → flat dict {entity_name: {type, metadata}}     │  │
│  │  2. ContextEngine.create_snapshot(source_id, data)                   │  │
│  │  3. ContextEngine.diff_snapshots(old_id, new_id)                     │  │
│  │  4. → ChangeEvents: ADDED / MODIFIED / REMOVED                       │  │
│  │  5. Modified entities get field-level diffs (old→new per property)    │  │
│  │  6. All changes persisted + available via GET /changes               │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                     DISCOVERY ENGINE                                    │  │
│  │                    (discovery_engine.py)                                 │  │
│  │                                                                         │  │
│  │  3 Analyzers run on source files to auto-discover relations:           │  │
│  │                                                                         │  │
│  │  Python AST Analyzer         KiCad Netlist           Config File        │  │
│  │  ├ import → depends_on      Analyzer                Analyzer            │  │
│  │  ├ ROS topic publish →      ├ shared net →           ├ YAML/JSON/TOML   │  │
│  │  │ publishes                │ connected_to           ├ entity refs →     │  │
│  │  ├ ROS topic subscribe →    ├ driver-motor pair →   │ configured_by     │  │
│  │  │ subscribes_to           │ drives                 └ cross-file refs   │  │
│  │  └ hw address → reads_from └ power net warnings                        │  │
│  │                                                                         │  │
│  │  Merge + Dedup: cross-modal boosting, confidence scoring,              │  │
│  │  symmetric normalization, batch transaction commit                     │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                         PERSISTENCE                                     │  │
│  │                                                                         │  │
│  │  SQLite with WAL mode + foreign keys + indexed lookups                 │  │
│  │  (hackathon) → PostgreSQL + Neo4j (production)                         │  │
│  │                                                                         │  │
│  │  11 tables: projects, team_members, entities, relations, snapshots,    │  │
│  │  source_connections, change_events, runtime_packets, anomalies,        │  │
│  │  issues, fixes, semantic_memory, simulation_runs, agent_queries,       │  │
│  │  agent_responses                                                       │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                       EXTERNAL SERVICES                                 │  │
│  │                                                                         │  │
│  │  Google Gemini API                                                     │  │
│  │  ├ gemini-2.5-flash (primary) — multimodal reasoning                  │  │
│  │  ├ gemini-2.0-flash (fallback)                                        │  │
│  │  ├ gemini-2.0-flash-lite (lightweight fallback)                       │  │
│  │  └ no-AI context summary (final fallback, zero API calls)             │  │
│  │                                                                         │  │
│  │  Used for: agent queries, impact explanations, debug diagnosis,        │  │
│  │  part recommendations, parameter extraction from papers                │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### Demo A: Change Propagation
```
  User syncs KiCad source
         │
         ▼
  KiCadConnector.parse_schematic(.kicad_sch)
  KiCadConnector.parse_pcb(.kicad_pcb)
         │
         ▼
  sync() → flat snapshot dict
  {"U1": {type: "electrical_part", value: "DRV8825", footprint: "HTSSOP-28"}, ...}
         │
         ▼
  ContextEngine.create_snapshot(source_id, data)
         │
         ▼
  ContextEngine.diff_snapshots(old_snapshot, new_snapshot)
         │
         ▼
  ChangeEvents:
  ├ MODIFIED "U1" — value: DRV8825→TMC2209, footprint changed
  ├ ADDED "C3" — new decoupling capacitor
  └ REMOVED "R5" — pull-up no longer needed
         │
         ▼
  ContextEngine.impact_analysis(entity_id="U1", depth=3)
  BFS traversal: U1 ──drives──▶ motor_controller.py ──depends_on──▶ ros_navigation
         │
         ▼
  SolusAgent.query(type="impact_analysis")
  Assembles: graph subgraph + change events + memory context
  → Gemini explains per-component impact
         │
         ▼
  Frontend: ContextModelTab highlights impacted nodes in red,
  shows AI explanation cards per affected component
```

### Demo B: Live Bench Monitoring
```
  LiveBenchEngine.start() → engine.running = true
         │
         ▼
  WebSocket /ws/projects/{id}/live-bench opens
         │
         ▼
  Every 0.5s (2 Hz):
  ├ engine.generate_simulated_packet()
  │ └ 8 signals: motor speeds, battery, IMU, CPU temp, lidar
  │   └ sinusoidal drift + gaussian noise + 3% anomaly injection
  │
  ├ engine.check_anomalies(packet)
  │ └ compare each signal against configurable [min, max] thresholds
  │ └ if out of range → create Anomaly with severity (warning/critical)
  │
  ├ engine.ingest_packet(packet)
  │ ├ append to ring buffer (max 60 for sparklines)
  │ ├ persist to runtime_packets table
  │ └ persist anomalies to anomalies table
  │
  └ WebSocket sends JSON: {signals, anomalies, status}
         │
         ▼
  Frontend: LiveBenchTab
  ├ Signal grid with live values + inline SVG sparklines
  ├ Anomaly feed (color-coded by severity)
  └ Issue/fix panel with semantic search
```

### Demo C: Team Memory Reuse
```
  Engineer logs issue: "SLAM map won't save"
         │
         ▼
  POST /issues → create_issue() → Issue row in DB
         │
         ▼
  Also: MemoryStore.store(SemanticMemoryItem(
    content="SLAM map won't save. Map saver node crashes",
    content_type="issue",
    metadata={issue_id: "..."}
  ))
         │
         ▼
  Later: another engineer hits similar problem
  GET /similar-issues?q="map saving error"
         │
         ▼
  MemoryStore.find_similar(query, project_id, content_type="issue", limit=5)
  ├ Tokenize query → remove stop words
  ├ Compute TF-IDF vectors for query + all stored issues
  ├ Cosine similarity → rank by score
  └ Return top matches with issue metadata
         │
         ▼
  Frontend enriches with full issue data from DB
  Shows: similar issue title + description + fix steps + who fixed it
```

### Demo E: Simulation Optimization
```
  User clicks "Simulate" (no optimization yet)
         │
         ▼
  POST /simulator/run-pid {kp:0, ki:0, kd:0}
  simulate_with_pid() runs 500 steps of diff-drive kinematics:
  ├ initial_theta = 0.1 rad (car starts slightly off-course)
  ├ steering_bias = 0.3 (right wheel faster → car curves left)
  ├ PID correction = 0 (no gains → bias uncorrected)
  └ car drifts progressively further from straight line
         │
         ▼
  Frontend: 3D viewer animates car along trajectory (Three.js)
  Trajectory chart shows drift, car visibly leaves target line
         │
         ▼
  User clicks "Optimize"
         │
         ▼
  POST /simulator/optimize {n_trials:300, n_steps:500}
  optimize_pid():
  ├ Generate baseline: simulate_with_pid(kp=0, ki=0, kd=0) → bad_trajectory
  ├ Score baseline: straight_line_score = mean(|y|) + mean(|θ|)
  ├ For 300 random candidates:
  │   ├ sample kp ∈ [2.0, 15.0], ki ∈ [0.0, 2.0], kd ∈ [0.0, 1.0]
  │   ├ simulate_with_pid(kp, ki, kd) → trajectory
  │   ├ score trajectory
  │   └ keep if best so far
  └ Return {best_gains, best_score, bad_score, best_trajectory, bad_trajectory}
         │
         ▼
  Frontend:
  ├ Before/After toggle appears
  ├ Trajectory chart shows red dashed (before) + green solid (after)
  ├ Sidebar shows PID gains: "UNTUNED" 0/0/0 vs "OPTIMIZED" kp/ki/kd
  ├ 3D viewer replays selected trajectory
  └ Score improvement displayed (e.g. "94% better")
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop Shell | Electron | Cross-platform app container |
| Frontend | React 18 + TypeScript | UI framework |
| Styling | Tailwind CSS v4 + Geist font | Design system with custom `solus-*` tokens |
| State | Zustand | Global state with per-action loading states |
| Charts | Recharts | Line charts, sparklines, trajectory plots |
| Graph | D3.js force-directed layout | Interactive context model visualization |
| 3D Viewer | Three.js + MuJoCo WASM | Car model rendering + trajectory playback |
| Real-time | useWebSocket hook | Auto-reconnect WebSocket with 5 retries |
| Backend | Python FastAPI | Async REST API + WebSocket server |
| Database | SQLite (WAL mode, foreign keys) | 11+ tables with indexed lookups |
| AI | Google Gemini 2.5 Flash | Multimodal reasoning with 4-tier fallback |
| Semantic Search | TF-IDF cosine similarity | Pure Python, no numpy/sklearn dependencies |
| Simulation | Differential drive kinematics | PID controller + random search optimizer |
| KiCad Parsing | Custom S-expression tokenizer + recursive parser | Pure Python, no external deps |
| PDF Ingestion | PyPDF2 | Text extraction + ~500 word chunking |
