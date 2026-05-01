from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_user_identity, get_user_identity_candidates, require_auth
from app.schemas.contracts import TakedownReportRequest
from app.services.takedown_service import takedown_service


router = APIRouter(prefix="/takedown", tags=["takedown"])


@router.post("/report")
async def trigger_report_takedown(
    payload: TakedownReportRequest, user: dict = Depends(require_auth)
):
    try:
        user_id = get_user_identity(user)
        if not user_id:
            raise HTTPException(status_code=401, detail="User identity missing")

        return await takedown_service.trigger_for_report(payload, str(user_id))
    except HTTPException:
        raise
    except ValueError as exc:
        message = str(exc)
        status_code = 400
        if "contact email" in message.lower():
            status_code = 404
        raise HTTPException(status_code=status_code, detail=message)
    except Exception:
        raise HTTPException(status_code=500, detail="Takedown report submission failed")


@router.post("/{media_id}")
async def trigger_takedown(media_id: str, user: dict = Depends(require_auth)):
    try:
        user_ids = get_user_identity_candidates(user)
        if not user_ids:
            raise HTTPException(status_code=401, detail="User identity missing")

        return await takedown_service.trigger_for_media(media_id, user_ids)
    except HTTPException:
        raise
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 409
        raise HTTPException(status_code=status_code, detail=message)
    except Exception:
        raise HTTPException(status_code=500, detail="Takedown request failed")
