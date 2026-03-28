# Hackathon Timeline

> Part of [[Operations]]

## Phase 1: Everyone Starts Simultaneously (Hour 0)
All 4 people clone, set up, branch, and start building at the same time. Nobody is blocked — everyone has files with zero dependencies.

- **Pratham:** context_engine.py first (foundation), then KiCad/GitHub connectors, routes_core.py, frontend tabs
- **Teammate 1:** live_bench.py (no dependencies), then routes_livebench.py, LiveBenchTab, AgentTab
- **Teammate 2:** memory_store.py (no dependencies), then solus_agent.py, mujoco_wrapper.py, routes_agent.py, SimulatorTab
- **Teammate 3:** projectStore.ts (everyone's frontend depends on this), then shared UI, main.py, hooks

## Phase 2: First Merges (Hour 2-3)
1. **Pratham merges** — context engine is the foundation
2. **Teammate 3 merges** — Zustand store and shared components
3. Everyone pulls after each merge

## Phase 3: Remaining Merges (Hour 3-4)
3. **Teammate 1 merges** — live bench + agent chat + issues/fixes
4. **Teammate 2 merges** — AI agent + memory + simulator
5. Everyone pulls after each merge

## Phase 4: Integration + Polish (Hour 4-5)
- Teammate 3 does final pass: updates App.tsx imports, fixes wiring
- Everyone tests their demo flow end-to-end
- Fix cross-cutting bugs together
- Seed demo data with seed_demo.py

## Phase 5: Demo Prep (Final Hour)
- Run through all 5 demos in order
- Make sure seeded data looks good in the graph
- Practice the narrative from [[Demo-Narrative]]

#timeline #hackathon #phases
