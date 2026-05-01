from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_user_identity, get_user_identity_candidates, require_auth
from app.core.storage import storage_client
from app.repositories.asset_repo import asset_repo
from app.repositories.protected_registry_repo import protected_registry_repo
from app.repositories.scan_repo import scan_repo


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def get_dashboard_summary(
    limit: int = Query(default=12, ge=1, le=100),
    user: dict = Depends(require_auth),
):
    try:
        user_id = get_user_identity(user)
        if not user_id:
            raise HTTPException(status_code=401, detail="User identity missing")

        try:
            assets = await asset_repo.list_by_users(get_user_identity_candidates(user), limit=limit)
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

        registry_assets = []
        try:
            registry_assets = await protected_registry_repo.list_by_user_email(
                str(user.get("email") or ""),
                limit=limit,
            )
        except Exception:
            registry_assets = []

        linked_phashes = {asset.get("phash") for asset in recent_assets if asset.get("phash")}
        for registry_asset in registry_assets:
            if registry_asset.get("phash") not in linked_phashes:
                recent_assets.append(registry_asset)

        recent_assets.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        recent_assets = recent_assets[:limit]

        return {
            "user": {
                "email": user.get("email"),
                "id": str(user_id),
                "joined_at": user.get("iat"),
            },
            "summary": {
                "total_assets": len(recent_assets),
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


@router.get("/assets/{media_id}/preview")
async def get_asset_preview(
    media_id: str,
    user: dict = Depends(require_auth),
):
    user_ids = get_user_identity_candidates(user)
    if not user_ids:
        raise HTTPException(status_code=401, detail="User identity missing")

    asset = await asset_repo.get_by_id(media_id)
    if not asset or str(asset.user_id) not in user_ids:
        raise HTTPException(status_code=404, detail="Asset not found")

    if not asset.storage_key:
        raise HTTPException(status_code=404, detail="Preview unavailable")

    try:
        preview_url = storage_client.get_signed_url(
            bucket="assets",
            path=asset.storage_key,
            expires_in=3600,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to generate preview URL")

    return {
        "id": str(asset.id),
        "filename": asset.filename,
        "preview_url": preview_url,
    }
