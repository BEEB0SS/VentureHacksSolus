# Feature: Node Neighborhood View

> Status: **idea** | Priority: **medium** | Demo: A
> Owner: unassigned

## Problem

When analyzing a specific component, the full graph is noisy. Users want to see "just this node and everything directly connected to it" — a 1-hop or 2-hop subgraph. The backend already has a `/impact/{entity_id}` endpoint that does BFS traversal, but there's no way to isolate a neighborhood visually.

## User Story

> As a robotics engineer, I want to double-click a node (or click "Focus") to see only that node and its immediate neighbors, so I can understand a component's local context without the noise of the full graph.

## Design

- Double-click a node → graph smoothly transitions to show only that node + 1-hop neighbors
- A "depth" slider (1-hop, 2-hop, 3-hop) controls how far the neighborhood extends
- A "Back to full graph" button restores the complete view
- Transition is animated: unrelated nodes fade out, remaining nodes re-layout

## Backend

The `/api/projects/{id}/graph` endpoint could accept an optional `?center={entity_id}&depth=2` query param to return a subgraph. Alternatively, this can be done client-side by filtering the existing graph data.

## Acceptance Criteria

- [ ] Double-click or "Focus" button isolates a node's neighborhood
- [ ] Depth slider controls neighborhood radius (1-3 hops)
- [ ] Smooth animated transition between full graph and neighborhood
- [ ] "Back to full graph" button restores the complete view

#todo #graph #neighborhood #focus
