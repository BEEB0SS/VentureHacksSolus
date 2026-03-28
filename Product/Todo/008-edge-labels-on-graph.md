# Feature: Edge Labels on Graph

> Status: **idea** | Priority: **high** | Demo: A
> Owner: unassigned

## Problem

Even without clicking, users should be able to see what kind of relationship an edge represents at a glance. Currently all edges are identical gray lines — the only way to know what they mean is to click them (once Feature 001 is built).

## User Story

> As a robotics engineer, I want to see labels on the graph edges showing the relation type (e.g., "drives", "publishes", "subscribes_to"), so I can read the system architecture directly from the visual.

## Design

- Small text label at the midpoint of each edge, rotated to follow the edge angle
- Font: JetBrains Mono, 8px, `text-neutral-500`
- Labels show the relation type in human-readable form (e.g., "drives", "publishes")
- Toggle: "Show edge labels" checkbox (labels can be noisy on dense graphs)
- When zoomed out past a threshold, labels auto-hide to reduce clutter
- When an edge is hovered or selected, its label becomes brighter and larger

## Acceptance Criteria

- [ ] Edge labels displayed at edge midpoints showing relation type
- [ ] Labels rotate to follow edge angle
- [ ] Toggle to show/hide edge labels
- [ ] Labels auto-hide when zoomed out
- [ ] Labels emphasize on hover/selection

#todo #graph #labels #edges
