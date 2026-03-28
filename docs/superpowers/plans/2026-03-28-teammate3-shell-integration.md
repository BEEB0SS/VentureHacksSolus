# Teammate 3: Shell + Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared frontend infrastructure (Zustand store, hooks, UI components), backend wiring (main.py), and demo seed script so that every teammate's code plugs into a single coherent app.

**Architecture:** Zustand store is the single source of truth for all frontend state. Every tab component imports from this store — no prop drilling. Backend uses FastAPI with try/except router imports so the app boots even before teammates merge. Shared components follow a developer-tool aesthetic (VS Code/Grafana).

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind CSS v4 (custom `solus-*` tokens), Lucide icons, FastAPI, SQLite, Python 3.10+

**Branch:** `feature/shell-integration`

**IMPORTANT:** Do NOT touch any file not owned by Teammate 3. See the ownership list at the end of this plan.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/desktop/src/renderer/stores/projectStore.ts` | Global Zustand store — all state + API actions |
| Create | `apps/desktop/src/renderer/hooks/useApi.ts` | Generic fetch wrapper with loading/error/data |
| Create | `apps/desktop/src/renderer/hooks/useWebSocket.ts` | WebSocket connection manager with auto-reconnect |
| Create | `apps/desktop/src/renderer/components/shared/LoadingSpinner.tsx` | Spinning indicator |
| Create | `apps/desktop/src/renderer/components/shared/EmptyState.tsx` | Placeholder for no-data states |
| Create | `apps/desktop/src/renderer/components/shared/StatusDot.tsx` | Green/yellow/red dot indicator |
| Create | `apps/desktop/src/renderer/components/shared/Card.tsx` | Consistent card wrapper |
| Create | `apps/desktop/src/renderer/components/shared/Modal.tsx` | Dialog overlay |
| Modify | `apps/backend/src/main.py` | Add try/except router imports, keep health check |
| Create | `apps/backend/scripts/seed_demo.py` | Populate DB with demo data |

---

## Parallelism Map

These tasks have NO dependencies on each other and can ALL run as parallel subagents:

```
Task 1 (projectStore.ts)     ──┐
Task 2 (useApi.ts)            ──┤
Task 3 (useWebSocket.ts)      ──┤── All independent, run in parallel
Task 4 (shared components)    ──┤
Task 5 (main.py)              ──┤
Task 6 (seed_demo.py)         ──┘
                                │
                                ▼
Task 7 (App.tsx update)       ──── Depends on Task 1 (store must exist)
```

---

## Reference: API Endpoints (What the Store Calls)

These are defined by Pratham in `routes_core.py`, Teammate 1 in `routes_livebench.py`, and Teammate 2 in `routes_agent.py`. The store calls them via `fetch()`. The backend base URL is `http://localhost:8000`.

| Method | Endpoint | Used by store action |
|--------|----------|---------------------|
| GET | `/api/projects` | `fetchProjects()` |
| POST | `/api/projects` | `createProject()` |
| GET | `/api/projects/{id}/entities` | `fetchEntities()` |
| GET | `/api/projects/{id}/graph` | `fetchGraph()` |
| GET | `/api/projects/{id}/changes` | `fetchChanges()` |
| POST | `/api/projects/{id}/sources/{sid}/sync` | `syncSource()` |
| GET | `/api/projects/{id}/impact/{eid}` | `fetchImpact()` |
| POST | `/api/projects/{id}/agent/query` | `queryAgent()` |
| GET | `/api/projects/{id}/sources` | `fetchSources()` |
| POST | `/api/projects/{id}/sources` | `addSource()` |
| GET | `/api/projects/{id}/team` | `fetchTeam()` |
| POST | `/api/projects/{id}/team` | `addTeamMember()` |

---

## Reference: Tailwind Theme Tokens

Defined in `apps/desktop/src/renderer/styles/globals.css`:

```
--color-solus-bg: #0a0a0f          (page background)
--color-solus-surface: #12121a      (card/sidebar background)
--color-solus-elevated: #1a1a26     (hover states, raised elements)
--color-solus-border: #2a2a3a       (borders)
--color-solus-accent: #6366f1       (primary accent — indigo)
--color-solus-accent-bright: #818cf8 (hover/active accent)
--color-solus-success: #22c55e      (green)
--color-solus-warning: #f59e0b      (yellow)
--color-solus-error: #ef4444        (red)
--color-solus-text: #e2e8f0         (primary text)
--color-solus-text-dim: #94a3b8     (secondary text)
--color-solus-text-muted: #64748b   (disabled/placeholder text)
--font-sans: 'Inter'
--font-mono: 'JetBrains Mono'
```

Use these as Tailwind classes: `bg-solus-bg`, `text-solus-accent`, `border-solus-border`, etc.

---

## Reference: Database Schema (for seed_demo.py)

The SQLite schema is in `apps/backend/src/database.py`. Key tables the seed script writes to:

