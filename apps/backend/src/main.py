from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import init_db
from .routes_livebench import router as livebench_router

app = FastAPI(title="Solus", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(livebench_router)

@app.on_event("startup")
async def startup():
    init_db()

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}