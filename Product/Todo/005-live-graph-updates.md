# Feature: Live Graph Updates from Telemetry

> Status: **idea** | Priority: **medium** | Demo: A, B
> Owner: unassigned

## Problem

The Context Model graph is static — you load it once and it doesn't change until you hit "Refresh." When Live Bench is streaming telemetry or a source sync detects changes, the graph should reflect this in real time. This is the bridge between Demo A (change propagation) and Demo B (live monitoring).

## User Story

> As a robotics engineer monitoring my robot, I want the Context Model graph to update in real time — nodes pulsing when they receive telemetry, edges glowing when data flows through them, and new nodes/edges appearing when a source sync detects changes — so the graph is a live representation of my system, not a stale snapshot.

## Design

### Telemetry-Driven Animation

- When Live Bench WebSocket receives telemetry for a RuntimeSignal, the corresponding node on the graph pulses with a glow
- Connected edges briefly flash in the direction of data flow
- Anomaly state (red) propagates visually from the signal node through connected edges

### Change-Driven Updates

- When a source sync completes and new entities/relations are added, they animate into the graph (fade in + force simulation settles)
- Changed entities flash briefly to draw attention
- A small toast notification: "3 new entities, 2 new relations added"

### WebSocket Integration

Reuse the existing `/ws/projects/{id}/live-bench` WebSocket. Extend the message format to include graph update events alongside telemetry packets.

## Acceptance Criteria

- [ ] Nodes pulse when telemetry is received for their associated signals
- [ ] Edges flash when data flows through them during live monitoring
- [ ] Anomaly state visually propagates through the graph
- [ ] New entities/relations from sync animate into the graph
- [ ] No full graph reload needed — incremental updates only

#todo #graph #live #telemetry #websocket
