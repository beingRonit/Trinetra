# app/api/routes/assets.py
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Depends
from app.services.asset_service import asset_service
from app.core.auth import require_auth
from app.repositories.asset_repo import asset_repo
from app.repositories.scan_repo import scan_repo
from app.core.storage import storage_client

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/upload", status_code=201)
async def upload(
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    try:
        file_bytes = await file.read()
        owner_email = user.get("email", "unknown")
        owner_id = user.get("sub", user.get("user_id", ""))
        result = await asset_service.upload_asset(
            user_id=owner_id,
            file_bytes=file_bytes,
            filename=file.filename,
            mime_type=file.content_type,
        )
        status_code = 409 if result.is_duplicate else 201
        return result
    except ValueError as e:
        code = 413 if "exceeds" in str(e) else 400
        raise HTTPException(status_code=code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Upload failed")


@router.delete("/{media_id}")
async def delete_asset(
    media_id: str,
    user: dict = Depends(require_auth),
):
    try:
        owner_id = user.get("sub", user.get("user_id", ""))
        asset = await asset_repo.delete_for_user(media_id, owner_id)
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")

        await scan_repo.delete_by_media_id(media_id)
        await storage_client.remove("assets", asset.storage_key)
        return {"status": "deleted", "id": media_id}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete asset")