- `projects` — id (TEXT PK), name, description, created_at, updated_at
- `entities` — id (TEXT PK), project_id (FK), entity_type, name, description, metadata (JSON), source, source_ref, created_at, updated_at
- `relations` — id (TEXT PK), project_id (FK), source_entity_id (FK), target_entity_id (FK), relation_type, metadata (JSON), confidence, created_at
- `source_connections` — id (TEXT PK), project_id (FK), source_type, name, config (JSON), last_synced_at, status
- `issues` — id (TEXT PK), project_id (FK), title, description, status, related_entity_ids (JSON), reported_by, created_at, updated_at
- `fixes` — id (TEXT PK), issue_id (FK), project_id (FK), description, steps (JSON), applied_by, created_at
- `semantic_memory` — id (TEXT PK), project_id (FK), content, content_type, metadata (JSON), embedding (BLOB), created_at

All IDs are TEXT (use UUIDs). All timestamps are ISO 8601 strings. JSON fields are stored as TEXT strings.

---

## Task 1: Zustand Store (`projectStore.ts`)

**Files:**
- Create: `apps/desktop/src/renderer/stores/projectStore.ts`

This is the most critical file. Every frontend tab imports from this store. It holds all shared state and exposes actions that call the backend API.

- [ ] **Step 1: Create the store file with state interface and empty store**

