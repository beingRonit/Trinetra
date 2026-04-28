from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import require_auth
from app.core.storage import storage_client
from app.repositories.asset_repo import asset_repo
from app.repositories.scan_repo import scan_repo


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def get_dashboard_summary(
    limit: int = Query(default=12, ge=1, le=100),
    user: dict = Depends(require_auth),
):
    try:
        user_id = user.get("sub") or user.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="User identity missing")

        try:
            assets = await asset_repo.list_by_user(str(user_id), limit=limit)
            scans = await scan_repo.list_by_media_ids([str(asset.id) for asset in assets])
        except Exception:
            assets = []
            scans = []
        scans_by_media_id = {str(scan.media_id): scan for scan in scans}

        risk_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
        highest_risk = "low"
        total_matches = 0
        completed_scans = 0

        recent_assets = []
        for asset in assets:
            scan = scans_by_media_id.get(str(asset.id))
            if scan and scan.status == "complete":
                completed_scans += 1
                total_matches += scan.total_matches
                if risk_order.get(scan.max_risk, 0) > risk_order.get(highest_risk, 0):
                    highest_risk = scan.max_risk

            preview_url = ""
            if asset.storage_key:
                try:
                    preview_url = storage_client.get_signed_url(
                        bucket="assets",
                        path=asset.storage_key,
                        expires_in=3600,
                    )
                except Exception:
                    preview_url = ""

            recent_assets.append(
                {
                    "id": str(asset.id),
                    "filename": asset.filename,
                    "mime_type": asset.mime_type,
                    "created_at": asset.created_at.isoformat(),
                    "phash": asset.phash,
                    "preview_url": preview_url,
                    "scan": {
                        "status": scan.status,
                        "total_matches": scan.total_matches,
                        "max_risk": scan.max_risk,
                        "scan_duration_ms": scan.scan_duration_ms,
                    }
                    if scan
                    else None,
                }
            )

        return {
            "user": {
                "email": user.get("email"),
                "id": str(user_id),
                "joined_at": user.get("iat"),
            },
            "summary": {
                "total_assets": len(assets),
                "completed_scans": completed_scans,
                "total_matches": total_matches,
                "highest_risk": highest_risk,
            },
            "recent_assets": recent_assets,
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load dashboard summary")
