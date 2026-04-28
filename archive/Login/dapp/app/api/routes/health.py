from fastapi import APIRouter, HTTPException
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["health"])

@router.get("/health")
async def health():
    try:
        db_ok = True
        
        from dapp.app.services.vision_service import vision_service
        models_ok = vision_service is not None
        
        status = "ok" if (db_ok and models_ok) else "degraded"
        
        return {
            "status": status,
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {
                "database": "ok" if db_ok else "error",
                "models": "ok" if models_ok else "error"
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail="Health check failed")