```typescript
// apps/desktop/src/renderer/stores/projectStore.ts
import { create } from 'zustand'

const API_BASE = 'http://localhost:8000'

interface Entity {
  id: string
  project_id: string
  entity_type: string
  name: string
  description: string
  metadata: Record<string, unknown>
  source: string
  source_ref: string
  created_at: string
  updated_at: string
}

interface Relation {
  id: string
  project_id: string
  source_entity_id: string
  target_entity_id: string
  relation_type: string
  metadata: Record<string, unknown>
  confidence: number
  created_at: string
}

interface Project {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

interface SourceConnection {
  id: string
  project_id: string
  source_type: string
  name: string
  config: Record<string, unknown>
  last_synced_at: string | null
  status: string
}

interface TeamMember {
  id: string
  project_id: string
  name: string
  role: string
  email: string
}

interface ChangeEvent {
  id: string
  project_id: string
  change_type: string
  entity_id: string
  entity_name: string
  description: string
  diff_data: Record<string, unknown>
  impacted_entity_ids: string[]
  created_at: string
  acknowledged: boolean
}

interface ProjectStore {
  // State
  currentProjectId: string | null
  projects: Project[]
  entities: Entity[]
  relations: Relation[]
  sources: SourceConnection[]
  teamMembers: TeamMember[]
  recentChanges: ChangeEvent[]
  loading: Record<string, boolean>
  error: string | null

  // Actions
  fetchProjects: () => Promise<void>
  createProject: (name: string, description?: string) => Promise<string>
  setCurrentProject: (id: string) => void
  fetchEntities: (projectId: string) => Promise<void>
  fetchGraph: (projectId: string) => Promise<{ entities: Entity[]; relations: Relation[] }>
  fetchChanges: (projectId: string) => Promise<void>
  fetchSources: (projectId: string) => Promise<void>
  addSource: (projectId: string, sourceType: string, name: string, config: Record<string, unknown>) => Promise<void>
  syncSource: (projectId: string, sourceId: string) => Promise<unknown>
  fetchTeam: (projectId: string) => Promise<void>
  addTeamMember: (projectId: string, name: string, role: string, email: string) => Promise<void>
  queryAgent: (projectId: string, query: string, queryType: string) => Promise<unknown>
  fetchImpact: (projectId: string, entityId: string) => Promise<unknown>
  clearError: () => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  currentProjectId: null,
  projects: [],
  entities: [],
  relations: [],
  sources: [],
  teamMembers: [],
  recentChanges: [],
  loading: {},
  error: null,

  clearError: () => set({ error: null }),

  setCurrentProject: (id: string) => {
    set({ currentProjectId: id, entities: [], relations: [], sources: [], teamMembers: [], recentChanges: [] })
    const store = get()
    store.fetchEntities(id)
    store.fetchSources(id)
    store.fetchChanges(id)
    store.fetchTeam(id)
  },

  fetchProjects: async () => {
    set((s) => ({ loading: { ...s.loading, projects: true } }))
    try {
      const res = await fetch(`${API_BASE}/api/projects`)
      if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`)
      const projects = await res.json()
      set({ projects, error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set((s) => ({ loading: { ...s.loading, projects: false } }))
    }
  },

  createProject: async (name: string, description = '') => {
    const res = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    })
    if (!res.ok) throw new Error(`Failed to create project: ${res.status}`)
    const project = await res.json()
    set((s) => ({ projects: [...s.projects, project] }))
    return project.id
  },

  fetchEntities: async (projectId: string) => {
    set((s) => ({ loading: { ...s.loading, entities: true } }))
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/entities`)
      if (!res.ok) throw new Error(`Failed to fetch entities: ${res.status}`)
      const entities = await res.json()
      set({ entities, error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set((s) => ({ loading: { ...s.loading, entities: false } }))
    }
  },

  fetchGraph: async (projectId: string) => {
    set((s) => ({ loading: { ...s.loading, graph: true } }))
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/graph`)
      if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`)
      const data = await res.json()
      set({ entities: data.entities, relations: data.relations, error: null })
      return data
    } catch (e) {
      set({ error: (e as Error).message })
      return { entities: [], relations: [] }
    } finally {
      set((s) => ({ loading: { ...s.loading, graph: false } }))
    }
  },

  fetchChanges: async (projectId: string) => {
    set((s) => ({ loading: { ...s.loading, changes: true } }))
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/changes`)
      if (!res.ok) throw new Error(`Failed to fetch changes: ${res.status}`)
      const recentChanges = await res.json()
      set({ recentChanges, error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set((s) => ({ loading: { ...s.loading, changes: false } }))
    }
  },

  fetchSources: async (projectId: string) => {
    set((s) => ({ loading: { ...s.loading, sources: true } }))
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/sources`)
      if (!res.ok) throw new Error(`Failed to fetch sources: ${res.status}`)
      const sources = await res.json()
      set({ sources, error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set((s) => ({ loading: { ...s.loading, sources: false } }))
    }
  },

  addSource: async (projectId: string, sourceType: string, name: string, config: Record<string, unknown>) => {
    const res = await fetch(`${API_BASE}/api/projects/${projectId}/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: sourceType, name, config }),
    })
    if (!res.ok) throw new Error(`Failed to add source: ${res.status}`)
    await get().fetchSources(projectId)
  },

  syncSource: async (projectId: string, sourceId: string) => {
    set((s) => ({ loading: { ...s.loading, sync: true } }))
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/sources/${sourceId}/sync`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`)
      const result = await res.json()
      // Refresh entities, graph, and changes after sync
      await Promise.all([
        get().fetchEntities(projectId),
        get().fetchChanges(projectId),
        get().fetchSources(projectId),
      ])
      return result
    } catch (e) {
      set({ error: (e as Error).message })
      throw e
    } finally {
      set((s) => ({ loading: { ...s.loading, sync: false } }))
    }
  },

  fetchTeam: async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/team`)
      if (!res.ok) throw new Error(`Failed to fetch team: ${res.status}`)
      const teamMembers = await res.json()
      set({ teamMembers })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  addTeamMember: async (projectId: string, name: string, role: string, email: string) => {
    const res = await fetch(`${API_BASE}/api/projects/${projectId}/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, email }),
    })
    if (!res.ok) throw new Error(`Failed to add team member: ${res.status}`)
    await get().fetchTeam(projectId)
  },

  queryAgent: async (projectId: string, query: string, queryType: string) => {
    const res = await fetch(`${API_BASE}/api/projects/${projectId}/agent/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, query_type: queryType }),
    })
    if (!res.ok) throw new Error(`Agent query failed: ${res.status}`)
    return res.json()
  },

  fetchImpact: async (projectId: string, entityId: string) => {
    const res = await fetch(`${API_BASE}/api/projects/${projectId}/impact/${entityId}`)
    if (!res.ok) throw new Error(`Impact analysis failed: ${res.status}`)
    return res.json()
  },
}))
```

- [ ] **Step 2: Verify the store compiles**

Run: `cd apps/desktop && npx tsc --noEmit src/renderer/stores/projectStore.ts`
Expected: No errors (or only errors about missing path aliases, which is fine — Vite handles those at runtime).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/stores/projectStore.ts
git commit -m "feat: add Zustand project store with all API actions"
```

---

## Task 2: useApi Hook

**Files:**
- Create: `apps/desktop/src/renderer/hooks/useApi.ts`

Generic fetch wrapper that any component can use for one-off API calls outside the store.

- [ ] **Step 1: Create the hook**

```typescript
// apps/desktop/src/renderer/hooks/useApi.ts
import { useState, useCallback } from 'react'

const API_BASE = 'http://localhost:8000'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

interface UseApiReturn<T> extends UseApiState<T> {
  call: (url: string, options?: RequestInit) => Promise<T>
  reset: () => void
}

export function useApi<T = unknown>(): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  })

  const call = useCallback(async (url: string, options?: RequestInit): Promise<T> => {
    setState({ data: null, loading: true, error: null })
    try {
      const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`
      const res = await fetch(fullUrl, {
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        ...options,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(text || `Request failed: ${res.status}`)
      }
      const data = await res.json() as T
      setState({ data, loading: false, error: null })
      return data
    } catch (e) {
      const msg = (e as Error).message
      setState({ data: null, loading: false, error: msg })
      throw e
    }
  }, [])

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null })
  }, [])

  return { ...state, call, reset }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/hooks/useApi.ts
git commit -m "feat: add useApi hook for generic fetch with loading/error"
```

---

## Task 3: useWebSocket Hook

**Files:**
- Create: `apps/desktop/src/renderer/hooks/useWebSocket.ts`

Manages a WebSocket connection with auto-reconnect. Used by LiveBenchTab for real-time telemetry streaming.

- [ ] **Step 1: Create the hook**

```typescript
// apps/desktop/src/renderer/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react'

const WS_BASE = 'ws://localhost:8000'

interface UseWebSocketOptions {
  onMessage?: (data: unknown) => void
  reconnectInterval?: number
  maxRetries?: number
}

interface UseWebSocketReturn {
  connected: boolean
  send: (data: unknown) => void
  disconnect: () => void
}

export function useWebSocket(
  path: string | null,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const { onMessage, reconnectInterval = 3000, maxRetries = 5 } = options
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!path) return

    const fullUrl = path.startsWith('ws') ? path : `${WS_BASE}${path}`
    const ws = new WebSocket(fullUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      retriesRef.current = 0
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessageRef.current?.(data)
      } catch {
        onMessageRef.current?.(event.data)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      if (retriesRef.current < maxRetries) {
        retriesRef.current++
        setTimeout(connect, reconnectInterval)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [path, reconnectInterval, maxRetries])

  useEffect(() => {
    connect()
    return () => {
      retriesRef.current = maxRetries // prevent reconnect on cleanup
      wsRef.current?.close()
    }
  }, [connect, maxRetries])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }, [])

  const disconnect = useCallback(() => {
    retriesRef.current = maxRetries
    wsRef.current?.close()
  }, [maxRetries])

  return { connected, send, disconnect }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/renderer/hooks/useWebSocket.ts
git commit -m "feat: add useWebSocket hook with auto-reconnect"
```

---

## Task 4: Shared UI Components

**Files:**
- Create: `apps/desktop/src/renderer/components/shared/LoadingSpinner.tsx`
- Create: `apps/desktop/src/renderer/components/shared/EmptyState.tsx`
- Create: `apps/desktop/src/renderer/components/shared/StatusDot.tsx`
- Create: `apps/desktop/src/renderer/components/shared/Card.tsx`
- Create: `apps/desktop/src/renderer/components/shared/Modal.tsx`

All five are small, self-contained components. Build them all in one task.

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p apps/desktop/src/renderer/components/shared
```

- [ ] **Step 2: Create LoadingSpinner.tsx**

```tsx
// apps/desktop/src/renderer/components/shared/LoadingSpinner.tsx
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }

export function LoadingSpinner({ size = 'md', label }: LoadingSpinnerProps) {
  return (
    <div className="flex items-center gap-2 text-solus-text-dim">
      <svg className={`${sizes[size]} animate-spin`} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
```

- [ ] **Step 3: Create EmptyState.tsx**

```tsx
// apps/desktop/src/renderer/components/shared/EmptyState.tsx
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: React.ReactNode
}

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-solus-text-muted mb-3">
        {icon || <Inbox size={32} />}
      </div>
      <h3 className="text-sm font-medium text-solus-text-dim">{title}</h3>
      {description && (
        <p className="text-xs text-solus-text-muted mt-1 max-w-xs">{description}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create StatusDot.tsx**

```tsx
// apps/desktop/src/renderer/components/shared/StatusDot.tsx
interface StatusDotProps {
  status: 'healthy' | 'warning' | 'error' | 'offline'
  label?: string
  pulse?: boolean
}

const colors = {
  healthy: 'bg-solus-success',
  warning: 'bg-solus-warning',
  error: 'bg-solus-error',
  offline: 'bg-solus-text-muted',
}

export function StatusDot({ status, label, pulse = false }: StatusDotProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${colors[status]} opacity-50 animate-ping`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${colors[status]}`} />
      </span>
      {label && <span className="text-xs text-solus-text-dim">{label}</span>}
    </span>
  )
}
```

- [ ] **Step 5: Create Card.tsx**

```tsx
// apps/desktop/src/renderer/components/shared/Card.tsx
interface CardProps {
  title?: string
  children: React.ReactNode
  className?: string
  compact?: boolean
}

export function Card({ title, children, className = '', compact = false }: CardProps) {
  return (
    <div className={`bg-solus-surface border border-solus-border rounded-lg ${compact ? 'p-3' : 'p-4'} ${className}`}>
      {title && (
        <h3 className="text-xs font-semibold text-solus-text-dim uppercase tracking-wider mb-3">
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 6: Create Modal.tsx**

```tsx
// apps/desktop/src/renderer/components/shared/Modal.tsx
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-solus-surface border border-solus-border rounded-lg shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-solus-border">
          <h2 className="text-sm font-semibold text-solus-text">{title}</h2>
          <button
            onClick={onClose}
            className="text-solus-text-muted hover:text-solus-text transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Create barrel export**

```tsx
// apps/desktop/src/renderer/components/shared/index.ts
export { LoadingSpinner } from './LoadingSpinner'
export { EmptyState } from './EmptyState'
export { StatusDot } from './StatusDot'
export { Card } from './Card'
export { Modal } from './Modal'
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/shared/
git commit -m "feat: add shared UI components (LoadingSpinner, EmptyState, StatusDot, Card, Modal)"
```

---

## Task 5: Backend main.py (Router Wiring)

**Files:**
- Modify: `apps/backend/src/main.py`

Rewrite main.py to wire all teammate routers with try/except so the app boots regardless of which teammates have merged.

- [ ] **Step 1: Rewrite main.py**

Replace the entire contents of `apps/backend/src/main.py` with:

```python
"""
Solus Backend — FastAPI entry point.
Wires all route files with try/except so the app boots even if
teammates haven't merged their routes yet.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import init_db

app = FastAPI(title="Solus", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    init_db()


# --- Route registration (try/except = boots before teammates merge) ---

try:
    from .routes_core import router as core_router
    app.include_router(core_router)
    print("[ok] routes_core loaded")
except ImportError:
    print("[warn] routes_core not yet available")

try:
    from .routes_livebench import router as livebench_router
    app.include_router(livebench_router)
    print("[ok] routes_livebench loaded")
except ImportError:
    print("[warn] routes_livebench not yet available")

try:
    from .routes_agent import router as agent_router
    app.include_router(agent_router)
    print("[ok] routes_agent loaded")
except ImportError:
    print("[warn] routes_agent not yet available")


@app.get("/api/health")
async def health():
    routers = []
    try:
        from . import routes_core
        routers.append("core")
    except ImportError:
        pass
    try:
        from . import routes_livebench
        routers.append("livebench")
    except ImportError:
        pass
    try:
        from . import routes_agent
        routers.append("agent")
    except ImportError:
        pass
    return {"status": "ok", "version": "0.1.0", "routers_loaded": routers}
```

- [ ] **Step 2: Verify the server boots**

Run: `cd apps/backend && python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 &`
Then: `curl http://localhost:8000/api/health`
Expected: `{"status":"ok","version":"0.1.0","routers_loaded":[]}` (empty routers until teammates merge)
Then kill the server.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/main.py
git commit -m "feat: wire main.py with try/except router imports + health check"
```

---

## Task 6: Seed Demo Script

**Files:**
- Create: `apps/backend/scripts/seed_demo.py`

Pre-populates the database with a realistic demo project so the graph has interesting data during presentations.

- [ ] **Step 1: Create the seed script**

```python
#!/usr/bin/env python3
"""
Seed demo data for Solus hackathon presentations.
Creates a "Differential Drive Robot" project with entities, relations,
source connections, issues, and fixes.

Usage: cd apps/backend && python scripts/seed_demo.py
"""

import sys
import os
import uuid
import json
from datetime import datetime, timedelta

# Allow running from apps/backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.database import get_connection, init_db


def uid() -> str:
    return str(uuid.uuid4())


def ts(days_ago: int = 0) -> str:
    return (datetime.utcnow() - timedelta(days=days_ago)).isoformat() + "Z"


def seed():
    init_db()
    conn = get_connection()
    now = ts()

    # --- Project ---
    project_id = uid()
    conn.execute(
        "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (project_id, "Differential Drive Robot", "Two-wheeled differential drive robot with motor control, sensors, and ROS2 navigation.", now, now),
    )

    # --- Team ---
    for name, role, email in [
        ("Pratham", "Lead Engineer", "pratham@solus.dev"),
        ("Alex", "Electrical Engineer", "alex@solus.dev"),
        ("Jordan", "Software Engineer", "jordan@solus.dev"),
        ("Sam", "Mechanical Engineer", "sam@solus.dev"),
    ]:
        conn.execute(
            "INSERT INTO team_members (id, project_id, name, role, email) VALUES (?, ?, ?, ?, ?)",
            (uid(), project_id, name, role, email),
        )

    # --- Source Connections ---
    kicad_src_id = uid()
    github_src_id = uid()
    conn.execute(
        "INSERT INTO source_connections (id, project_id, source_type, name, config, last_synced_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (kicad_src_id, project_id, "kicad", "Motor Controller PCB", json.dumps({"path": "/designs/motor_controller"}), ts(1), "synced"),
    )
    conn.execute(
        "INSERT INTO source_connections (id, project_id, source_type, name, config, last_synced_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (github_src_id, project_id, "github", "Robot Firmware Repo", json.dumps({"path": "/code/robot_firmware"}), ts(1), "synced"),
    )

    # --- Entities ---
    entities = {}

    entity_defs = [
        # Electrical parts
        ("ESP32", "ElectricalPart", "Main microcontroller — ESP32-WROOM-32", {"ref": "U1", "package": "QFN-48", "voltage": "3.3V"}),
        ("DRV8825", "ElectricalPart", "Stepper motor driver", {"ref": "U2", "package": "HTSSOP-28", "voltage": "8.2-45V"}),
        ("NEMA17", "ElectricalPart", "Stepper motor — NEMA 17 bipolar", {"ref": "M1", "rated_current": "1.7A", "step_angle": "1.8deg"}),
        ("MPU6050", "ElectricalPart", "6-axis IMU — accelerometer + gyroscope", {"ref": "U3", "interface": "I2C", "address": "0x68"}),
        ("VL53L0X", "ElectricalPart", "Time-of-flight distance sensor", {"ref": "U4", "interface": "I2C", "range": "2m"}),
        ("LM2596", "ElectricalPart", "Buck converter — 12V to 3.3V", {"ref": "U5", "input": "12V", "output": "3.3V"}),
        ("12V_Battery", "ElectricalPart", "3S LiPo battery pack", {"ref": "BT1", "voltage": "11.1V", "capacity": "5000mAh"}),
        # Software modules
        ("motor_controller.py", "SoftwareModule", "Motor control node — receives velocity commands, outputs step/dir signals", {"language": "python", "ros_node": "motor_controller"}),
        ("sensor_reader.py", "SoftwareModule", "Reads IMU + distance sensors via I2C", {"language": "python", "ros_node": "sensor_reader"}),
        ("nav_planner.py", "SoftwareModule", "Path planning and obstacle avoidance", {"language": "python", "ros_node": "nav_planner"}),
        ("teleop_twist.py", "SoftwareModule", "Keyboard teleoperation — publishes /cmd_vel", {"language": "python", "ros_node": "teleop_twist"}),
        ("robot_description.urdf", "SoftwareModule", "URDF model of the robot chassis and wheels", {"language": "xml", "type": "urdf"}),
        # Interfaces
        ("I2C_Bus", "Interface", "I2C bus connecting ESP32 to IMU and distance sensor", {"protocol": "I2C", "speed": "400kHz"}),
        ("/cmd_vel", "Interface", "ROS topic — geometry_msgs/Twist velocity commands", {"type": "ros_topic", "msg_type": "geometry_msgs/Twist"}),
        ("/odom", "Interface", "ROS topic — nav_msgs/Odometry from wheel encoders", {"type": "ros_topic", "msg_type": "nav_msgs/Odometry"}),
        ("/imu/data", "Interface", "ROS topic — sensor_msgs/Imu from MPU6050", {"type": "ros_topic", "msg_type": "sensor_msgs/Imu"}),
        ("/scan", "Interface", "ROS topic — sensor_msgs/Range from VL53L0X", {"type": "ros_topic", "msg_type": "sensor_msgs/Range"}),
        # Runtime signals
        ("motor_rpm", "RuntimeSignal", "Motor RPM from encoder feedback", {"unit": "rpm", "expected_range": [0, 200]}),
        ("battery_voltage", "RuntimeSignal", "Battery voltage reading", {"unit": "V", "expected_range": [9.0, 12.6]}),
        ("imu_temperature", "RuntimeSignal", "IMU die temperature", {"unit": "C", "expected_range": [15, 60]}),
    ]

    for name, etype, desc, meta in entity_defs:
        eid = uid()
        entities[name] = eid
        conn.execute(
            "INSERT INTO entities (id, project_id, entity_type, name, description, metadata, source, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (eid, project_id, etype, name, desc, json.dumps(meta), "kicad" if etype == "ElectricalPart" else "github", "", now, now),
        )

    # --- Relations ---
    relation_defs = [
        # Power chain
        ("12V_Battery", "LM2596", "connected_to", "Battery powers buck converter"),
        ("LM2596", "ESP32", "connected_to", "Buck converter powers ESP32 at 3.3V"),
        ("12V_Battery", "DRV8825", "connected_to", "Battery powers motor driver directly"),
        ("DRV8825", "NEMA17", "drives", "Motor driver controls stepper motor"),
        # I2C bus
        ("ESP32", "I2C_Bus", "connected_to", "ESP32 is I2C master"),
        ("MPU6050", "I2C_Bus", "connected_to", "IMU on I2C bus"),
        ("VL53L0X", "I2C_Bus", "connected_to", "Distance sensor on I2C bus"),
        # Software → hardware
        ("motor_controller.py", "DRV8825", "configured_by", "Motor controller configures driver step/dir pins"),
        ("motor_controller.py", "ESP32", "depends_on", "Motor controller runs on ESP32"),
        ("sensor_reader.py", "MPU6050", "reads_from", "Sensor reader reads IMU data"),
        ("sensor_reader.py", "VL53L0X", "reads_from", "Sensor reader reads distance data"),
        # ROS topic graph
        ("teleop_twist.py", "/cmd_vel", "publishes", "Teleop publishes velocity commands"),
        ("motor_controller.py", "/cmd_vel", "subscribes_to", "Motor controller receives velocity commands"),
        ("motor_controller.py", "/odom", "publishes", "Motor controller publishes odometry"),
        ("sensor_reader.py", "/imu/data", "publishes", "Sensor reader publishes IMU data"),
        ("sensor_reader.py", "/scan", "publishes", "Sensor reader publishes range data"),
        ("nav_planner.py", "/odom", "subscribes_to", "Nav planner uses odometry"),
        ("nav_planner.py", "/scan", "subscribes_to", "Nav planner uses distance data"),
        ("nav_planner.py", "/cmd_vel", "publishes", "Nav planner outputs velocity"),
        ("nav_planner.py", "/imu/data", "subscribes_to", "Nav planner uses IMU for orientation"),
        # Runtime signals
        ("NEMA17", "motor_rpm", "observed_in", "Motor RPM signal from NEMA17"),
        ("12V_Battery", "battery_voltage", "observed_in", "Battery voltage signal"),
        ("MPU6050", "imu_temperature", "observed_in", "IMU temperature signal"),
        # URDF
        ("robot_description.urdf", "NEMA17", "documented_by", "URDF describes motor placement"),
    ]

    for src_name, tgt_name, rel_type, desc in relation_defs:
        src_id = entities.get(src_name)
        tgt_id = entities.get(tgt_name)
        if src_id and tgt_id:
            conn.execute(
                "INSERT INTO relations (id, project_id, source_entity_id, target_entity_id, relation_type, metadata, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (uid(), project_id, src_id, tgt_id, rel_type, json.dumps({"description": desc}), 1.0, now),
            )

    # --- Issues + Fixes (for Demo C — Team Memory) ---
    issue1_id = uid()
    conn.execute(
        "INSERT INTO issues (id, project_id, title, description, status, related_entity_ids, reported_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (issue1_id, project_id, "Motor stalls at low RPM",
         "NEMA17 stalls when commanded below 15 RPM. DRV8825 gets hot. Happens after 10 minutes of continuous operation. Checked wiring — no shorts. Current limit pot seems correctly set.",
         "resolved", json.dumps([entities["NEMA17"], entities["DRV8825"]]), "Alex", ts(5), ts(3)),
    )
    conn.execute(
        "INSERT INTO fixes (id, issue_id, project_id, description, steps, applied_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (uid(), issue1_id, project_id,
         "Reduced microstepping from 1/32 to 1/8 and increased current limit to 1.2A. Motor no longer stalls at low RPM.",
         json.dumps(["Set DRV8825 MS1=1, MS2=0, MS3=0 for 1/8 microstepping", "Adjusted current limit potentiometer to 0.6V (= 1.2A)", "Verified motor runs smoothly from 5-200 RPM"]),
         "Alex", ts(3)),
    )

    issue2_id = uid()
    conn.execute(
        "INSERT INTO issues (id, project_id, title, description, status, related_entity_ids, reported_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (issue2_id, project_id, "IMU readings drift after 5 minutes",
         "MPU6050 gyroscope Z-axis drifts by ~2 degrees per minute. Accelerometer seems fine. Tried recalibrating at startup but drift returns. Board temperature rises to 45C during operation.",
         "resolved", json.dumps([entities["MPU6050"], entities["sensor_reader.py"]]), "Jordan", ts(7), ts(4)),
    )
    conn.execute(
        "INSERT INTO fixes (id, issue_id, project_id, description, steps, applied_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (uid(), issue2_id, project_id,
         "Added complementary filter combining accel + gyro data. Also added temperature compensation offset calibrated at 25C and 45C.",
         json.dumps(["Implemented complementary filter (alpha=0.98) in sensor_reader.py", "Added temperature compensation: offset = (temp - 25) * 0.07 deg/s", "Tested for 30 minutes — drift reduced to < 0.1 deg/min"]),
         "Jordan", ts(4)),
    )

    issue3_id = uid()
    conn.execute(
        "INSERT INTO issues (id, project_id, title, description, status, related_entity_ids, reported_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (issue3_id, project_id, "ESP32 brownout on motor startup",
         "ESP32 resets when both motors start simultaneously. Serial monitor shows 'brownout detector was triggered'. Running from bench supply at 12V.",
         "open", json.dumps([entities["ESP32"], entities["LM2596"], entities["DRV8825"]]), "Sam", ts(1), ts(1)),
    )

    # --- Semantic Memory entries (for Demo C search) ---
    for content, ctype in [
        ("Motor stalls at low RPM due to incorrect microstepping. Fix: reduce to 1/8 step and increase current limit.", "issue_summary"),
        ("IMU gyroscope drift caused by temperature changes. Fix: complementary filter + temperature compensation offset.", "issue_summary"),
        ("ESP32 brownout when motors start — suspect inrush current exceeds LM2596 capacity.", "issue_summary"),
        ("DRV8825 current limit formula: Vref = current_limit * 5 * Rsense. With Rsense=0.1ohm, Vref = current * 0.5", "reference_note"),
        ("NEMA17 rated current is 1.7A but optimal holding torque at 1.2A with 1/8 microstepping for our gearing.", "reference_note"),
    ]:
        conn.execute(
            "INSERT INTO semantic_memory (id, project_id, content, content_type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (uid(), project_id, content, ctype, "{}", now),
        )

    conn.commit()
    conn.close()
    print(f"Seeded demo data for project '{project_id}'")
    print(f"  - {len(entity_defs)} entities")
    print(f"  - {len(relation_defs)} relations")
    print(f"  - 3 issues (2 resolved, 1 open)")
    print(f"  - 5 semantic memory entries")


