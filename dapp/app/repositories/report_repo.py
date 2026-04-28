# app/repositories/report_repo.py
import uuid
import json
from datetime import datetime
from app.core.db import get_db
from app.schemas.contracts import ReportObject


class ReportRepo:

    TABLE = "legal_reports"

    async def create(
        self,
        media_id: str,
        scan_id: str,
        viz_storage_key: str,
        notice_text: str,
        evidence_urls: list[str],
    ) -> ReportObject:
        record = {
            "id": str(uuid.uuid4()),
            "media_id": media_id,
            "scan_id": scan_id,
            "viz_storage_key": viz_storage_key,
            "notice_text": notice_text,
            "evidence_urls": json.dumps(evidence_urls),
            "generated_at": datetime.utcnow().isoformat(),
        }
        res = get_db().table(self.TABLE).insert(record).execute()
        return self._row_to_model(res.data[0])

    async def get_by_media_id(self, media_id: str) -> ReportObject | None:
        res = (
            get_db()
            .table(self.TABLE)
            .select("*")
            .eq("media_id", media_id)
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    def _row_to_model(self, row: dict) -> ReportObject:
        urls = json.loads(row["evidence_urls"]) if isinstance(row["evidence_urls"], str) else row["evidence_urls"]
        return ReportObject(
            id=row["id"],
            media_id=row["media_id"],
            scan_id=row["scan_id"],
            viz_storage_key=row["viz_storage_key"],
            notice_text=row["notice_text"],
            evidence_urls=urls,
            generated_at=datetime.fromisoformat(row["generated_at"]),
        )


report_repo = ReportRepo()