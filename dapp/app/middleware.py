from fastapi import Request, status
from fastapi.responses import JSONResponse
from typing import Callable
import logging
import uuid
from datetime import datetime
from .core.exceptions import AppError

logger = logging.getLogger(__name__)

async def error_handling_middleware(request: Request, call_next: Callable):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    
    try:
        return await call_next(request)
    except AppError as exc:
        logger.error(f"[{request_id}] AppError: {exc.message}")
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.message,
                "request_id": request_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    except Exception as exc:
        logger.error(f"[{request_id}] Unhandled: {str(exc)}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": "Internal error",
                "request_id": request_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        )

async def request_logging_middleware(request: Request, call_next: Callable):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    logger.info(f"[{request_id}] {request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"[{request_id}] {response.status_code}")
    return response