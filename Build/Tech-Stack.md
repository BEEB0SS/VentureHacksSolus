# Tech Stack

> Part of [[Build]]

## Desktop App
- **Electron** — cross-platform desktop shell
- **React + TypeScript** — UI framework
- **Tailwind CSS v4** — styling with custom solus-* color tokens
- **Zustand** — global state management
- **Recharts** — charts and sparklines for Live Bench
- **D3** — force-directed graph for Context Model visualization
- **Google Fonts** — Inter (UI) + JetBrains Mono (data/code)

## Backend
- **Python FastAPI** — API server at localhost:8000, proxied through Vite
- **SQLite** — database (hackathon), upgrades to PostgreSQL for production
- **In-memory graph** with SQLite persistence (hackathon), upgrades to Neo4j for production

## AI
- **Google Gemini API** — multimodal reasoning (gemini-2.0-flash)
- **TF-IDF cosine similarity** — semantic search (hackathon), upgrades to sentence-transformers

## Simulation
- **MuJoCo** — physics simulation (or differential drive stub for hackathon)

## Telemetry
- **pyserial** — hardware serial communication
- **WebSocket** — real-time streaming to frontend

## Why These Choices
- Electron + React: fast to build, team already knows it, good for demo polish
- FastAPI: fastest Python web framework, great for async WebSocket support
- SQLite: zero config, ships with Python, good enough for hackathon
- Gemini: free tier, multimodal (can read images/PDFs), structured output support
- TF-IDF: no dependencies needed, works in pure Python, sufficient for demo

#tech #stack #architecture
