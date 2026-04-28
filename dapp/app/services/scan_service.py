# app/services/scan_service.py
import time
from app.repositories.asset_repo import asset_repo
from app.repositories.scan_repo import scan_repo
from app.core.storage import storage_client
from app.core.config import settings
from app.schemas.contracts import PipelineInput, ScanResult
from app.pipeline.runner import run_pipeline


class ScanService:

    async def initiate_scan(self, media_id: str) -> dict:
        asset = await asset_repo.get_by_id(media_id)
        if not asset:
            raise ValueError(f"Asset {media_id} not found")

        scan = await scan_repo.create(media_id=media_id, status="pending")
        scan_id = str(scan.id)

        if settings.SYNC_MODE:
            await self.execute_scan(scan_id, media_id, asset.storage_key, asset.phash)
            updated = await scan_repo.get_by_id(scan_id)
            return {"scan_id": scan_id, "status": updated.status, "scan": updated}

        from app.workers.tasks import scan_task
        scan_task.delay(
            scan_id=scan_id,
            media_id=media_id,
            storage_key=asset.storage_key,
            phash=asset.phash,
        )

        return {
            "scan_id": scan_id,
            "status": "pending",
            "poll_url": f"/scans/status/{scan_id}",
        }

    async def execute_scan(
        self, scan_id: str, media_id: str, storage_key: str, phash: str
    ) -> None:
        await scan_repo.update_status(scan_id, "running")
        start = time.time()

        try:
            image_bytes = await storage_client.download(bucket="assets", path=storage_key)

            pipeline_input = PipelineInput(
                image_bytes=image_bytes,
                storage_key=storage_key,
                media_id=media_id,
                phash=phash,
            )

            output = run_pipeline(pipeline_input)

            if output.error:
                await scan_repo.update_status(scan_id, "failed", error=output.error)
                return

            duration_ms = int((time.time() - start) * 1000)

            await scan_repo.save_matches(
                scan_id=scan_id,
                media_id=media_id,
                matches=output.matches,
                duration_ms=duration_ms,
                clip_embedding=output.clip_embedding,
            )

            if output.clip_embedding:
                await asset_repo.update_embedding(media_id, output.clip_embedding)

            await scan_repo.update_status(scan_id, "complete")

        except Exception as e:
            await scan_repo.update_status(scan_id, "failed", error=str(e))
            raise

    async def get_status(self, scan_id: str) -> ScanResult:
        scan = await scan_repo.get_by_id(scan_id)
        if not scan:
            raise ValueError(f"Scan {scan_id} not found")
        return scan


scan_service = ScanService()