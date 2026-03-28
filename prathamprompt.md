# Pratham — Claude Code Prompt

Paste this entire block into Claude Code after running `claude` in the repo root.

---

Read these files in order before doing anything:
1. PRODUCT_CONTEXT.md — what Solus is and why we're building it
2. packages/shared_types/src/models.py — all data models (your contract)
3. apps/backend/src/database.py — SQLite schema
4. team-briefs/YOU_LEAD_DEMO_A.md — your full spec

I'm Pratham, building the foundation + Demo A (Change Propagation). My demo flow:
- User syncs a KiCad project → entities appear in a graph
- User changes a chip on the PCB → re-syncs
- System detects the change, shows impacted software modules
- AI explains what breaks and why

Build these files in this order:

1. apps/backend/src/context_engine.py
   - ContextEngine class: entity CRUD, relation CRUD, snapshot + diff, impact analysis (BFS through graph), subgraph retrieval, change event logging
   - Use only sqlite3 + standard library

2. apps/backend/src/connectors/kicad_connector.py
   - Parse .kicad_sch for components (ref designators, values, footprints)
   - Parse .kicad_pcb for footprint positions
   - Extract nets → CONNECTED_TO relations
   - Classify by ref prefix: U=IC, R=resistor, C=capacitor, M=motor

3. apps/backend/src/connectors/github_connector.py
   - Walk local repo, find robotics files (.py, .cpp, .ino, .launch, .urdf, .yaml, .msg, .srv)
   - Classify into EntityTypes, detect ROS packages, build relations

4. apps/backend/src/connectors/onshape_connector.py — stub with placeholder methods

5. apps/backend/src/routes_core.py
   - Use FastAPI APIRouter(prefix="/api")
   - Routes: projects CRUD, team, sources, sync, entities, relations, graph, changes, impact
   - The /sync route: runs connector → creates entities → snapshots → diffs → logs changes

6. apps/desktop/src/renderer/components/workspace/WorkspaceTab.tsx
   - Project selector, sources panel with sync buttons, recent changes timeline, team members

7. apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx
   - D3 force-directed graph, nodes colored by type, click for details
   - "Impact Analysis" button → impacted nodes pulse red

Do NOT touch: main.py, any live_bench files, any agent files, any memory files, any simulator files, the store, or App.tsx.