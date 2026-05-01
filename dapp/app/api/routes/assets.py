# app/api/routes/assets.py
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Depends
from app.services.asset_service import asset_service
from app.core.auth import get_user_identity, get_user_identity_candidates, require_auth
from app.repositories.asset_repo import asset_repo
from app.repositories.protected_registry_repo import protected_registry_repo
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
        owner_id = get_user_identity(user)
        if not owner_id:
            raise HTTPException(status_code=401, detail="User identity missing")

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
        email = str(user.get("email") or "")

        # Handle registry-prefixed assets (protected registry)
        if media_id.startswith("registry-"):
            registry_id = media_id.removeprefix("registry-")
            deleted = await protected_registry_repo.delete_for_user_email(
                registry_id,
                email,
            )
            if not deleted:
                raise HTTPException(status_code=404, detail="Asset not found")
            return {"status": "deleted", "id": media_id}

        # Try to delete from media_files using identity candidates
        owner_ids = get_user_identity_candidates(user)
        asset = await asset_repo.delete_for_users(media_id, owner_ids)

        if not asset and email:
            # Fallback: try deleting by email directly for backward compatibility
            # This handles cases where the asset was created with a different auth provider
            # but the same email address
            asset = await asset_repo.delete_for_user(media_id, email)

        if not asset:
            # Asset not found with current identity candidates
            # Check if it exists at all (to give a more specific error)
            existing = await asset_repo.get_by_id(media_id)
            if existing:
                # Asset exists but belongs to a different user
                raise HTTPException(status_code=403, detail="You do not have permission to delete this asset")
            raise HTTPException(status_code=404, detail="Asset not found")

        await scan_repo.delete_by_media_id(media_id)
        await storage_client.remove("assets", asset.storage_key)
        return {"status": "deleted", "id": media_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to delete asset")
