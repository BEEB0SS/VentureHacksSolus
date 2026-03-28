# Feature: ROS Topic Graph View

> Status: **idea** | Priority: **high** | Demo: A, B
> Owner: unassigned

## Problem

The most common "system understanding" task in ROS robotics is tracing the topic graph: which nodes publish to which topics, and which nodes subscribe. The Context Model already stores `publishes` and `subscribes_to` relations, but they're mixed in with hardware connections, dependencies, and everything else.

## User Story

> As a robotics engineer, I want a dedicated view that shows only the ROS topic graph — publishers on the left, topics in the middle, subscribers on the right — so I can immediately see how data flows through my robot's software stack.

## Design

A filtered + re-laid-out view of the existing graph data:

```
Publishers          Topics           Subscribers
┌──────────┐     ┌─────────┐     ┌──────────────────┐
│teleop    │────▶│/cmd_vel │────▶│motor_controller  │
│twist.py  │     └─────────┘     └──────────────────┘
└──────────┘
                  ┌─────────┐     ┌──────────────────┐
┌──────────┐     │/odom    │────▶│nav_planner.py    │
│motor_    │────▶└─────────┘     └──────────────────┘
│controller│
└──────────┘     ┌─────────┐     ┌──────────────────┐
                  │/imu/data│────▶│nav_planner.py    │
┌──────────┐────▶└─────────┘     └──────────────────┘
│sensor_   │
│reader.py │     ┌─────────┐     ┌──────────────────┐
└──────────┘────▶│/scan    │────▶│nav_planner.py    │
                  └─────────┘     └──────────────────┘
```

- Three-column hierarchical layout
- Only shows `SoftwareModule` and `Interface` nodes
- Only shows `publishes` and `subscribes_to` edges
- Animated dots show data direction
- Clicking a topic shows all publishers and subscribers
- When Live Bench is active, edges pulse with actual message frequency

## Implementation

This is a **view mode** of the existing graph, not new data. Filter the graph to `entity_type IN (software_module, interface)` and `relation_type IN (publishes, subscribes_to)`, then apply a three-column Sugiyama/DAG layout.

## Acceptance Criteria

- [ ] Dedicated "ROS Topics" view tab or toggle within the graph
- [ ] Three-column layout: publishers → topics → subscribers
- [ ] Only relevant entity types and relation types shown
- [ ] Data flow direction clearly indicated with arrows and/or animation
- [ ] Click a topic to see all connected publishers/subscribers in detail panel

#todo #graph #ros #topics #data-flow
