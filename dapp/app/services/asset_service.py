# app/services/asset_service.py
from app.repositories.asset_repo import asset_repo
from app.core.storage import storage_client
from app.core.config import settings
from app.schemas.contracts import AssetObject, UploadResponse

from pipeline.app.phash import compute as phash_compute


class AssetService:

    async def upload_asset(
        self,
        user_id: str,
        file_bytes: bytes,
        filename: str,
        mime_type: str,
    ) -> UploadResponse:

        if mime_type not in settings.ALLOWED_MIME_TYPES:
            raise ValueError(f"Unsupported file type: {mime_type}")

        max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
        if len(file_bytes) > max_bytes:
            raise ValueError(f"File exceeds {settings.MAX_FILE_SIZE_MB}MB limit")

        phash_val: str = phash_compute(file_bytes)

        existing = await asset_repo.find_by_phash_for_user(user_id, phash_val)
        if existing:
            return UploadResponse(
                asset=existing,
                is_duplicate=True,
                message="Asset already registered",
            )

        storage_key = await storage_client.upload(
            bucket="assets",
            path=f"{user_id}/{filename}",
            data=file_bytes,
            content_type=mime_type,
        )

        asset = await asset_repo.create(
            user_id=user_id,
            storage_key=storage_key,
            phash=phash_val,
            filename=filename,
            mime_type=mime_type,
        )

        return UploadResponse(asset=asset, is_duplicate=False)


asset_service = AssetService()
