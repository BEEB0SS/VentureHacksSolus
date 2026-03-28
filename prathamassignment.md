# YOUR Assignment: Foundation + Demo A (Change Propagation)

**Branch:** `feature/core-change-propagation`

You are the lead. You build the foundation that everyone else depends on,
PLUS Demo A end-to-end.

---

## Demo A Recap

1. User creates a project, connects a KiCad source (or GitHub repo)
2. Syncs it → entities and relations appear in the Context Model graph
3. User makes a change (e.g., swaps a motor driver chip in KiCad)
4. Re-syncs → system detects the change via snapshot diff
5. Impact analysis highlights which software modules / runtime signals break
6. AI explains HOW they're affected (this part calls Teammate 2's agent)

---

## Files You Own

### Backend
- `apps/backend/src/context_engine.py` — the graph engine (CRUD, diff, impact analysis)
- `apps/backend/src/connectors/github_connector.py` — parse git repos
- `apps/backend/src/connectors/kicad_connector.py` — parse PCB schematics
- `apps/backend/src/connectors/onshape_connector.py` — stub
- `apps/backend/src/routes_core.py` — YOUR API routes (see below)

### Frontend
- `apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx`
- `apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx`

---

## Backend: What to Build

### context_engine.py — ContextEngine class

Entity CRUD, Relation CRUD, plus:

**Snapshot + Diff** (the change detection mechanism):
- `create_snapshot(source_connection_id, project_id, data)` → saves normalized state
- `get_latest_snapshot(source_connection_id)` → gets previous state
- `compute_diff(old_data, new_data)` → returns [{type: "added"|"modified"|"removed", ref, changed_fields}]

**Impact Analysis** (the "what breaks" engine):
- `analyze_impact(entity_id, project_id, max_hops=2)` → BFS through graph, returns impacted entities with paths

**Subgraph Retrieval** (context for AI agent):
- `get_subgraph(project_id, center_entity_id=None, radius=2)` → {entities, relations}

### connectors/github_connector.py

Walk a local repo, find robotics files (.py, .cpp, .ino, .launch, .urdf, .yaml, .msg, .srv),
classify into EntityTypes, detect ROS packages, build relations.

### connectors/kicad_connector.py — CRITICAL FOR DEMO A

Parse `.kicad_sch`: extract components (U1, R1, C3...), values, footprints.
Parse `.kicad_pcb`: footprint positions.
Extract nets → CONNECTED_TO relations.
Classify by ref prefix: U=IC, R=resistor, C=capacitor, M=motor.

### routes_core.py — Your API Routes

Use `APIRouter(prefix="/api")`:

```python
POST /api/projects
GET  /api/projects
GET  /api/projects/{id}
POST /api/projects/{id}/team
GET  /api/projects/{id}/team
POST /api/projects/{id}/sources
GET  /api/projects/{id}/sources
POST /api/projects/{id}/sources/{sid}/sync   ← triggers connector, creates snapshot, diffs, logs changes
POST /api/projects/{id}/entities
GET  /api/projects/{id}/entities
POST /api/projects/{id}/relations
GET  /api/projects/{id}/graph
GET  /api/projects/{id}/changes
GET  /api/projects/{id}/impact/{entity_id}
```

The `/sync` route is the most complex — it:
1. Runs the appropriate connector (GitHub or KiCad based on source_type)
2. Creates entities + relations from connector output
3. Creates a new snapshot
4. Diffs against previous snapshot
5. Logs change events with impacted entity IDs
6. Returns {changes_detected, entities_created, changes: [...]}

---

## Frontend: What to Build

### WorkspaceTab.tsx

- Project selector + "New Project" button
- Sources panel with sync buttons
- Recent changes timeline
- Team members

### ContextModelTab.tsx — THE visual centerpiece of Demo A

- D3 force-directed graph
- Nodes colored by type (blue=software, green=electrical, orange=mechanical, purple=interface)
- Click node → detail panel on right
- **"Impact Analysis" button** → calls `/impact/{entity_id}` → impacted nodes pulse red
- Fetch from `/graph`

---

## Claude Code Prompt

```
Read PRODUCT_CONTEXT.md first, then packages/shared-types/src/models.py and
apps/backend/src/database.py.

I'm building the foundation + Demo A (Change Propagation). Read my full spec at
team-briefs/YOU_LEAD_DEMO_A.md.

Build in this order:
1. apps/backend/src/context_engine.py (the graph engine)
2. apps/backend/src/connectors/kicad_connector.py (parse PCB files)
3. apps/backend/src/connectors/github_connector.py (parse repos)
4. apps/backend/src/routes_core.py (API routes using APIRouter)
5. apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx
6. apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx

For the route file, use FastAPI APIRouter(prefix="/api") so it can be included
in main.py without conflicts with other teammates' route files.
```