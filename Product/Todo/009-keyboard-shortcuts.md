# Feature: Keyboard Shortcuts for Graph Navigation

> Status: **idea** | Priority: **low** | Demo: all
> Owner: unassigned

## Problem

Power users (robotics engineers are power users) expect keyboard-driven navigation. Currently the graph is mouse-only.

## User Story

> As a robotics engineer, I want keyboard shortcuts for common graph actions so I can navigate and analyze the system efficiently without reaching for the mouse.

## Design

| Shortcut | Action |
|---|---|
| `/` or `Cmd+K` | Focus search bar |
| `Escape` | Deselect node/edge, exit search, exit neighborhood view |
| `Tab` | Cycle to next connected node from current selection |
| `Shift+Tab` | Cycle to previous connected node |
| `Enter` | On selected node: open detail panel / run impact analysis |
| `F` | Focus/neighborhood view on selected node |
| `R` | Refresh graph |
| `1-4` | Switch layout mode (if Feature 007 is built) |
| `L` | Toggle edge labels (if Feature 008 is built) |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom to fit all nodes |

## Acceptance Criteria

- [ ] At minimum: `/` for search, `Escape` for deselect, `Tab` for traverse, `0` for zoom-to-fit
- [ ] Keyboard shortcut hint overlay (triggered by `?`)
- [ ] Shortcuts don't conflict with Electron/OS shortcuts

#todo #graph #keyboard #shortcuts #ux
