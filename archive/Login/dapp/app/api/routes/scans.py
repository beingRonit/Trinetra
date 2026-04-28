# app/api/routes/scans.py
from fastapi import APIRouter, HTTPException
from app.services.scan_service import scan_service

router = APIRouter(prefix="/scans", tags=["scans"])


@router.post("/{media_id}", status_code=202)
async def initiate_scan(media_id: str):
    try:
        return await scan_service.initiate_scan(media_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Scan initiation failed")


@router.get("/status/{scan_id}")
async def scan_status(scan_id: str):
    try:
        return await scan_service.get_status(scan_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))