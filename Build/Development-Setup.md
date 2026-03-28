# Development Setup

> Part of [[Build]]

## Prerequisites
- Python 3.10+
- Node.js 18+ with pnpm
- Git

## Backend Setup
```bash
cd apps/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -c "from src.database import init_db; init_db()"
```

## Frontend Setup
```bash
cd apps/desktop
pnpm install
```

## Running the App

**Terminal 1 — Backend:**
```bash
cd apps/backend && source .venv/bin/activate
uvicorn src.main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd apps/desktop && pnpm run dev:web
```

Open http://localhost:5173 — dark Solus UI with 5 sidebar tabs.

## Environment Variables
- `GEMINI_API_KEY` — required for AI agent features (Demo D)

## Branching
Each teammate works on their own branch and merges in order:
1. Pratham → `feature/core-change-propagation`
2. Teammate 3 → `feature/shell-integration`
3. Teammate 1 → `feature/livebench-memory`
4. Teammate 2 → `feature/ai-knowledge-simulator`

#setup #dev #getting-started
