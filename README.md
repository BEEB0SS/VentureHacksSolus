# Solus — Robotics Context Model

A development workspace that builds a **living knowledge graph** of your entire robot system — hardware, software, interfaces, telemetry, and documents — then uses that graph to detect change impact, debug across domains, and reuse team knowledge.

**The core insight:** Robotics engineers spend most of their time making systems work together, not building functionality. No existing tool understands the robot as a full system. Solus connects the dots across KiCad schematics, GitHub repos, Onshape assemblies, runtime telemetry, and team memory into one queryable graph.

---

## Architecture

See [docs/architecture-diagram.md](docs/architecture-diagram.md) for the full technical architecture with data flow diagrams. Summary below:

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

---

## The Robotics Context Model

The core data structure is a **typed, weighted graph** where nodes are robot components and edges are relationships between them.

**14 Entity Types:**
Electrical Part, Software Module, Mechanical Part, Interface, Runtime Signal, Document, Issue, Fix, Project, Team Member, Paper, Run, Simulation Asset, External Part Candidate

**13 Relation Types** (with confidence scores):
`connected_to`, `depends_on`, `configured_by`, `documented_by`, `publishes`, `subscribes_to`, `drives`, `reads_from`, `changed_by`, `impacts`, `observed_in`, `resolved_by`, `similar_to`

**What this enables:**
- "I swapped a chip on the PCB" → BFS traversal → "These 3 software modules and 2 interfaces are affected"
- "Motor speed is anomalous" → reverse causal trace → "The IMU lost I2C bus lock"
- "I need a motor driver for NEMA17, 12V, microstepping" → grounded recommendation from your system constraints

---

## Key Features

### Change Propagation
Sync a KiCad schematic or Onshape assembly → snapshot diff detects what changed → BFS impact analysis traces through the graph → AI explains what to update with per-component action items.

### Auto-Relation Discovery
Three analyzers run independently on your codebase:
- **Python AST** — parses imports (`depends_on`), ROS topic pub/sub (`publishes`/`subscribes_to`), hardware I2C addresses (`reads_from`)
- **KiCad Netlist** — shared signal nets → `connected_to`, driver-motor nets → `drives` (power nets filtered)
- **Config Files** — YAML/JSON/TOML entity references → `configured_by`

Results merge with cross-modal confidence boosting (if two analyzers independently find the same relation, confidence increases).

### AI Agent (6 Query Modes)
| Mode | Color | What it does |
|------|-------|-------------|
| General | Indigo | Answer using full project context |
| Debug | Amber | Diagnose issues, suggest fixes |
| Find Parts | Cyan | Component recommendations with compatibility reasoning |
| Extract Values | Green | Pull parameters from papers/datasheets with confidence |
| Impact Analysis | Red | Explain impact of design changes per-component |
| Plan | Purple | Integration planning assistance |

Gemini fallback chain: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite` → context summary (no AI).

### Semantic Memory
TF-IDF cosine similarity search over issues, fixes, document chunks, and reference notes. "This looks like an issue Person X had on March 15" — institutional knowledge that scales.

### Simulator
Differential drive kinematics with PID optimization and sim-vs-runtime comparison. "Simulated turn radius is 15cm but Live Bench shows 22cm."

---

## Data Connectors

| Connector | Source | Auth | What it pulls |
|-----------|--------|------|---------------|
| **GitHub** (local) | Local directory | None | File tree, ROS packages, classification by extension |
| **GitHub** (API) | Remote repo | PAT (`GITHUB_TOKEN`) | Same classification via Git Trees API + file content fetch |
| **Onshape** | Cloud CAD | HTTP Basic (`ONSHAPE_ACCESS_KEY` + `SECRET_KEY`) | Assembly tree, parts metadata, materials, mass properties, mate connectors |
| **KiCad** | Local files | None | S-expression parsing of `.kicad_sch`/`.kicad_pcb`, components, nets, footprints |
| **PDF** | Local files | None | Text extraction + chunking into ~500 word segments for memory store |

All connectors return a **snapshot dict** → `ContextEngine.create_snapshot()` → diff against previous → change events.

---

## API Surface (25 endpoints)

### Core (`routes_core.py`)
```
POST   /api/projects                              Create project
GET    /api/projects                              List projects
GET    /api/projects/{id}                         Get project
POST   /api/projects/{id}/team                    Add team member
GET    /api/projects/{id}/team                    List team members
POST   /api/projects/{id}/entities                Create entity
GET    /api/projects/{id}/entities                List entities (filter by type)
POST   /api/projects/{id}/relations               Create relation
GET    /api/projects/{id}/graph                   Full graph (all entities + relations)
GET    /api/projects/{id}/impact/{entity_id}      BFS impact analysis
POST   /api/projects/{id}/sources                 Add source connection
GET    /api/projects/{id}/sources                 List sources
POST   /api/projects/{id}/sources/{sid}/sync      Sync source → snapshot → diff
GET    /api/projects/{id}/changes                 List change events
```

### Agent + Simulator (`routes_agent.py`)
```
POST   /api/projects/{id}/agent/query             AI query (6 types)
POST   /api/projects/{id}/memory                  Store memory item
GET    /api/projects/{id}/memory/search            Semantic search
POST   /api/projects/{id}/simulator/run            Run simulation
GET    /api/projects/{id}/simulator/state          Current sim state
POST   /api/projects/{id}/simulator/compare        Sim vs runtime comparison
POST   /api/projects/{id}/simulator/run-pid        PID tuning simulation
POST   /api/projects/{id}/simulator/optimize       Auto-optimize PID
POST   /api/projects/{id}/simulator/ai-tune        AI-driven MJCF tuning
POST   /api/projects/{id}/simulator/apply-tune     Record tuning changes
```

### Discovery (`routes_discovery.py`)
```
POST   /api/projects/{id}/discover                Auto-discover relations
```

---

## Getting Started

### 1. Clone and install

```bash
git clone git@github.com:BEEB0SS/VentureHacksSolus.git
cd VentureHacksSolus
```

**Backend:**
```bash
cd apps/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -c "from src.database import init_db; init_db()"
cd ../..
```

**Frontend:**
```bash
cd apps/desktop
pnpm install
cd ../..
```

### 2. Set environment variables

```bash
# Required for AI features (optional — fallback mode works without)
export GEMINI_API_KEY="your-gemini-key"

