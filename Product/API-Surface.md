# API Surface

> Part of [[Product]]

All API routes across the team. Each person owns their route file using FastAPI APIRouter(prefix="/api").

## Core Routes (Pratham — routes_core.py)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/projects | Create project |
| GET | /api/projects | List projects |
| GET | /api/projects/{id} | Get project |
| POST | /api/projects/{id}/team | Add team member |
| GET | /api/projects/{id}/team | List team members |
| POST | /api/projects/{id}/sources | Add source connection |
| GET | /api/projects/{id}/sources | List sources |
| POST | /api/projects/{id}/sources/{sid}/sync | Trigger sync + diff |
| POST | /api/projects/{id}/entities | Create entity |
| GET | /api/projects/{id}/entities | List entities |
| POST | /api/projects/{id}/relations | Create relation |
| GET | /api/projects/{id}/graph | Get full graph |
| GET | /api/projects/{id}/changes | List changes |
| GET | /api/projects/{id}/impact/{entity_id} | Run impact analysis |

## Live Bench Routes (Teammate 1 — routes_livebench.py)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/projects/{id}/live-bench/start-simulated | Start simulated telemetry |
| POST | /api/projects/{id}/live-bench/stop | Stop telemetry |
| POST | /api/projects/{id}/live-bench/thresholds | Set anomaly thresholds |
| POST | /api/projects/{id}/live-bench/packet | Ingest telemetry packet |
| GET | /api/projects/{id}/live-bench/state | Get current state |
| GET | /api/projects/{id}/live-bench/serial-ports | List serial ports |
| POST | /api/projects/{id}/issues | Log issue |
| GET | /api/projects/{id}/issues | List issues |
| POST | /api/projects/{id}/fixes | Log fix |
| GET | /api/projects/{id}/similar-issues | Search similar issues |
| WS | /ws/projects/{id}/live-bench | Real-time telemetry stream |

## Agent Routes (Teammate 2 — routes_agent.py)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/projects/{id}/agent/query | Main AI query endpoint |
| POST | /api/projects/{id}/memory | Store memory item |
| GET | /api/projects/{id}/memory/search | Search memory |
| POST | /api/projects/{id}/simulator/run | Run simulation |
| GET | /api/projects/{id}/simulator/state | Get sim state |
| POST | /api/projects/{id}/simulator/compare | Compare sim vs runtime |

## Health (Teammate 3 — main.py)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/health | Health check |

#api #routes #backend
