# Teammate 3 — Claude Code Prompt

Paste this entire block into Claude Code after running `claude` in the repo root.

---

Read these files in order before doing anything:
1. PRODUCT_CONTEXT.md — what Solus is and why we're building it
2. packages/shared-types/src/models.py — all data models
3. apps/desktop/src/renderer/App.tsx — the existing app shell
4. apps/desktop/src/renderer/styles/globals.css — the Tailwind theme
5. team-briefs/TEAMMATE_3_SHELL_INTEGRATION.md — your full spec

I'm building the shared frontend infrastructure and the backend wiring. My job is to make the app feel like ONE coherent product, not four people's code stitched together.

Build these files in this order:

1. apps/desktop/src/renderer/stores/projectStore.ts
   - Zustand store with: currentProjectId, projects[], entities[], relations[], recentChanges[]
   - Actions: fetchProjects, createProject, setCurrentProject, fetchEntities, fetchGraph, fetchChanges, syncSource, queryAgent, fetchImpact
   - Each action calls fetch('/api/...') and updates state
   - This is what every other teammate's frontend components will import

2. apps/desktop/src/renderer/hooks/useApi.ts
   - Custom hook wrapping fetch with loading, error, data states

3. apps/desktop/src/renderer/hooks/useWebSocket.ts
   - Manages WebSocket connection, auto-reconnect, message parsing

4. apps/desktop/src/renderer/components/shared/LoadingSpinner.tsx
5. apps/desktop/src/renderer/components/shared/EmptyState.tsx — "No project selected", "No data yet"
6. apps/desktop/src/renderer/components/shared/StatusDot.tsx — green/yellow/red indicator
7. apps/desktop/src/renderer/components/shared/Card.tsx — consistent card wrapper
8. apps/desktop/src/renderer/components/shared/Modal.tsx — for dialogs

9. apps/backend/src/main.py — rewrite to wire all route files:
   - Import routes_core, routes_livebench, routes_agent with try/except
   - app.include_router() for each
   - CORS middleware, startup event, health check
   - The try/except means the app boots even before teammates merge

10. scripts/seed_demo.py
    - Seeds demo data: project "Differential Drive Robot", entities (motor_controller.py, DRV8825, NEMA17, ESP32, etc.), relations, past issues + fixes
    - So when we demo, the graph already has interesting data

Design: developer tool aesthetic (VS Code / Grafana). Use the solus-* Tailwind colors. Monospace for data. Compact. No fluff.

Do NOT touch: context_engine.py, any connectors, live_bench.py, agent/solus_agent.py, memory_store.py, simulator files, or any teammate's tab components (workspace, context-model, live-bench, agent, simulator).