"""CareFlow AI API. Synthetic-data demonstration; not for clinical use."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, db
from .routers import auth, cases, review
from .safety.policy_loader import load as load_policy


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(
    title="CareFlow AI", version="1.0.0", lifespan=lifespan,
    description="Human-in-the-loop triage support. The AI organizes and flags; humans decide. "
                "Synthetic data only. Demo accounts only. Not for clinical use.")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
for r in (auth.router, cases.router, review.router, review.audit_router):
    app.include_router(r)


@app.get("/health")
def health():
    return {"status": "ok", "mode": "synthetic-data-demo"}


@app.get("/policy")
def policy():
    p = load_policy()
    return {"version": p["version"], "clinically_validated": False,
            "categories": [{"id": c["id"], "title": c["title"], "tier": c["tier"], "terms": len(c["terms"])}
                           for c in p["categories"]]}
