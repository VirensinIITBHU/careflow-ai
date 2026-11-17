"""CareFlow AI API. Synthetic-data demonstration; not for clinical use."""
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, db, llm_cache
from .routers import auth, cases, insights, intake, review
from .safety.policy_loader import load as load_policy

STARTED = time.time()


def _boot_tasks() -> None:
    """Seed demo data and resume cases interrupted by a restart, off the request path."""
    from .pipeline import orchestrator
    if config.SEED_DEMO:
        from . import demo
        try:
            demo.seed_if_empty()
        except Exception as e:  # a seeding problem must never stop the API
            print(f"demo seeding failed: {type(e).__name__}: {e}")
    for case_id in orchestrator.resume_interrupted():
        orchestrator.run(case_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    load_policy()  # fail fast on a broken policy file
    threading.Thread(target=_boot_tasks, daemon=True).start()
    yield


app = FastAPI(
    title="CareFlow AI", version=config.APP_VERSION, lifespan=lifespan,
    description="Human-in-the-loop intake and review. The AI organizes, asks and flags; humans decide. "
                "Synthetic data only. Demo accounts only. Not for clinical use.")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_origin_regex=config.CORS_ORIGIN_REGEX,
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth.router, intake.router, insights.router, cases.router, review.router, review.audit_router):
    app.include_router(r)


@app.get("/health")
def health():
    """Cheap liveness check (also used by the frontend to show a 'waking up' state on cold starts)."""
    has = lambda k: bool(config.env(k))  # noqa: E731
    return {
        "status": "ok", "mode": "synthetic-data-demo", "version": config.APP_VERSION,
        "uptime_s": int(time.time() - STARTED),
        "providers": {"groq": has("GROQ_API_KEY"), "openrouter": has("OPENROUTER_API_KEY"), "huggingface": has("HF_TOKEN")},
        "models": {"extract": config.EXTRACT_MODEL, "stt": config.STT_MODEL, "vision": config.VISION_MODEL,
                   "copilot": config.COPILOT_MODEL if config.COPILOT_LLM else None,
                   "second_reader": config.SECOND_READER_MODEL if config.SECOND_READER else None},
        "cache": llm_cache.stats(),
        "policy_version": load_policy()["version"],
    }


@app.get("/policy")
def policy():
    p = load_policy()
    return {"version": p["version"], "clinically_validated": False,
            "categories": [{"id": c["id"], "title": c["title"], "tier": c["tier"], "terms": len(c["terms"]),
                            "rationale": c["rationale"], "ask": c.get("ask"),
                            "examples": [t for t in c["terms"] if t.isascii()][:5],
                            "languages": sorted({"latin" if t.isascii() else
                                                 ("devanagari" if any("ऀ" <= ch <= "ॿ" for ch in t)
                                                  else "urdu") for t in c["terms"]})}
                           for c in p["categories"]]}