# Required for GitHub API connector (optional — local connector works without)
export GITHUB_TOKEN="ghp_your-token"

# Required for Onshape connector (optional)
export ONSHAPE_ACCESS_KEY="your-access-key"
export ONSHAPE_SECRET_KEY="your-secret-key"
```

### 3. Seed demo data

```bash
cd apps/backend
python scripts/seed_demo.py
cd ../..
```

### 4. Run

**Terminal 1 — Backend:**
```bash
cd apps/backend && source .venv/bin/activate
uvicorn src.main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd apps/desktop && pnpm run dev:web
```

Open http://localhost:5173

---

## Project Structure

```
apps/backend/src/
├── main.py                              FastAPI app, router wiring
├── database.py                          SQLite schema (16 tables)
├── context_engine.py                    Graph CRUD, BFS impact, snapshot/diff
├── discovery_engine.py                  Auto-discovery orchestrator
├── routes_core.py                       14 core endpoints
├── routes_agent.py                      10 agent/simulator endpoints
├── routes_discovery.py                  1 discovery endpoint
├── connectors/
│   ├── github_connector.py              Local repo walker
│   ├── github_api_connector.py          GitHub REST API
│   ├── onshape_api_connector.py         Onshape CAD API
│   ├── kicad_connector.py               KiCad S-expression parser
│   └── pdf_connector.py                 PDF text extraction
├── agent/
│   └── solus_agent.py                   Gemini query router (6 types)
├── memory/
│   └── memory_store.py                  TF-IDF semantic search
├── simulator/
│   ├── mujoco_wrapper.py                Differential drive kinematics
│   ├── pid_optimizer.py                 PID tuning
│   └── ai_tuner.py                      Gemini MJCF tuning
└── analyzers/
    ├── python_ast_analyzer.py           Import/topic/address discovery
    ├── kicad_netlist_analyzer.py         Shared net discovery
    └── config_file_analyzer.py          Config reference discovery

apps/desktop/src/renderer/
├── App.tsx                              Main app, 4-tab navigation
├── components/
│   ├── workspace/WorkspaceTab.tsx       Project + source management
│   ├── workspace/AddSourceModal.tsx     Connect sources by URL
│   ├── context-model/ContextModelTab.tsx D3 force graph + AI impact panel
│   ├── agent/AgentTab.tsx               3-panel query interface
│   ├── agent/MessageBubble.tsx          ResponseDocument renderer
│   ├── agent/MemoryPanel.tsx            Memory search sidebar
│   ├── simulator/SimulatorTab.tsx       Parameters + trajectory + PID
│   └── shared/                          Card, Modal, LoadingSpinner, etc.
├── stores/projectStore.ts               Zustand state management
└── hooks/useApi.ts                      Fetch wrapper

packages/shared_types/src/
└── models.py                            All dataclasses + enums (single source of truth)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron |
| Frontend | React 18, TypeScript, D3.js, Recharts |
| Styling | Inline styles, JetBrains Mono, dark developer-tool aesthetic |
| State | Zustand |
| Backend | Python 3.11+, FastAPI |
| Database | SQLite (WAL mode, foreign keys, cascade deletes) |
| AI | Google Gemini (2.5-flash → 2.0-flash → 2.0-flash-lite fallback) |
| Semantic search | TF-IDF cosine similarity (pure Python, no ML deps) |
| Simulation | Differential drive kinematics (pure math, no MuJoCo dep) |

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | No (fallback works) | Google Gemini AI for agent queries |
| `GITHUB_TOKEN` | No (local connector works) | GitHub API for remote repo sync |
| `ONSHAPE_ACCESS_KEY` | No | Onshape API access key |
| `ONSHAPE_SECRET_KEY` | No | Onshape API secret key |
| `SOLUS_DB_PATH` | No (default: `~/.solus/solus.db`) | SQLite database location |
| `SOLUS_DISCOVERY_ENABLED` | No (default: `true`) | Enable/disable auto-discovery |
| `VITE_API_URL` | No (default: `http://localhost:8000/api`) | Frontend API base URL |

---

## Demo Flows

### Demo A: Change Propagation
KiCad chip swap → snapshot diff → BFS impact analysis → AI explains per-component actions

### Demo B: Live Bench Monitoring
Simulated telemetry → real-time dashboard → anomaly detection → AI diagnosis with context + memory

### Demo C: Team Memory Reuse
Issue logged → similar issue later → semantic search finds past fix → suggests reuse

### Demo D: External Knowledge
"I need a motor driver for NEMA17, 12V, microstepping, Teensy 4.1" → grounded recommendation with wiring for your system

### Demo E: Simulator Loop
Parameter change → differential drive simulation → compare against runtime telemetry → flag discrepancies
