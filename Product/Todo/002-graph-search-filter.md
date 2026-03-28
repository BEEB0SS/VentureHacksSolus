# Feature: Graph Search & Filter

> Status: **idea** | Priority: **medium** | Demo: A, B, E
> Owner: unassigned

## Problem

When the Context Model graph has 20+ nodes, finding a specific entity requires visually scanning and clicking nodes one by one. There's no way to search for "motor_controller" or filter to "show me only software modules and the interfaces they connect to."

## User Story

> As a robotics engineer, I want to search for a node by name and filter the graph by entity type or relation type, so I can quickly find and focus on the part of the system I'm working on.

## Design

### Search Bar

- Text input above the graph: "Search entities..."
- As user types, matching nodes pulse/highlight on the graph
- Pressing Enter or clicking a search result centers the graph on that node and selects it

### Filter Controls

- Toggleable chips for each entity type present in the graph (e.g., `electrical_part`, `software_module`, `interface`)
- Toggleable chips for relation types (e.g., `publishes`, `drives`, `depends_on`)
- Hiding an entity type fades those nodes and their edges to near-invisible (opacity 0.1) rather than removing them, so spatial context is preserved

## Acceptance Criteria

- [ ] Search input that highlights matching nodes in real-time
- [ ] Enter/click centers graph on first match
- [ ] Entity type filter chips show/hide node categories
- [ ] Relation type filter chips show/hide edge categories
- [ ] Filtered-out elements fade rather than disappear

#todo #graph #search #filter
