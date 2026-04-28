# app/services/report_service.py
from app.repositories.asset_repo import asset_repo
from app.repositories.scan_repo import scan_repo
from app.repositories.report_repo import report_repo
from app.core.storage import storage_client
from app.schemas.contracts import ReportObject

from pipeline.app.visualizer import generate as viz_generate
from pipeline.app.notice import generate_text as notice_generate


class ReportService:

    async def generate_report(self, media_id: str) -> tuple[ReportObject, str]:
        asset = await asset_repo.get_by_id(media_id)
        if not asset:
            raise ValueError(f"Asset {media_id} not found")

        scan = await scan_repo.get_latest_complete(media_id)
        if not scan:
            raise ValueError("No completed scan found. Run POST /scans/{media_id} first.")

        image_bytes = await storage_client.download(bucket="assets", path=asset.storage_key)

        viz_bytes: bytes = viz_generate(image_bytes=image_bytes, matches=scan.matches)
        notice_text: str = notice_generate(matches=scan.matches)

        viz_key = await storage_client.upload(
            bucket="reports",
            path=f"{media_id}/comparison.jpg",
            data=viz_bytes,
            content_type="image/jpeg",
        )

        report = await report_repo.create(
            media_id=media_id,
            scan_id=str(scan.id),
            viz_storage_key=viz_key,
            notice_text=notice_text,
            evidence_urls=[m.url for m in scan.matches],
        )

        viz_url = storage_client.get_signed_url(
            bucket="reports", path=viz_key, expires_in=3600
        )

        return report, viz_url


report_service = ReportService()