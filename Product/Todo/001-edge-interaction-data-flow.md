# Feature: Edge Interaction & Data Flow Visualization

> Status: **spec** | Priority: **high** | Demo: A, B
> Owner: unassigned

## Problem

The Context Model graph currently lets users click **nodes** to see details and run impact analysis, but the **edges** (connections between nodes) are inert gray lines with no interactivity. This means:

- Users can't see *what* a connection represents (drives? publishes? subscribes_to?)
- Users can't inspect the data flowing between two components
- The rich edge semantics in the data model (`publishes`, `subscribes_to`, `drives`, `reads_from`, `configured_by`, etc.) are invisible
- For a robotics team, understanding the *connections* is often more important than the nodes themselves — "what data does this node publish?" and "who subscribes to /cmd_vel?"

## User Story

> As a robotics engineer viewing the Context Model graph, I want to click on a connection between two nodes and see:
> 1. What the relationship is (e.g., `publishes`, `drives`, `subscribes_to`)
> 2. The source and target nodes with their types
> 3. Any metadata about the connection (topic name, data type, signal frequency)
> 4. For pub/sub edges: an animated visualization of data flow direction
>
> So that I can understand how data moves through my robot system without manually tracing ROS topics and wires.

## Design

### 1. Edge Click → Detail Panel

When a user clicks an edge in the D3 graph:

- The right-side detail panel switches from node details to **edge details**
- The clicked edge highlights (brighter color, thicker stroke)
- Connected source + target nodes get a subtle highlight ring

**Edge detail panel shows:**

```
┌─────────────────────────┐
│  motor_controller.py    │
│  ──── subscribes_to ──▶ │
│  /cmd_vel               │
├─────────────────────────┤
│  Relation type           │
│  subscribes_to           │
│                          │
│  Description             │
│  Motor controller        │
│  receives velocity       │
│  commands                │
│                          │
│  Source                   │
│  ● motor_controller.py   │
│    software module        │
│                          │
│  Target                   │
│  ◆ /cmd_vel              │
│    interface              │
│                          │
│  Metadata                 │
│  ┌────────┬────────────┐ │
│  │msg_type│Twist       │ │
│  │freq_hz │50          │ │
│  └────────┴────────────┘ │
│                          │
│  [View Source Node]       │
│  [View Target Node]       │
│  [Trace Full Path →]      │
└─────────────────────────┘
```

### 2. Edge Visual Styling by Type

Edges should be visually distinguishable by relation type:

| Relation Type | Stroke Style | Color | Semantics |
|---|---|---|---|
| `publishes` | solid + animated dots | `#60a5fa` (blue) | Data flows from source to target |
| `subscribes_to` | solid + animated dots | `#60a5fa` (blue) | Data flows from target to source |
| `drives` | solid thick | `#fb923c` (orange) | Physical actuation |
| `reads_from` | dashed | `#4ade80` (green) | Sensor data |
| `depends_on` | solid thin | `#94a3b8` (gray) | Code dependency |
| `connected_to` | dotted | `#94a3b8` (gray) | Physical wiring |
| `configured_by` | dashed thin | `#c084fc` (purple) | Config relationship |
| `impacts` | solid | `#ef4444` (red) | Change impact |
| other | solid thin | `#525252` (dim gray) | Generic |

### 3. Animated Data Flow (stretch goal)

For `publishes` / `subscribes_to` edges, small animated dots travel along the edge in the direction of data flow. This makes the ROS topic graph *alive* — you can literally see data moving through the system.

- Dots move from publisher → topic → subscriber
- Speed can reflect actual telemetry frequency when Live Bench is active
- Animation pauses when the system is idle

### 4. Edge Hover Preview

Before clicking, hovering over an edge shows a lightweight tooltip:

```
┌──────────────────────────┐
│  subscribes_to           │
│  motor_controller.py → /cmd_vel │
└──────────────────────────┘
```

### 5. Hit Target Improvement

Edges are thin lines that are hard to click. Solutions:
- Render an invisible wider stroke (12px) behind each visible edge for hit detection
- Change cursor to `pointer` on hover
- Highlight the edge on hover before click

## Implementation

### Frontend Changes (`ContextModelTab.tsx`)

1. **New state:** `selectedEdge: GraphRelation | null` (alongside existing `selectedNode`)
2. **Edge click handler:** `.on("click", (_event, d) => { setSelectedEdge(d); setSelectedNode(null); })`
3. **Edge hover handlers:** `.on("mouseenter", ...)` / `.on("mouseleave", ...)` for hover preview + highlight
4. **Hit area:** Duplicate each `<line>` with a transparent wider stroke for click targeting
5. **Detail panel:** Conditional render — show edge details when `selectedEdge` is set, node details when `selectedNode` is set
6. **Edge coloring:** Map `relation_type` to stroke color/style using a `RELATION_COLORS` constant
7. **Animated dots (stretch):** SVG `<circle>` elements with `<animateMotion>` along each pub/sub edge path

### Backend Changes

**Optional but valuable:** Add a `description` field to the `relations` table so edges can carry human-readable context (e.g., "Motor controller receives velocity commands"). The seed data already has descriptions — they just need to be stored.

If the `relations` table already stores `relation_type`, no schema change is needed for the basic feature. The edge detail panel can derive display info from the existing `relation_type` + the source/target entity data.

### Data Model (already exists)

The `GraphRelation` interface already has everything needed:

```typescript
interface GraphRelation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
}
```

Extend with optional fields if backend supports it:

```typescript
interface GraphRelation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
```

## Acceptance Criteria

- [ ] Clicking an edge in the graph opens the edge detail panel showing relation type, source node, target node
- [ ] Hovering an edge highlights it and shows a tooltip with relation type + endpoint names
- [ ] Edges are color-coded by relation type with a legend entry
- [ ] Edge click and node click are mutually exclusive (selecting one deselects the other)
- [ ] Edge hit targets are wide enough to click comfortably (invisible 12px hit area)
- [ ] "View Source Node" / "View Target Node" buttons in edge panel switch to that node's detail
- [ ] (Stretch) Animated dots on pub/sub edges show data flow direction

## Open Questions

1. Should edge descriptions come from the backend (stored per-relation) or be generated client-side from relation_type + node names?
2. Should "Trace Full Path" button exist? (Highlight all edges in a chain: e.g., teleop → /cmd_vel → motor_controller → DRV8825 → NEMA17)
3. When Live Bench is active, should edge animations reflect actual telemetry frequency?

#todo #graph #visualization #edges #data-flow
