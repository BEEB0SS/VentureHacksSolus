"""
Solus backend entry point.

Router imports use try/except so the app boots regardless of which teammates
have merged their routes files. Each router is imported independently; if a
module is missing (e.g. still on a feature branch) the server starts without
it and logs a warning. The /api/health endpoint reports which routers are
currently loaded.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import init_db

app = FastAPI(title="Solus", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Router wiring — each block is independent so a missing module never blocks
# the others from loading.
# ---------------------------------------------------------------------------

try:
    from .routes_core import router as core_router
    app.include_router(core_router)
    print("[ok] routes_core loaded")
except ImportError as e:
    if "routes_core" not in str(e):
        raise
    print("[warn] routes_core not available — skipping")

try:
    from .routes_livebench import router as livebench_router
    app.include_router(livebench_router)
    print("[ok] routes_livebench loaded")
except ImportError as e:
    if "routes_livebench" not in str(e):
        raise
    print("[warn] routes_livebench not available — skipping")

try:
    from .routes_agent import router as agent_router
    app.include_router(agent_router)
    print("[ok] routes_agent loaded")
except ImportError as e:
    if "routes_agent" not in str(e):
        raise
    print("[warn] routes_agent not available — skipping")

# Discovery routes
try:
    from .routes_discovery import router as discovery_router
    app.include_router(discovery_router)
    print("[ok] routes_discovery loaded")
except ImportError as e:
    if "routes_discovery" not in str(e):
        raise
    print("[warn] routes_discovery not available — skipping")


@app.on_event("startup")
async def startup():
    init_db()


@app.get("/api/health")
async def health():
    loaded = []
    try:
        from . import routes_core  # noqa: F401
        loaded.append("routes_core")
    except ImportError as e:
        if "routes_core" not in str(e):
            raise
    try:
        from . import routes_livebench  # noqa: F401
        loaded.append("routes_livebench")
    except ImportError as e:
        if "routes_livebench" not in str(e):
            raise
    try:
        from . import routes_agent  # noqa: F401
        loaded.append("routes_agent")
    except ImportError as e:
        if "routes_agent" not in str(e):
            raise
    try:
        from . import routes_discovery  # noqa: F401
        loaded.append("routes_discovery")
    except ImportError as e:
        if "routes_discovery" not in str(e):
            raise
    return {"status": "ok", "version": "0.1.0", "routers": loaded}
