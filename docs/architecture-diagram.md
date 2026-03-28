# Solus — Technical Architecture

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     ELECTRON DESKTOP APP                             │
│                                                                      │
│   React 18 + TypeScript + Tailwind CSS v4                           │
│   Zustand (state management) · Recharts (data viz) · D3 (graphs)   │
│   Three.js + MuJoCo WASM (3D physics viewer)                       │
│                                                                      │
│   ┌────────────┐ ┌──────────┐ ┌───────┐ ┌───────────┐ ┌─────────┐ │
│   │ Workspace  │ │ Context  │ │ Agent │ │ Live Bench│ │Simulator│ │
│   │            │ │  Model   │ │       │ │           │ │         │ │
│   │ Projects   │ │ D3 Force │ │ Chat  │ │ Telemetry │ │ MuJoCo  │ │
│   │ Sources    │ │ Graph    │ │ Query │ │ Anomaly   │ │ PID Opt │ │
│   │ Changes    │ │ Impact   │ │ Memory│ │ Issues    │ │ Before/ │ │
│   │ Sync       │ │ Analysis │ │ Search│ │ WebSocket │ │ After   │ │
│   └─────┬──────┘ └────┬─────┘ └───┬───┘ └─────┬─────┘ └────┬────┘ │
│         └──────────────┴───────────┴───────────┴────────────┘       │
│                          HTTP + WebSocket                            │
└──────────────────────────────────────────────────────────────────────┘
                                │
                        localhost:8000
                                │
┌──────────────────────────────────────────────────────────────────────┐
│                     FASTAPI BACKEND (Python)                         │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                      API LAYER                                │   │
│   │                                                               │   │
│   │  routes_core.py        routes_agent.py     routes_livebench  │   │
│   │  14 REST endpoints     10 REST endpoints   10 REST + 1 WS   │   │
│   │  Projects, Entities    Agent queries       Telemetry stream  │   │
│   │  Relations, Graph      Memory search       Anomaly detection │   │
│   │  Sources, Sync         Simulator control   Issues & Fixes    │   │
│   │  Impact analysis       PID optimization    Semantic search   │   │
│   └──────────────────────────┬───────────────────────────────────┘   │
│                               │                                      │
│   ┌───────────────────────────┴──────────────────────────────────┐   │
│   │                    CORE ENGINES                               │   │
│   │                                                               │   │
│   │  Context Engine          Solus Agent         Live Bench       │   │
│   │  ─────────────           ──────────          ──────────       │   │
│   │  Typed graph with        Gemini-powered      Simulated        │   │
│   │  14 entity types,        query routing       telemetry with   │   │
│   │  13 relation types.      across 6 modes.     8 signal types.  │   │
│   │  BFS impact analysis,    Context assembly    Threshold-based  │   │
│   │  snapshot diffing,       from graph +        anomaly detect.  │   │
│   │  change tracking.        memory + changes.   Ring buffer      │   │
│   │                                              history.         │   │
│   │  Memory Store            Simulator           Discovery        │   │
│   │  ─────────────           ─────────           ─────────        │   │
│   │  TF-IDF semantic         Diff-drive          Auto-discover    │   │
│   │  search over issues,     kinematics +        relations from   │   │
│   │  fixes, docs.            PID optimizer        Python AST,     │   │
│   │  Pure Python, no         (random search).    KiCad netlists,  │   │
│   │  ML dependencies.        MuJoCo WASM 3D.     config files.    │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                   DATA CONNECTORS                             │   │
│   │                                                               │   │
│   │  GitHub         KiCad           Onshape         PDF           │   │
│   │  ──────         ─────           ───────         ───           │   │
│   │  Local repo     S-expression    REST API v6     PyPDF2 text   │   │
│   │  walker with    parser for      for assemblies  extraction    │   │
│   │  ROS package    .kicad_sch      and part        with ~500     │   │
│   │  detection.     and .kicad_pcb  metadata.       word chunks.  │   │
│   │  File type      files. Extracts                               │   │
│   │  classification components,                                   │   │
│   │  by extension.  nets, refs.                                   │   │
│   └──────────────────────────┬───────────────────────────────────┘   │
│                               │                                      │
│                     Sync → Snapshot → Diff                           │
│                     (change detection pipeline)                      │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                     PERSISTENCE                               │   │
│   │                                                               │   │
│   │  SQLite (hackathon) → PostgreSQL + Neo4j (production)        │   │
│   │                                                               │   │
│   │  Tables: projects, entities, relations, snapshots,           │   │
│   │  change_events, runtime_packets, anomalies, issues,          │   │
│   │  fixes, semantic_memory, simulation_runs                     │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                   EXTERNAL SERVICES                           │   │
│   │                                                               │   │
│   │  Google Gemini API (gemini-2.5-flash)                        │   │
│   │  ─ Multimodal reasoning for agent queries                    │   │
│   │  ─ Structured output for impact explanations                 │   │
│   │  ─ Graceful fallback chain (flash → lite → no-AI summary)   │   │
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## Key Data Flows

**Change Propagation (Demo A)**
```
KiCad file change → Connector parses → Snapshot created →
Diff against previous → ChangeEvents generated →
BFS impact analysis → AI explains affected components
```

**Live Monitoring (Demo B)**
```
Simulated telemetry → WebSocket stream → Threshold check →
Anomaly detected → AI diagnosis using graph + memory context
```

**Team Memory (Demo C)**
```
Issue logged → Stored in semantic memory (TF-IDF) →
Similar issue query → Cosine similarity search → Past fix retrieved
```

**Simulation Optimization (Demo E)**
```
Bad PID (no correction) → Car drifts off line →
Random search over [kp, ki, kd] × 300 trials →
Best gains found → Car drives straight → Before/after comparison
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop Shell | Electron | Cross-platform app container |
| Frontend | React 18 + TypeScript | UI framework |
| Styling | Tailwind CSS v4 + Geist font | Design system |
| State | Zustand | Global state management |
| Charts | Recharts + D3.js | Data visualization + force graph |
| 3D Viewer | Three.js + MuJoCo WASM | Physics model rendering |
| Backend | Python FastAPI | REST API + WebSocket server |
| Database | SQLite (WAL mode) | Persistence with full-text indexes |
| AI | Google Gemini 2.5 Flash | Multimodal reasoning |
| Search | TF-IDF (pure Python) | Semantic similarity, no ML deps |
| Simulation | Differential drive kinematics | PID controller + optimizer |
| Parsing | Custom S-expression parser | KiCad file ingestion |
