# Feature Todo

> Part of [[Product]]

Features to build for the Context Model graph and broader Solus experience. Ordered by priority within tiers.

## Priority Tiers

### Tier 1 — High Impact, Hackathon Demo

These directly improve the demo "wow factor" and are feasible within the hackathon timeline.

| # | Feature | Status | Demos | Spec |
|---|---------|--------|-------|------|
| 001 | [[001-edge-interaction-data-flow\|Edge Interaction & Data Flow]] | **spec** | A, B | Click edges to see relation type, source/target, data flow direction |
| 008 | [[008-edge-labels-on-graph\|Edge Labels on Graph]] | idea | A | Show relation types directly on edges (toggleable) |
| 010 | [[010-ros-topic-view\|ROS Topic Graph View]] | idea | A, B | Dedicated pub/sub view: publishers → topics → subscribers |

### Tier 2 — Medium Impact, Strong Polish

These make the graph genuinely useful for real robotics work. Good for post-hackathon or if time allows.

| # | Feature | Status | Demos | Spec |
|---|---------|--------|-------|------|
| 002 | [[002-graph-search-filter\|Graph Search & Filter]] | idea | A, B, E | Search nodes by name, filter by entity/relation type |
| 003 | [[003-node-neighborhood-view\|Node Neighborhood View]] | idea | A | Double-click to isolate a node's local subgraph |
| 004 | [[004-path-tracing\|Path Tracing]] | idea | A, E | Select two nodes → see all paths between them highlighted |
| 005 | [[005-live-graph-updates\|Live Graph Updates]] | idea | A, B | Real-time node pulse + edge glow from telemetry/sync |

### Tier 3 — Nice to Have

Polish features that make the tool feel professional but aren't critical for the demo.

| # | Feature | Status | Demos | Spec |
|---|---------|--------|-------|------|
| 006 | [[006-graph-minimap\|Graph Minimap]] | idea | A | Overview inset showing viewport position in full graph |
| 007 | [[007-graph-layout-modes\|Graph Layout Modes]] | idea | A | Switch between force-directed, hierarchical, radial layouts |
| 009 | [[009-keyboard-shortcuts\|Keyboard Shortcuts]] | idea | all | Power-user keyboard navigation for the graph |

### Bonus — "Wait, It Can Do That?"

The feature that wins the hackathon. Goes beyond analysis into **design generation**.

| # | Feature | Status | Demos | Spec |
|---|---------|--------|-------|------|
| 011 | [[011-generative-design\|Generative Design]] | idea | D, E | Describe a goal → get scored design proposals with cascading changes, wiring, code deltas, and one-click apply |

## Status Key

- **idea** — Concept captured, no detailed design yet
- **spec** — Full spec written with design, implementation plan, acceptance criteria
- **in-progress** — Someone is building it
- **done** — Shipped and working
- **cut** — Descoped from hackathon

## Build Order Recommendation

```
001 (Edge Interaction)  ←── foundation: makes edges interactive
  └──▶ 008 (Edge Labels)  ←── builds on edge styling from 001
  └──▶ 010 (ROS Topic View)  ←── builds on edge type filtering from 001
        └──▶ 005 (Live Graph Updates)  ←── animates what 010 shows

002 (Search & Filter)  ←── independent, can start anytime
003 (Neighborhood View)  ←── independent, can start anytime
004 (Path Tracing)  ←── needs backend endpoint, otherwise independent

011 (Generative Design)  ←── builds on Demo D (agent) + Demo A (impact analysis)
  └──▶ needs: agent/generate-design endpoint + ProposalCard component
  └──▶ stretch: graph diff view + MuJoCo simulation per proposal
```

#todo #features #graph #roadmap
