# agent-ui Branch Summary

**Branch:** `origin/agent-ui`
**Commits ahead of main:** 2
**Net change:** +1,203 lines added, −14,559 lines removed (major cleanup + redesign)

## Overview

The `agent-ui` branch is a **UI redesign + codebase cleanup** pass. It strips out unmerged feature branches' artifacts (plans, specs, test fixtures, unused modules) and redesigns the frontend tabs with a cohesive dark developer-tool aesthetic using inline styles instead of Tailwind classes.

---

## Architecture Changes

### 1. Frontend — Complete UI Redesign

All tab components are rewritten with a consistent visual language:

**Design system:**
- **Inline styles throughout** — moves away from Tailwind utility classes to inline `style={{}}` objects. The `globals.css` retains `solus-*` tokens but tabs don't use them.
- **Color palette:** `#07070f` (deepest bg), `#0d0d18` (panels), `#1e1e2e` (borders), `#c9cfd6` (text). Accent colors per feature: indigo (general), amber (debug), cyan (parts), green (values), red (impact), purple (plan).
- **Typography:** JetBrains Mono everywhere (monospace-first aesthetic). Label system uses 8px uppercase tracking for section headers.
- **Animations:** CSS keyframes for `scanbar`, `pulse`, `fadein` effects.

**AgentTab.tsx (398 lines → complete rewrite):**
- **Three-panel layout:** Left sidebar (mode selector + query history) | Center workspace (query + response) | Right memory panel
- **Mode selector:** Left sidebar with 6 modes (General, Debug, Find Parts, Extract Values, Impact Analysis, Plan), each with a color, keyboard shortcut, description, and example query
- **Query history:** Left sidebar list showing past queries with mode color dots, confidence badges, and timestamps
- **Workspace pattern:** Clicking a history item loads it into the center workspace. New queries auto-select. Empty state shows mode description + example button.
- **Response rendering:** Delegated to `ResponseDocument` component (exported from MessageBubble.tsx)
- **Entity picker:** Dropdown for impact_analysis mode, same as our implementation

**MessageBubble.tsx (renamed to ResponseDocument pattern):**
- No longer a chat bubble — redesigned as a **document-style response viewer**
- Sections: RESPONSE (main text), CONFIDENCE (bar + percentage), SOURCES (tagged pills), EVIDENCE (expandable memory hits), IMPACT (entity cards with per-component explanations)
- New `ImpactExplanation` interface: `{ name, entity_type, how_affected, action }` — structured per-component impact data
- Memory hits displayed as cards with content-type color coding (issue=red, fix=green, note=indigo, datasheet=cyan, paper=purple)

**MemoryPanel.tsx (simplified):**
- Same search functionality but styled to match the new inline-style system
- Simpler result cards without the metadata tag badges

**WorkspaceTab.tsx (347 lines → rewrite):**
- Inline styles matching the new aesthetic
- Source type color coding (github=indigo, kicad=green, onshape=cyan, pdf=purple, manual=amber, runtime=red)
- Change events with colored symbols (+/~/−) and date grouping (TODAY, YESTERDAY, etc.)
- Same functionality (project selector, sources, sync, changes) with polished presentation

**ContextModelTab.tsx (777 lines → expanded):**
- **AI-powered impact analysis panel** — when impact analysis runs, the side panel shows:
  - AI summary of the impact (from agent query)
  - Per-component explanation cards with "Impact" and "Action" sections
  - Each card colored by entity type
- Calls the agent's `impact_analysis` query type after running graph BFS
- Source node tracking (`sourceNodeId` state) to show which node triggered the analysis
- Graph still uses D3 force-directed layout but with the inline style aesthetic

**SimulatorTab.tsx (648 lines → streamlined):**
- Removed `MuJoCoViewer.tsx` and `ModelSourceBar.tsx` components (3D viewer removed)
- Now a pure parameter editor + trajectory chart + discrepancy table
- Uses Recharts for trajectory visualization
- Uses shared components (Card, LoadingSpinner, EmptyState) + Zustand store
- Cleaner than the original — focused on Demo E flow

**globals.css:**
- Same `solus-*` theme tokens retained
- Removed ~70 lines of extra CSS that was added for the MuJoCo viewer and other features

### 2. Backend — Cleanup + Minor Fixes

**Removed modules (were never merged to main properly):**
- `src/analyzers/` — Python AST analyzer, KiCad netlist analyzer, config file analyzer (auto-relation discovery)
- `src/discovery_engine.py` + `src/routes_discovery.py` — relation discovery routes
- `src/connectors/component_search.py` — DigiKey component search
- `src/simulator/ai_tuner.py` + `src/simulator/pid_optimizer.py` — AI simulation tuning
- All corresponding test files

**Modified:**
- `solus_agent.py` — Gemini model fallback chain (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite`). Cleaner error handling on init.
- `routes_agent.py` — Simplified, removed discovery and optimization routes
- `main.py` — Removed try/except blocks for discovery and optimization routers
- `requirements.txt` — Minor dependency changes
- `seed_demo.py` — 3 lines added (minor data fix)

**Removed artifacts:**
- `apps/backend/assets/models/` — MuJoCo XML model and viewer script
- `apps/backend/.gitignore`
- All `docs/superpowers/plans/` and `docs/superpowers/specs/` files
- All `Product/Todo/` feature specs
- `docs/potential-features.md`
- `Assets/robot-reference/`

### 3. Shared Types

**`packages/shared_types/src/models.py`:**
- ~39 lines changed — likely minor field adjustments or cleanup

---

## Key Architectural Decisions

1. **Inline styles over Tailwind:** The branch moves all tab components to inline `style={{}}` objects. This gives pixel-level control but loses Tailwind's utility-class composability and responsive design.

2. **Three-panel Agent layout:** The Agent tab becomes a mini-IDE: mode selector (left) + workspace (center) + memory (right). Queries are browseable via history, not a scrolling chat.

3. **ResponseDocument over chat bubbles:** Agent responses are rendered as structured documents with labeled sections, not chat messages. Better for technical content but loses the conversational feel.

4. **AI-enhanced impact analysis:** The Context tab now calls the agent after BFS impact analysis to get natural-language explanations for each impacted component. Two API calls per analysis (graph BFS + agent query).

5. **Feature pruning:** Aggressively removes unmerged feature code (auto-relation discovery, DigiKey search, PID optimizer, MuJoCo viewer). The branch represents a "ship the core" philosophy.

---

## What's Different From Main

| Aspect | Main | agent-ui |
|--------|------|----------|
| Styling | Mix of Tailwind (neutral-*) + solus-* tokens | Inline styles, monospace-first |
| Agent tab | Chat interface with suggestion chips | Three-panel IDE with mode selector + history |
| Impact analysis | BFS → red nodes | BFS → red nodes + AI explanation panel |
| SimulatorTab | Parameter editor + charts + MuJoCo viewer | Parameter editor + charts only |
| Backend modules | All feature branches merged | Stripped to core only |
| Docs/specs/plans | All present | All removed |
| MuJoCo model | Present | Removed |

---

## Merge Considerations

If merging to main:
- **Conflicts expected** in every frontend component (complete rewrites)
- The doc/spec/plan deletions would remove planning artifacts that are still useful
- The backend module removals would undo work from other feature branches
- The AI impact analysis panel is a valuable addition that could be cherry-picked
- The Gemini model fallback chain is a good improvement to cherry-pick
