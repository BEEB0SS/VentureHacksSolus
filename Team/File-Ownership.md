# File Ownership

> Part of [[Team]]

**Rule: Never edit a file you don't own.** This is how we avoid merge conflicts.

## Pratham Owns
- `apps/backend/src/context_engine.py`
- `apps/backend/src/connectors/github_connector.py`
- `apps/backend/src/connectors/kicad_connector.py`
- `apps/backend/src/connectors/onshape_connector.py`
- `apps/backend/src/routes_core.py`
- `apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx`
- `apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx`

## Teammate 1 Owns
- `apps/backend/src/live_bench.py`
- `apps/backend/src/routes_livebench.py`
- `apps/desktop/src/renderer/components/live-bench/LiveBenchTab.tsx`
- `apps/desktop/src/renderer/components/agent/AgentTab.tsx`

## Teammate 2 Owns
- `apps/backend/src/agent/solus_agent.py`
- `apps/backend/src/memory/memory_store.py`
- `apps/backend/src/connectors/pdf_connector.py`
- `apps/backend/src/simulator/mujoco_wrapper.py`
- `apps/backend/src/routes_agent.py`
- `apps/desktop/src/renderer/components/simulator/SimulatorTab.tsx`

## Teammate 3 Owns
- `apps/backend/src/main.py`
- `apps/desktop/src/renderer/stores/projectStore.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/components/shared/*`
- `apps/desktop/src/renderer/hooks/*`
- `scripts/seed_demo.py`

## Shared (Read-Only — Nobody Edits)
- `packages/shared_types/src/models.py`
- `apps/backend/src/database.py`
- `productcontext.md`

#ownership #files #conflicts
