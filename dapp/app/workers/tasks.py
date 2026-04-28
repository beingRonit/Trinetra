# app/workers/tasks.py
import asyncio
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "dapp",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def scan_task(self, scan_id: str, media_id: str, storage_key: str, phash: str):
    from app.services.scan_service import scan_service
    try:
        asyncio.run(
            scan_service.execute_scan(scan_id, media_id, storage_key, phash)
        )
    except Exception as exc:
        raise self.retry(exc=exc)