# Feature: Path Tracing Between Nodes

> Status: **idea** | Priority: **medium** | Demo: A, E
> Owner: unassigned

## Problem

One of the most common questions in robotics debugging is "how does data get from sensor X to actuator Y?" — tracing the full chain through ROS topics, software modules, and hardware. Currently the graph shows all connections but doesn't help you trace a specific path.

## User Story

> As a robotics engineer, I want to select two nodes and see every path between them highlighted on the graph, so I can trace how a signal propagates through the system.

## Design

- Select first node (click), then Shift+click second node
- All paths between the two nodes are highlighted with a glowing trail
- A sidebar list shows each path as an ordered chain: `IMU → /imu/data → nav_planner.py → /cmd_vel → motor_controller.py → DRV8825 → NEMA17`
- Each step in the chain shows the relation type connecting it
- Clicking a step in the chain selects that node/edge on the graph

## Backend

New endpoint: `GET /api/projects/{id}/paths?from={entity_id}&to={entity_id}&max_depth=6`

Returns all paths (BFS/DFS with cycle detection) up to `max_depth` hops between two entities.

## Acceptance Criteria

- [ ] Shift+click two nodes to select a path query
- [ ] All paths between the two nodes are highlighted
- [ ] Sidebar lists each path as a readable chain with relation types
- [ ] Clicking a path step selects that node/edge
- [ ] Max depth limit prevents runaway queries on dense graphs

#todo #graph #path-tracing #debugging
