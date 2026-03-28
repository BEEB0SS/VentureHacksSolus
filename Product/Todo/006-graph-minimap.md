# Feature: Graph Minimap

> Status: **idea** | Priority: **low** | Demo: A
> Owner: unassigned

## Problem

When zoomed into a section of a large graph, users lose spatial awareness of where they are in the overall system. This is a standard problem in graph visualization tools and node editors.

## User Story

> As a robotics engineer working with a complex system graph, I want a minimap in the corner showing my current viewport within the full graph, so I can orient myself and quickly jump to other areas.

## Design

- Small (150x100px) inset in the bottom-right corner of the graph area
- Shows a simplified overview of the full graph (dots for nodes, lines for edges)
- A semi-transparent rectangle indicates the current viewport
- Click on the minimap to pan the main graph to that location
- Drag the viewport rectangle to pan smoothly

## Acceptance Criteria

- [ ] Minimap renders a simplified overview of the full graph
- [ ] Viewport rectangle shows current zoom position
- [ ] Click-to-pan and drag-to-pan on minimap
- [ ] Minimap updates as user zooms/pans the main graph

#todo #graph #minimap #navigation
