# VentureHacksSolus

# Solus — Robotics Development Workspace

A team robotics development workspace centered on a **Robotics Context Model** that continuously ingests design, code, documents, runtime telemetry, and simulation state, then uses that shared context to help teams plan, detect change impact, debug, and reuse knowledge.

---

## Team & Roles

| Person | Role | Demo Flows | Branch |
|--------|------|-----------|--------|
| **Pratham (Lead)** | Foundation + Demo A | Change Propagation | `feature/core-change-propagation` |
| **Teammate 1** | Demo B + Demo C | Live Bench + Team Memory | `feature/livebench-memory` |
| **Teammate 2** | Demo D + Demo E | AI Knowledge + Simulator | `feature/ai-knowledge-simulator` |
| **Teammate 3** | App Shell + Integration | Store, shared UI, wiring, polish | `feature/shell-integration` |

---

## Getting Started (Everyone Does This)

### 1. Clone the repo

```bash
git clone git@github.com:BEEB0SS/VentureHacksSolus.git
cd VentureHacksSolus
```

### 2. Set up the backend

```bash
cd apps/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -c "from src.database import init_db; init_db()"
cd ../..
```

### 3. Set up the frontend

```bash
cd apps/desktop
pnpm install
cd ../..
```

### 4. Verify everything works

**Terminal 1 — Backend:**
```bash
cd apps/backend && source .venv/bin/activate
uvicorn src.main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd apps/desktop && pnpm run dev:web
```

Open http://localhost:5173 — you should see the dark Solus UI with 5 sidebar tabs.

### 5. Create your branch

```bash
git checkout -b feature/YOUR-BRANCH-NAME
```

Branch names are listed in the table above.

### 6. Start Claude Code

```bash
cd /path/to/VentureHacksSolus
claude
```

Then paste the prompt from your prompt file in `claude-prompts/`. See below.

---

## Claude Code Prompts

Each person has a prompt file in `claude-prompts/`. When you open Claude Code, paste the contents of your file:

| Person | Prompt File | Brief (full spec) |
|--------|-------------|-------------------|
| Pratham | `claude-prompts/pratham-prompt.md` | `team-briefs/YOU_LEAD_DEMO_A.md` |
| Teammate 1 | `claude-prompts/teammate1-prompt.md` | `team-briefs/TEAMMATE_1_LIVEBENCH_MEMORY.md` |
| Teammate 2 | `claude-prompts/teammate2-prompt.md` | `team-briefs/TEAMMATE_2_AI_SIMULATOR.md` |
| Teammate 3 | `claude-prompts/teammate3-prompt.md` | `team-briefs/TEAMMATE_3_SHELL_INTEGRATION.md` |

Claude Code can see every file in the repo, so it will read `PRODUCT_CONTEXT.md`, `models.py`, `database.py`, and your team brief automatically when you tell it to.

---

## How We Work Together (Step by Step)

### Phase 1: Everyone starts simultaneously (Hour 0)

All 4 people clone, set up, branch, and start Claude Code at the same time.

**What each person does immediately:**

- **Pratham:** Build `context_engine.py` first (everyone depends on this), then KiCad/GitHub connectors, then `routes_core.py`, then the Workspace and Context Model frontend tabs.

- **Teammate 1:** Build `live_bench.py` (no dependencies on anyone), then `routes_livebench.py`, then the Live Bench tab and Agent chat tab.

- **Teammate 2:** Build `memory/memory_store.py` first (no dependencies), then `agent/solus_agent.py`, then `simulator/mujoco_wrapper.py`, then `routes_agent.py`, then Simulator tab.

