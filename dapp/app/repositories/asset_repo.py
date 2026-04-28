# app/repositories/asset_repo.py
import uuid
from datetime import datetime
from app.core.db import get_db
from app.schemas.contracts import AssetObject


class AssetRepo:

    TABLE = "media_files"

    async def create(
        self,
        user_id: str,
        storage_key: str,
        phash: str,
        filename: str,
        mime_type: str,
    ) -> AssetObject:
        record = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "storage_key": storage_key,
            "phash": phash,
            "filename": filename,
            "mime_type": mime_type,
            "created_at": datetime.utcnow().isoformat(),
        }
        res = get_db().table(self.TABLE).insert(record).execute()
        return self._row_to_model(res.data[0])

    async def get_by_id(self, media_id: str) -> AssetObject | None:
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("id", media_id)
            .single()
            .execute()
        )
        return self._row_to_model(res.data) if res.data else None

    async def find_by_phash(self, phash: str) -> AssetObject | None:
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("phash", phash)
            .limit(1)
            .execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    async def find_by_phash_for_user(self, user_id: str, phash: str) -> AssetObject | None:
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("phash", phash)
            .limit(1)
            .execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    async def list_by_user(self, user_id: str, limit: int = 20) -> list[AssetObject]:
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [self._row_to_model(row) for row in (res.data or [])]

    async def delete_for_user(self, media_id: str, user_id: str) -> AssetObject | None:
        existing = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("id", media_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            return None

        get_db().table(self.TABLE).delete().eq("id", media_id).eq("user_id", user_id).execute()
        return self._row_to_model(existing.data[0])

    async def update_embedding(self, media_id: str, embedding: list[float]) -> None:
        get_db().table(self.TABLE).update(
            {"clip_embedding": embedding}
        ).eq("id", media_id).execute()

    async def find_similar_by_embedding(
        self, embedding: list[float], threshold: float = 0.85
    ) -> list[AssetObject]:
        vec_str = "[" + ",".join(map(str, embedding)) + "]"
        res = get_db().rpc(
            "find_similar_assets",
            {"query_embedding": vec_str, "match_threshold": threshold, "match_count": 20},
        ).execute()
        return [self._row_to_model(r) for r in res.data]

    def _row_to_model(self, row: dict) -> AssetObject:
        return AssetObject(
            id=row["id"],
            user_id=row["user_id"],
            storage_key=row["storage_key"],
            phash=row["phash"],
            clip_embedding=row.get("clip_embedding"),
            filename=row["filename"],
            mime_type=row["mime_type"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )


asset_repo = AssetRepo()