if __name__ == "__main__":
    seed()
```

- [ ] **Step 2: Verify the seed script runs**

Run: `cd apps/backend && python scripts/seed_demo.py`
Expected: Output showing seeded entities, relations, issues.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/scripts/seed_demo.py
git commit -m "feat: add seed_demo.py with demo project data"
```

---

## Task 7: App.tsx Update (Depends on Task 1)

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`

Add project initialization — on mount, fetch projects and auto-select the first one. The tab placeholders stay for now (teammates replace them when they merge).

- [ ] **Step 1: Update App.tsx to use the store**

Replace the entire contents of `apps/desktop/src/renderer/App.tsx` with:

```tsx
// apps/desktop/src/renderer/App.tsx
import { useState, useEffect } from 'react'
import { Boxes, Network, Search, Activity, Cpu } from 'lucide-react'
import { useProjectStore } from './stores/projectStore'
import { LoadingSpinner } from './components/shared/LoadingSpinner'

// Placeholders — teammates replace these when they merge
const WorkspaceTab = () => (
  <div className="p-8 text-solus-text-dim">Workspace — not built yet</div>
)
const ContextModelTab = () => (
  <div className="p-8 text-solus-text-dim">Context Model — not built yet</div>
)
const AgentTab = () => (
  <div className="p-8 text-solus-text-dim">Agent — not built yet</div>
)
const LiveBenchTab = () => (
  <div className="p-8 text-solus-text-dim">Live Bench — not built yet</div>
)
const SimulatorTab = () => (
  <div className="p-8 text-solus-text-dim">Simulator — not built yet</div>
)