- **Teammate 3:** Build `stores/projectStore.ts` first (everyone's frontend depends on this), then shared UI components, then `main.py` wiring, then hooks.

**Nobody is blocked.** Everyone has files with zero dependencies they can start on immediately. When someone needs another person's code (e.g. Teammate 2 needs `context_engine.py`), they code against the interface described in `models.py` and it resolves after merging.

### Phase 2: First merges (Hour 2-3)

**Pratham merges first** — the context engine is the foundation.

```bash
git add -A
git commit -m "Context engine + connectors + core routes + workspace/context tabs"
git push origin feature/core-change-propagation
# Open PR on GitHub → merge to main
```

**Teammate 3 merges second** — the Zustand store and shared components.

```bash
git add -A
git commit -m "Zustand store + shared UI components + main.py wiring"
git push origin feature/shell-integration
# Open PR → merge to main
```

**Everyone pulls after each merge:**

```bash
git checkout feature/YOUR-BRANCH
git pull origin main
git rebase main
# Fix any conflicts (there shouldn't be any)
```

### Phase 3: Remaining merges (Hour 3-4)

**Teammate 1 merges** — live bench + agent chat + issues/fixes.

**Teammate 2 merges** — AI agent + memory + simulator.

Same workflow: push, PR, merge, everyone pulls.

### Phase 4: Integration + polish (Hour 4-5)

- Teammate 3 does a final pass: updates `App.tsx` imports, fixes any broken wiring
- Everyone tests their demo flow end-to-end
- Fix any cross-cutting bugs together

---

## Merge Order (Follow This)

```
1. Pratham          → context engine, connectors, core routes, workspace/context tabs
2. Teammate 3       → store, shared components, main.py
3. Teammate 1       → live bench, agent chat, issues/fixes routes
4. Teammate 2       → AI agent, memory, simulator, agent routes
5. Teammate 3 again → final integration pass, polish
```

---

## File Ownership (Who Touches What)

This is how we avoid merge conflicts. **Never edit a file you don't own.**

### Pratham owns:
```
apps/backend/src/context_engine.py
apps/backend/src/connectors/github_connector.py
apps/backend/src/connectors/kicad_connector.py
apps/backend/src/connectors/onshape_connector.py
apps/backend/src/routes_core.py
apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx
apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx
```

### Teammate 1 owns:
```
apps/backend/src/live_bench.py
apps/backend/src/routes_livebench.py
apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx
apps/desktop/src/renderer/components/agent/AgentTab.tsx
```

### Teammate 2 owns:
```
apps/backend/src/agent/solus_agent.py
apps/backend/src/memory/memory_store.py
apps/backend/src/connectors/pdf_connector.py
apps/backend/src/simulator/mujoco_wrapper.py
apps/backend/src/routes_agent.py
apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx
```

### Teammate 3 owns:
```
apps/backend/src/main.py
apps/desktop/src/renderer/stores/projectStore.ts
apps/desktop/src/renderer/App.tsx
apps/desktop/src/renderer/components/shared/*
apps/desktop/src/renderer/hooks/*
scripts/seed_demo.py
```

### Nobody edits (shared contracts — read only):
```
packages/shared_types/src/models.py
apps/backend/src/database.py
PRODUCT_CONTEXT.md
```

---

## How Routes Work (No Conflicts on main.py)

Each person creates their own route file using FastAPI's `APIRouter`:

```
apps/backend/src/
├── routes_core.py        ← Pratham
├── routes_livebench.py   ← Teammate 1
├── routes_agent.py       ← Teammate 2
└── main.py               ← Teammate 3 (imports all routers)
```

Example route file:
```python
from fastapi import APIRouter
router = APIRouter(prefix="/api")

@router.get("/projects/{id}/graph")
async def get_graph(id: str):
    ...
```

Teammate 3's `main.py` wires them together:
```python
app.include_router(core_router)
app.include_router(livebench_router)
app.include_router(agent_router)
```

---

## The 5 Demo Flows We're Building

### Demo A: Change Propagation (Pratham)
KiCad PCB change → context model detects diff → impact analysis shows what software breaks → AI explains how

### Demo B: Live Bench (Teammate 1)
Simulated telemetry streaming → real-time dashboard → anomaly detected → AI diagnoses using context + memory

### Demo C: Team Memory (Teammate 1)
Issue logged + fixed → later similar issue appears → system retrieves past solution → suggests reuse

### Demo D: External Knowledge (Teammate 2)
Ask for components under constraints → AI recommends with compatibility reasoning → extract values from papers

### Demo E: Simulator Loop (Teammate 2)
Design parameter changes → simulation runs → compare sim vs runtime → show discrepancies

---

## Tech Stack

- **Desktop:** Electron + React + TypeScript + Tailwind CSS v4
- **Backend:** Python FastAPI (localhost:8000, proxied through Vite)
- **Database:** SQLite
- **AI:** Google Gemini API (`GEMINI_API_KEY` env var)
- **Telemetry:** WebSocket streaming
- **State:** Zustand
- **Charts:** Recharts
- **Graph Viz:** D3 force-directed layout