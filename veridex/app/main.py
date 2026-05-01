from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.routes.analyze import router as analyze_router
from app.routes.heatmap import router as heatmap_router
from app.routes.intelligence import router as intelligence_router
from app.services.feedback_runtime import (
    get_runtime_feedback_stats,
    initialize_feedback_runtime,
    start_feedback_worker,
    stop_feedback_worker,
)


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="VERIDEX")
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return {"detail": f"Rate limit exceeded: {exc.detail}"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router)
app.include_router(heatmap_router)
app.include_router(intelligence_router)


@app.on_event("startup")
async def startup_event():
    initialize_feedback_runtime()
    await start_feedback_worker()


@app.on_event("shutdown")
async def shutdown_event():
    await stop_feedback_worker()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stats")
def stats():
    return {
        "status": "ok",
        "rate_limit": "100 requests/minute",
        "runtime_feedback": get_runtime_feedback_stats(),
    }


@app.post("/retrain")
def trigger_retrain():
    return {
        "success": False,
        "message": "Manual retraining is disabled for the temporary feedback workflow. Submit valid feedback instead.",
    }
