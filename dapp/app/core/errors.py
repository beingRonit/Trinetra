# app/core/errors.py
import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
)
async def download_with_retry(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, follow_redirects=True)
        r.raise_for_status()
        return r.content


def safe_download(url: str) -> bytes | None:
    """Never raises. Returns None on any failure — caller skips."""
    import asyncio
    try:
        return asyncio.run(download_with_retry(url))
    except Exception:
        return None


from fastapi import Request
from fastapi.responses import JSONResponse


async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )