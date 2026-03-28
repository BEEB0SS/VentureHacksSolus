# Feature: Graph Layout Modes

> Status: **idea** | Priority: **low** | Demo: A
> Owner: unassigned

## Problem

The current force-directed layout with type-based clustering works well for general overview, but different tasks benefit from different layouts. Understanding the ROS topic graph is easier in a hierarchical layout; understanding the hardware wiring is easier in a schematic-style layout.

## User Story

> As a robotics engineer, I want to switch between different graph layout modes so I can see my system from different perspectives depending on what I'm debugging.

## Design

Layout mode selector (toolbar dropdown or toggle):

| Mode | Layout | Best For |
|---|---|---|
| **System** (default) | Force-directed, clustered by type | General overview |
| **Data Flow** | Left-to-right hierarchical (DAG) | ROS topic graph, pub/sub chains |
| **Hardware** | Top-to-bottom hierarchical | Power tree, wiring topology |
| **Radial** | Selected node at center, neighbors in rings | Neighborhood analysis |

Switching layouts animates nodes from their current positions to the new positions.

## Acceptance Criteria

- [ ] Layout mode selector with at least 2 modes (System + Data Flow)
- [ ] Animated transitions between layouts
- [ ] Layout persists per-session (doesn't reset on graph reload)

#todo #graph #layout #visualization