const TABS = [
  { id: 'workspace', label: 'Workspace', icon: Boxes, component: WorkspaceTab },
  { id: 'context', label: 'Context', icon: Network, component: ContextModelTab },
  { id: 'agent', label: 'Agent', icon: Search, component: AgentTab },
  { id: 'live-bench', label: 'Live Bench', icon: Activity, component: LiveBenchTab },
  { id: 'simulator', label: 'Simulator', icon: Cpu, component: SimulatorTab },
] as const

export default function App() {
  const [activeTab, setActiveTab] = useState('workspace')
  const { projects, currentProjectId, fetchProjects, setCurrentProject, loading, error, clearError } = useProjectStore()

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (projects.length > 0 && !currentProjectId) {
      setCurrentProject(projects[0].id)
    }
  }, [projects, currentProjectId, setCurrentProject])

  const ActiveComponent =
    TABS.find((t) => t.id === activeTab)?.component || WorkspaceTab

  return (
    <div className="h-screen flex flex-col bg-solus-bg font-sans">
      {/* Title bar */}
      <div className="h-8 bg-solus-surface flex items-center justify-between px-4 border-b border-solus-border [-webkit-app-region:drag]">
        <span className="text-xs font-mono text-solus-accent font-semibold tracking-wider">
          SOLUS
        </span>
        <div className="flex items-center gap-3 [-webkit-app-region:no-drag]">
          {loading.projects && <LoadingSpinner size="sm" />}
          {currentProjectId && (
            <span className="text-xs text-solus-text-dim font-mono">
              {projects.find((p) => p.id === currentProjectId)?.name || ''}
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-solus-error/10 border-b border-solus-error/30 px-4 py-1.5 flex items-center justify-between">
          <span className="text-xs text-solus-error">{error}</span>
          <button onClick={clearError} className="text-xs text-solus-error hover:underline cursor-pointer">
            dismiss
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-14 bg-solus-surface border-r border-solus-border flex flex-col items-center py-3 gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all cursor-pointer
                  ${
                    isActive
                      ? 'bg-solus-accent/20 text-solus-accent-bright'
                      : 'text-solus-text-muted hover:text-solus-text-dim hover:bg-solus-elevated'
                  }`}
                title={tab.label}
              >
                <Icon size={20} />
              </button>
            )
          })}
        </nav>

        {/* Main content area */}
        <main className="flex-1 overflow-auto">
          <ActiveComponent />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No type errors (or only path alias errors that Vite resolves at runtime).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx
git commit -m "feat: wire App.tsx to Zustand store with project auto-select and error banner"
```

---

## File Ownership Reminder

Teammate 3 ONLY touches these files:
- `apps/backend/src/main.py`
- `apps/desktop/src/renderer/stores/projectStore.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/components/shared/*`
- `apps/desktop/src/renderer/hooks/*`
- `apps/backend/scripts/seed_demo.py`

Do NOT touch: `context_engine.py`, any connectors, `live_bench.py`, `solus_agent.py`, `memory_store.py`, `mujoco_wrapper.py`, any routes file, any teammate tab component, `database.py`, or `models.py`.
