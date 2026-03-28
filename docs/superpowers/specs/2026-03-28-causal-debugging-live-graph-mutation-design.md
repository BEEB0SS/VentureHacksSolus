# Causal Debugging + Live Graph Mutation Visualization — Design Spec

**Date:** March 28, 2026
**Status:** Approved
**Scope:** 3 files changed, 1 new endpoint, 1 new engine method

## Goal

When a user selects an entity in the Context tab and clicks "Trace Cause", the system traces the causal chain backwards through the graph to find possible root causes, then animates the traversal hop by hop on the D3 graph with a ripple wave effect. Color gradient from red (symptom) to green (root cause). Ranked paths with confidence scores.

## Triggers

- **User-triggered (demo-ready):** User clicks a node → clicks "Trace Cause" button in side panel
- **Anomaly-triggered (future):** WebSocket anomaly event auto-selects the entity and fires the trace. Requires Live Bench backend (not yet built). Frontend stub only for now.

## Backend: Causal Trace Engine

### New method: `ContextEngine.causal_trace(entity_id, depth=4)`

Reverse BFS from a symptom entity toward possible root causes.

**Algorithm:**
1. Build a reverse adjacency map — flip the directed edges from `_build_adjacency(directed=True)`. Instead of "what does this impact?" → "what could have caused this?"
2. BFS backwards from the symptom, tracking the **full path** (list of hops) at each frontier node — not just visited/unvisited. A node can appear in multiple paths via different routes, but no single path visits the same node twice (cycle prevention per-path).
3. A path terminates when: it reaches depth limit, or hits a leaf node (no more reverse neighbors), or would revisit a node already in that path.
4. At each hop, compute confidence = product of relation-type weights along the path
5. Apply temporal boost: if a `change_event` exists for an entity in the path within the last 24 hours, multiply that hop's weight by 1.5x (capped at 1.0)
6. Collect all terminated paths, sort by confidence descending, return top 5

**Relation-type causal weights:**

| Relation Type | Weight | Reasoning |
|---------------|--------|-----------|
| configured_by | 0.9 | Strong causal — config directly affects behavior |
| depends_on | 0.85 | Code dependency — upstream change breaks downstream |
| drives | 0.85 | Physical causal — driver controls actuator |
| reads_from | 0.8 | Data dependency |
| subscribes_to | 0.8 | Message dependency |
| connected_to | 0.5 | Physical connection — weaker causal signal |
| publishes | 0.4 | Reverse direction is weaker |
| observed_in | 0.3 | Informational, weak causal |
| documented_by | 0.1 | Very weak |
| similar_to | 0.1 | Very weak |
| changed_by | 0.1 | Very weak |
| resolved_by | 0.1 | Very weak |
| impacts | 0.5 | Moderate |

**Temporal boost:** For each entity in a path, query `change_events` for that entity within the last 24 hours. If found, multiply the hop weight by 1.5 (capped at 1.0). Falls back gracefully when no change data exists.

**Reverse adjacency construction:**
- For `depends_on`, `reads_from`, `subscribes_to`: original direction is `src depends_on tgt`. In forward impact, changing tgt impacts src. In reverse causal, we want: from src, trace back to tgt. So reverse adjacency: `src → tgt`.
- For `drives`, `connected_to`, `configured_by`: forward impact is `src → tgt`. Reverse causal: `tgt → src`.
- For `publishes`: forward is `src → tgt`. Reverse causal: `tgt → src`.
- General rule: reverse the edges from `_build_adjacency(directed=True)`.

### New endpoint: `GET /api/projects/{project_id}/causal-trace/{entity_id}`

**Query params:** `depth` (int, default 4)

**Response:**
```json
{
  "source_entity": {
    "id": "...",
    "name": "motor_rpm",
    "entity_type": "runtime_signal"
  },
  "paths": [
    {
      "confidence": 0.72,
      "hops": [
        {
          "entity": { "id": "...", "name": "NEMA17", "entity_type": "electrical_part" },
          "relation_type": "drives",
          "hop_weight": 0.85,
          "temporal_boost": false
        },
        {
          "entity": { "id": "...", "name": "DRV8825", "entity_type": "electrical_part" },
          "relation_type": "drives",
          "hop_weight": 0.85,
          "temporal_boost": false
        }
      ]
    }
  ]
}
```

