# app/api/routes/reports.py
from fastapi import APIRouter, HTTPException
from app.services.report_service import report_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/{media_id}", status_code=201)
async def generate_report(media_id: str):
    try:
        report, viz_url = await report_service.generate_report(media_id)
        return {"report": report, "viz_url": viz_url}
    except ValueError as e:
        code = 409 if "scan" in str(e).lower() else 404
        raise HTTPException(status_code=code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Report generation failed")