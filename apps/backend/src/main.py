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

@app.on_event("startup")
async def startup():
    init_db()

# Core routes (Pratham) — wired here for development; Teammate 3 will own final wiring
try:
    from .routes_core import router as core_router
    app.include_router(core_router)
except ImportError:
    pass

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}