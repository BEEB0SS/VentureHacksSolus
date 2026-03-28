# Teammate 3 Assignment: App Shell + Store + Integration + Polish

**Branch:** `feature/shell-integration`

You make sure the app feels like ONE coherent product, not four people's
code stitched together. You own the shared frontend infrastructure and
the final integration.

---

## What You Own

### Frontend
- `apps/desktop/src/renderer/stores/projectStore.ts` — THE global state store
- `apps/desktop/src/renderer/App.tsx` — update with real component imports
- `apps/desktop/src/renderer/components/shared/` — shared UI components
- `apps/desktop/src/renderer/hooks/` — shared hooks (useApi, useWebSocket, etc.)
- `apps/desktop/src/renderer/styles/` — any additional style work

### Backend
- `apps/backend/src/main.py` — the app entry point that wires everything together
- `scripts/seed_demo.py` — seeds demo data for presentations

---

## What to Build

### 1. projectStore.ts — Zustand Store (EVERYONE depends on this)

```typescript
import { create } from 'zustand'

interface ProjectStore {
  // State
  currentProjectId: string | null
  projects: any[]
  entities: any[]
  relations: any[]
  recentChanges: any[]

  // Actions
  fetchProjects: () => Promise<void>
  createProject: (name: string, description?: string) => Promise<string>
  setCurrentProject: (id: string) => void
  fetchEntities: (projectId: string) => Promise<void>
  fetchGraph: (projectId: string) => Promise<{entities: any[], relations: any[]}>
  fetchChanges: (projectId: string) => Promise<void>
  syncSource: (projectId: string, sourceId: string) => Promise<any>
  queryAgent: (projectId: string, query: string, queryType: string) => Promise<any>
  fetchImpact: (projectId: string, entityId: string) => Promise<any>
}
```

Each action calls `fetch('/api/...')` and updates state.
Other teammates' components import from this store.

### 2. Shared hooks

- `useApi(url, options)` — wrapper around fetch with loading/error states
- `useWebSocket(url)` — manages WebSocket connection, auto-reconnect, message parsing
- `useProject()` — shorthand for the current project from the store

### 3. Shared UI components (`components/shared/`)

- `LoadingSpinner.tsx`
- `EmptyState.tsx` — "No project selected" / "No data yet" / "Connect a source first"
- `ErrorBanner.tsx` — shows API errors non-destructively
- `StatusDot.tsx` — green/yellow/red indicator
- `Card.tsx` — consistent card wrapper used across tabs
- `Modal.tsx` — for "New Project" and "Add Source" dialogs

### 4. main.py — Wire all route files together

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import init_db

app = FastAPI(title="Solus", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    init_db()

# Import route files from teammates
# These will resolve as teammates merge their branches
try:
    from .routes_core import router as core_router
    app.include_router(core_router)
except ImportError:
    print("[warn] routes_core not yet available")

try:
    from .routes_livebench import router as livebench_router
    app.include_router(livebench_router)
except ImportError:
    print("[warn] routes_livebench not yet available")

try:
    from .routes_agent import router as agent_router
    app.include_router(agent_router)
except ImportError:
    print("[warn] routes_agent not yet available")

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
```

The try/except pattern means the app boots even if teammates haven't merged yet.

### 5. App.tsx — Update with real imports

Once teammates merge, update the placeholder components:

```tsx
import WorkspaceTab from './components/workspace/WorkspaceTab'
import ContextModelTab from './components/context-model/ContextModelTab'
import AgentTab from './components/agent/AgentTab'
import LiveBenchTab from './components/live-bench/LiveBenchTab'
import SimulatorTab from './components/simulator/SimulatorTab'
```

### 6. seed_demo.py — Create demo data for presentations

A Python script that pre-populates the database with:
- A demo project ("Differential Drive Robot")
- Fake entities: motor_controller.py, sensor_reader.py, DRV8825 motor driver, NEMA17 motor, ESP32, etc.
- Relations between them
- A couple of past issues + fixes (for Demo C)
- So when we demo, the graph already has interesting data

```bash
# Usage:
cd apps/backend
python scripts/seed_demo.py
```

### 7. Polish pass (after everyone merges)

- Consistent spacing, colors, fonts across all tabs
- Smooth transitions between tabs
- Loading states everywhere
- Error handling that doesn't crash the app
- Make sure the Google Fonts (Inter + JetBrains Mono) are loading

---

## Claude Code Prompt

```
Read PRODUCT_CONTEXT.md first, then look at apps/desktop/src/renderer/App.tsx
for the existing shell.

I'm building the shared frontend infrastructure. Read my full spec at
team-briefs/TEAMMATE_3_SHELL_INTEGRATION.md.

Build in this order:
1. apps/desktop/src/renderer/stores/projectStore.ts
2. apps/desktop/src/renderer/hooks/useApi.ts
3. apps/desktop/src/renderer/hooks/useWebSocket.ts
4. apps/desktop/src/renderer/components/shared/LoadingSpinner.tsx
5. apps/desktop/src/renderer/components/shared/EmptyState.tsx
6. apps/desktop/src/renderer/components/shared/StatusDot.tsx
7. apps/desktop/src/renderer/components/shared/Card.tsx
8. apps/desktop/src/renderer/components/shared/Modal.tsx
9. apps/backend/src/main.py (rewrite with try/except router imports)

Use Tailwind v4 classes with the custom solus-* colors from globals.css.
Design direction: developer tool aesthetic (VS Code / Grafana), not consumer app.
```