# Execution Plan

> Part of [[BRAIN-INDEX]]

The build roadmap for the Solus hackathon. This is the source of truth for what needs to be done and in what order.

## Phase 1: Foundation (Hour 0-2)

**Goal**: Every teammate has their core engine running independently.

| Step | Task | Status | Dependencies | Details |
|------|------|--------|--------------|---------|
| 1.1 | Pratham: Build context_engine.py | not_started | None | Entity/relation CRUD, snapshot+diff, impact analysis BFS, subgraph retrieval |
| 1.2 | Pratham: Build kicad_connector.py | not_started | 1.1 | Parse .kicad_sch/.kicad_pcb, extract components, nets, classify by ref |
| 1.3 | Pratham: Build github_connector.py | not_started | 1.1 | Walk repo, find robotics files, classify, detect ROS packages |
| 1.4 | Pratham: Build routes_core.py | not_started | 1.1-1.3 | All core API routes with APIRouter |
| 1.5 | Teammate 1: Build live_bench.py | not_started | None | Telemetry engine, simulated data gen, anomaly detection, listeners |
| 1.6 | Teammate 1: Build routes_livebench.py | not_started | 1.5 | Live bench + issues/fixes routes, WebSocket endpoint |
| 1.7 | Teammate 2: Build memory_store.py | not_started | None | TF-IDF semantic search, issue/fix storage |
| 1.8 | Teammate 2: Build solus_agent.py | not_started | 1.7 | Gemini-powered agent, query routing, context building |
| 1.9 | Teammate 2: Build mujoco_wrapper.py | not_started | None | Physics stub with differential drive kinematics |
| 1.10 | Teammate 2: Build routes_agent.py | not_started | 1.7-1.9 | Agent + memory + simulator routes |
| 1.11 | Teammate 3: Build projectStore.ts | not_started | None | Zustand store with all actions |
| 1.12 | Teammate 3: Build shared hooks | not_started | None | useApi, useWebSocket, useProject |
| 1.13 | Teammate 3: Build shared components | not_started | None | LoadingSpinner, EmptyState, StatusDot, Card, Modal |
| 1.14 | Teammate 3: Build main.py | not_started | None | Wire all routers with try/except |

## Phase 2: First Merges + Frontend (Hour 2-3)

**Goal**: Pratham and Teammate 3 merge. Frontend tabs start connecting to real data.

| Step | Task | Status | Dependencies | Details |
|------|------|--------|--------------|---------|
| 2.1 | Pratham: Build WorkspaceTab.tsx | not_started | 1.4 | Project selector, sources panel, sync buttons, changes timeline |
| 2.2 | Pratham: Build ContextModelTab.tsx | not_started | 1.4 | D3 force-directed graph, impact analysis button |
| 2.3 | Pratham: Merge to main | not_started | 2.1-2.2 | First merge — foundation is live |
| 2.4 | Teammate 3: Merge to main | not_started | 1.11-1.14 | Second merge — shared infra is live |
| 2.5 | Everyone: Pull from main | not_started | 2.3-2.4 | Rebase feature branches onto main |
| 2.6 | Teammate 1: Build LiveBenchTab.tsx | not_started | 1.5-1.6 | Signal grid, sparklines, anomaly feed |
| 2.7 | Teammate 1: Build AgentTab.tsx | not_started | 1.6 | Chat interface, query type dropdown |
| 2.8 | Teammate 2: Build SimulatorTab.tsx | not_started | 1.9-1.10 | Parameter editor, trajectory chart, discrepancy table |

## Phase 3: Remaining Merges (Hour 3-4)

**Goal**: All code is on main. All demo flows work individually.

| Step | Task | Status | Dependencies | Details |
|------|------|--------|--------------|---------|
| 3.1 | Teammate 1: Merge to main | not_started | 2.5-2.7 | Live bench + agent chat + issues live |
| 3.2 | Teammate 2: Merge to main | not_started | 2.5, 2.8 | AI agent + memory + simulator live |
| 3.3 | Everyone: Pull from main | not_started | 3.1-3.2 | All code on main |

## Phase 4: Integration + Polish (Hour 4-5)

**Goal**: All 5 demo flows work end-to-end. App feels cohesive.

| Step | Task | Status | Dependencies | Details |
|------|------|--------|--------------|---------|
| 4.1 | Teammate 3: Final integration pass | not_started | 3.3 | Update App.tsx imports, fix wiring |
| 4.2 | Teammate 3: Run seed_demo.py | not_started | 4.1 | Populate demo data |
| 4.3 | All: Test Demo A end-to-end | not_started | 4.1 | KiCad sync → graph → change → impact |
| 4.4 | All: Test Demo B end-to-end | not_started | 4.1 | Start sim → sparklines → anomaly → diagnose |
| 4.5 | All: Test Demo C end-to-end | not_started | 4.1 | Log issue → find similar → show fix |
| 4.6 | All: Test Demo D end-to-end | not_started | 4.1 | Query parts → grounded recommendation |
| 4.7 | All: Test Demo E end-to-end | not_started | 4.1 | Change param → sim → compare → discrepancy |
| 4.8 | Teammate 3: Polish pass | not_started | 4.3-4.7 | Consistent styling, transitions, error handling |

## Phase 5: Demo Prep

**Goal**: Ready to present.

| Step | Task | Status | Dependencies | Details |
|------|------|--------|--------------|---------|
| 5.1 | Practice demo narrative | not_started | 4.8 | Run through all 5 flows in order |
| 5.2 | Prepare fallback plans | not_started | 5.1 | Screenshots/recordings in case of crashes |
| 5.3 | Final run-through | not_started | 5.2 | Full demo with timing |
