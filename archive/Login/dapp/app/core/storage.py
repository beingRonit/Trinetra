# app/core/storage.py
from app.core.db import get_db


class StorageClient:
    """
    RULE: DB stores storage_key (path string) ONLY.
    URLs generated on-demand via get_signed_url.
    Never store URLs in DB — they expire.
    """

    async def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        """Upload bytes → returns storage_key (path). Raises on failure."""
        db = get_db()
        db.storage.from_(bucket).upload(
            path, data, {"content-type": content_type, "upsert": "true"}
        )
        return path

    async def download(self, bucket: str, path: str) -> bytes:
        db = get_db()
        return db.storage.from_(bucket).download(path)

    def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        db = get_db()
        result = db.storage.from_(bucket).create_signed_url(path, expires_in)
        return result["signedURL"]

    def get_public_url(self, bucket: str, path: str) -> str:
        """Only use for public buckets."""
        return f"{get_db().supabase_url}/storage/v1/object/public/{bucket}/{path}"


storage_client = StorageClient()