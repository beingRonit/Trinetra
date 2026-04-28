# app/repositories/scan_repo.py
import uuid
import json
from datetime import datetime
from app.core.db import get_db
from app.schemas.contracts import ScanResult, MatchResult


class ScanRepo:

    TABLE = "scan_results"

    async def create(self, media_id: str, status: str = "pending") -> ScanResult:
        record = {
            "id": str(uuid.uuid4()),
            "media_id": media_id,
            "status": status,
            "matches": "[]",
            "total_matches": 0,
            "max_risk": "low",
            "scan_duration_ms": 0,
            "created_at": datetime.utcnow().isoformat(),
        }
        res = get_db().table(self.TABLE).insert(record).execute()
        return self._row_to_model(res.data[0])

    async def get_by_id(self, scan_id: str) -> ScanResult | None:
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("id", scan_id)
            .single()
            .execute()
        )
        return self._row_to_model(res.data) if res.data else None

    async def get_latest_complete(self, media_id: str) -> ScanResult | None:
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("media_id", media_id)
            .eq("status", "complete")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    async def list_by_media_ids(self, media_ids: list[str]) -> list[ScanResult]:
        if not media_ids:
            return []
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .in_("media_id", media_ids)
            .order("created_at", desc=True)
            .execute()
        )
        return [self._row_to_model(row) for row in (res.data or [])]

    async def update_status(
        self, scan_id: str, status: str, error: str | None = None
    ) -> None:
        update = {"status": status}
        if error:
            update["error"] = error
        get_db().table(self.TABLE).update(update).eq("id", scan_id).execute()

    async def save_matches(
        self,
        scan_id: str,
        media_id: str,
        matches: list[MatchResult],
        duration_ms: int,
        clip_embedding: list[float],
    ) -> None:
        risk_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
        max_risk = max(
            (m.risk_level for m in matches), key=lambda r: risk_order.get(r, 0), default="low"
        )
        get_db().table(self.TABLE).update(
            {
                "matches": json.dumps([m.model_dump(mode="json") for m in matches]),
                "total_matches": len(matches),
                "max_risk": max_risk,
                "scan_duration_ms": duration_ms,
                "clip_embedding_ref": json.dumps(clip_embedding[:10]),
            }
        ).eq("id", scan_id).execute()

    def _row_to_model(self, row: dict) -> ScanResult:
        raw_matches = json.loads(row["matches"]) if isinstance(row["matches"], str) else row["matches"]
        matches = [MatchResult(**m) for m in raw_matches]
        return ScanResult(
            id=row["id"],
            media_id=row["media_id"],
            status=row["status"],
            matches=matches,
            total_matches=row.get("total_matches", len(matches)),
            max_risk=row.get("max_risk", "low"),
            scan_duration_ms=row.get("scan_duration_ms", 0),
            error=row.get("error"),
            created_at=datetime.fromisoformat(row["created_at"]),
        )


scan_repo = ScanRepo()
