from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.routes.analyze import router as analyze_router
from app.routes.heatmap import router as heatmap_router
from app.routes.feedback import router as feedback_router
from app.db.database import engine
from app.db.models import Base
from app.utils.training_utils import get_training_stats, retrain_from_staging

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
app.include_router(feedback_router)

Base.metadata.create_all(bind=engine)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/stats")
def stats():
    training_stats = get_training_stats()
    return {
        "status": "ok",
        "rate_limit": "100 requests/minute",
        "cache_size": "max 10,000 entries",
        "training": training_stats
    }

@app.post("/retrain")
def trigger_retrain(force: bool = False):
    """Manually trigger retraining from staging files."""
    result = retrain_from_staging(force=force)
    return result
