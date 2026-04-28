from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import require_auth
from app.services.takedown_service import takedown_service


router = APIRouter(prefix="/takedown", tags=["takedown"])


@router.post("/{media_id}")
async def trigger_takedown(media_id: str, user: dict = Depends(require_auth)):
    try:
        user_id = user.get("sub") or user.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="User identity missing")

        return await takedown_service.trigger_for_media(media_id, str(user_id))
    except HTTPException:
        raise
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 409
        raise HTTPException(status_code=status_code, detail=message)
    except Exception:
        raise HTTPException(status_code=500, detail="Takedown request failed")
