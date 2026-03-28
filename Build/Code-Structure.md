# Code Structure

> Part of [[Build]]

## Backend (apps/backend/)
```
apps/backend/
├── src/
│   ├── main.py                    ← Teammate 3 (wires all routers)
│   ├── database.py                ← Shared (read-only)
│   ├── context_engine.py          ← Pratham (graph engine)
│   ├── live_bench.py              ← Teammate 1 (telemetry engine)
│   ├── routes_core.py             ← Pratham (core API routes)
│   ├── routes_livebench.py        ← Teammate 1 (live bench + issues routes)
│   ├── routes_agent.py            ← Teammate 2 (agent + memory + sim routes)
│   ├── connectors/
│   │   ├── github_connector.py    ← Pratham
│   │   ├── kicad_connector.py     ← Pratham
│   │   ├── onshape_connector.py   ← Pratham (stub)
│   │   └── pdf_connector.py       ← Teammate 2
│   ├── agent/
│   │   └── solus_agent.py         ← Teammate 2 (Gemini-powered AI)
│   ├── memory/
│   │   └── memory_store.py        ← Teammate 2 (semantic search)
│   └── simulator/
│       └── mujoco_wrapper.py      ← Teammate 2 (physics sim)
├── scripts/
│   └── seed_demo.py               ← Teammate 3
└── requirements.txt
```

## Frontend (apps/desktop/)
```
apps/desktop/src/renderer/
├── App.tsx                                    ← Teammate 3
├── stores/
│   └── projectStore.ts                        ← Teammate 3
├── hooks/
│   ├── useApi.ts                              ← Teammate 3
│   └── useWebSocket.ts                        ← Teammate 3
├── components/
│   ├── shared/                                ← Teammate 3
│   │   ├── LoadingSpinner.tsx
│   │   ├── EmptyState.tsx
│   │   ├── StatusDot.tsx
│   │   ├── Card.tsx
│   │   └── Modal.tsx
│   ├── workspace/
│   │   └── WorkspaceTab.tsx                   ← Pratham
│   ├── context-model/
│   │   └── ContextModelTab.tsx                ← Pratham
│   ├── live-bench/
│   │   └── LiveBenchTab.tsx                   ← Teammate 1
│   ├── agent/
│   │   └── AgentTab.tsx                       ← Teammate 1
│   └── simulator/
│       └── SimulatorTab.tsx                   ← Teammate 2
└── styles/
    └── globals.css
```

## Shared Types
```
packages/shared-types/src/
└── models.py    ← Shared (read-only, the data contract)
```

#code #structure #files