Paths are sorted by confidence descending. Maximum 5 paths returned.

## Frontend: Live Graph Mutation Visualization

### Context Tab Changes

**1. "Trace Cause" button**
- Purple (`bg-purple-600 hover:bg-purple-500`) button in the side panel, next to existing red "Analyze Impact" button
- Only visible when a node is selected
- Calls the causal-trace endpoint, then triggers the ripple animation

**2. Ripple animation engine**

A function `animateCausalChain(path, nodeSelection, linkSelection, labelSelection)` that:

```
Step 1 (t=0ms):     Source node pulses red. All other nodes dim to 20% opacity.
                     All edges dim to 10% opacity.
Step 2 (t=400ms):   First edge in path glows (orange stroke, animated stroke-dasharray).
                     Next node in chain fades in at orange.
Step 3 (t=800ms):   Second edge glows yellow. Next node fades in yellow.
Step N:              Continue per hop with 400ms delay.
Final hop:           Root cause node fades in green with a pulse animation.
Step N+300ms:        Non-path nodes restore to 40% opacity. Path stays vivid.
```

**Color interpolation:** Linear gradient from `#ef4444` (red, hop 0) through `#f59e0b` (orange), `#eab308` (yellow), to `#22c55e` (green, last hop). Use D3's `interpolateRgb` between red and green, sampled at `hopIndex / totalHops`.

**Edge animation:** Edges in the causal path get `stroke-dasharray: 6 4` with a CSS `@keyframes` animation that offsets the dash to create a flowing effect in the causal direction. Applied via a CSS class `.causal-edge-active`.

**Implementation:** Uses D3 `transition()` with `.delay(hopIndex * 400)` on the existing SVG selections. No re-rendering the graph. Manipulates `opacity`, `fill`, `stroke`, `stroke-width`, and CSS classes on existing elements.

**3. Causal chain summary panel**

Below the "Trace Cause" button in the side panel:
- Top path displayed as: `entity → entity → entity` with confidence percentage
- Each entity name colored according to its position in the gradient
- "Show N alternative paths" expandable link
- Clicking an alternative path re-runs the animation for that path

**4. State management**
- `causalPaths` state: the API response (null when no trace active)
- `activeCausalPath` state: index of the currently-animated path (default 0)
- Clicking "Trace Cause" clears any existing impact analysis highlights
- Clicking "Analyze Impact" clears any causal trace
- Selecting a different node clears the trace
- "Clear trace" button restores all nodes/edges to default

**5. Anomaly listener stub**

A commented-out `useWebSocket` hook that listens for anomaly events:
```tsx
// Future: when Live Bench is built, uncomment to enable auto-trace on anomaly
// const { connected } = useWebSocket(
//   `/ws/projects/${projectId}/live-bench`,
//   { onMessage: (data) => { if (data.type === 'anomaly') autoTrace(data.entity_id) } }
// )
```

## Files Changed

| File | Change | Lines (est.) |
|------|--------|-------------|
| `apps/backend/src/context_engine.py` | Add `causal_trace()`, `_build_reverse_adjacency()`, `_CAUSAL_WEIGHTS` | ~80 |
| `apps/backend/src/routes_core.py` | Add `GET /projects/{id}/causal-trace/{entity_id}` | ~15 |
| `apps/desktop/src/renderer/components/context-model/ContextModelTab.tsx` | Add button, animation engine, chain summary, state, anomaly stub | ~150 |

## What We're NOT Building

- No new tab or component
- No WebSocket server changes
- No Agent tab integration (future enhancement)
- No Zustand store changes
- No new test file (tests for causal_trace can be added to existing test_context_engine.py)

## Demo Script

1. Open Context tab — graph shows the Differential Drive Robot
2. Click on **motor_rpm** (runtime signal node)
3. Click **"Trace Cause"** (purple button)
4. Watch: motor_rpm pulses red → edge to NEMA17 glows orange → NEMA17 lights up → edge to DRV8825 glows yellow → DRV8825 lights up → edge to motor_controller.py glows green → root cause pulses green
5. Side panel shows: "motor_controller.py → DRV8825 → NEMA17 → motor_rpm (72% confidence)"
6. Click "Show 1 alternative path" → see the battery power chain as a lower-confidence alternative
7. Click the alternative → animation replays with the new path
