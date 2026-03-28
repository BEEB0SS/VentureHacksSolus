# Solus — Robotics Context Model

A development workspace that builds a **living knowledge graph** of your entire robot system — hardware, software, interfaces, telemetry, and documents — then uses that graph to detect change impact, debug across domains, and reuse team knowledge.

**The core insight:** Robotics engineers spend most of their time making systems work together, not building functionality. No existing tool understands the robot as a full system. Solus connects the dots across KiCad schematics, GitHub repos, Onshape assemblies, runtime telemetry, and team memory into one queryable graph.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   SOLUS DESKTOP APP (Electron + React)                   │
│                                                                         │
│  ┌─────────────┐ ┌────────────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │ Workspace   │ │ Context Model  │ │    Agent     │ │  Simulator  │  │
│  │ Tab         │ │ Tab            │ │    Tab       │ │  Tab        │  │
│  │             │ │                │ │ (3-Panel)    │ │             │  │
│  │ Sources     │ │ D3 Force Graph │ │ Mode│Query│Mem│ │ Parameters  │  │
│  │ Sync        │ │ Impact BFS    │ │ Sel │Work │Pan│ │ Trajectory  │  │
│  │ Changes     │ │ AI Explanation │ │ Hist│space│el │ │ PID Tuning  │  │
│  └──────┬──────┘ └───────┬────────┘ └──────┬──────┘ └──────┬──────┘  │
└─────────┼────────────────┼─────────────────┼───────────────┼──────────┘
          │           HTTP REST API          │               │
          ▼                ▼                 ▼               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     FASTAPI BACKEND (Python 3.11+)                      │
│                                                                         │
│  ┌───────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │ Context Engine│ │ Solus Agent  │ │  Discovery   │ │  Simulator  │  │
│  │               │ │              │ │  Engine      │ │             │  │
│  │ Graph CRUD    │ │ 6 Query Types│ │              │ │ Diff. Drive │  │
│  │ BFS Impact    │ │ Gemini AI    │ │ 3 Analyzers: │ │ Kinematics  │  │
│  │ Snapshot+Diff │ │ Fallback     │ │ Python AST   │ │ PID Optimize│  │
│  │ Change Track  │ │ Chain        │ │ KiCad Netlist│ │ AI Tuning   │  │
│  └───────┬───────┘ └──────┬───────┘ │ Config File  │ └─────────────┘  │
│          │                │         └──────────────┘                   │
│  ┌───────┴────────────────┴────────────────────────────────────────┐   │
│  │                        CONNECTORS                               │   │
│  │  GitHub ──── Onshape ──── KiCad ──── PDF                       │   │
│  │  (local+API)  (REST API)  (S-expr)   (PyPDF2)                  │   │
│  └─────────────────────────┬───────────────────────────────────────┘   │
│                             │                                          │
│  ┌──────────────────────────┴──────────────────────────────────────┐   │
│  │  SQLite: entities, relations, snapshots, changes, memory, ...  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   Google Gemini         GitHub API           Onshape API
   (AI reasoning)        (repo tree +         (assembly +
                          file contents)       parts + mass)
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
