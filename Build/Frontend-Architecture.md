# Frontend Architecture

> Part of [[Build]]

## State Management
Zustand store (`projectStore.ts`) is the single source of truth for all frontend state. Every tab component imports from this store. No prop drilling.

Key state: currentProjectId, projects[], entities[], relations[], recentChanges[]

## Styling
- Tailwind CSS v4 with custom `solus-*` color tokens defined in globals.css
- Design direction: developer tool aesthetic (VS Code / Grafana), not consumer app
- Fonts: Inter (UI text) + JetBrains Mono (data, code, terminal output)
- Dark theme by default

## Component Patterns
- Each demo owns its own tab component in a dedicated folder
- Shared components (LoadingSpinner, Card, Modal, etc.) live in components/shared/
- Custom hooks (useApi, useWebSocket, useProject) in hooks/
- All API calls go through the Zustand store actions or useApi hook

## Data Flow
1. User action triggers a store action (e.g., `syncSource()`)
2. Store calls `fetch('/api/...')` to the FastAPI backend
3. Backend processes and returns data
4. Store updates state → React re-renders
5. For real-time data: WebSocket connection pushes updates directly

## Charts & Visualization
- **Recharts** for sparklines and line charts (Live Bench, Simulator)
- **D3 force-directed layout** for the Context Model graph (nodes colored by type, edges by relation)

#frontend #react #architecture
