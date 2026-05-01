from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services.feedback_runtime import AI_LABEL, REAL_LABEL, enqueue_feedback_job, get_job_status
from app.services.intelligence_engine import analyze_image_bytes


router = APIRouter(prefix="/intelligence/veridex", tags=["intelligence"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE_MB = 10
ALLOWED_PREDICTIONS = {AI_LABEL, REAL_LABEL}


def _validate_upload(file: UploadFile, image_bytes: bytes) -> None:
    content_type = file.content_type or "image/webp"
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Only JPEG, PNG, WebP allowed. Got: {content_type}")

    if len(image_bytes) > MAX_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max {MAX_SIZE_MB}MB")


@router.post("/analyze")
async def analyze_intelligence_image(file: UploadFile = File(...)):
    image_bytes = await file.read()
    _validate_upload(file, image_bytes)

    try:
        return analyze_image_bytes(image_bytes, filename=file.filename or "uploaded-image")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Veridex inference failed: {exc}") from exc


@router.post("/feedback")
async def submit_intelligence_feedback(
    image: UploadFile = File(...),
    prediction: str = Form(...),
    user_feedback: str = Form(...),
    confidence_score: float = Form(...),
    ai_probability: float | None = Form(None),
    real_probability: float | None = Form(None),
    classifier_score: int | None = Form(None),
):
    prediction_value = prediction.upper()
    feedback_value = user_feedback.upper()

    if prediction_value not in ALLOWED_PREDICTIONS:
        raise HTTPException(status_code=400, detail=f"Prediction must be one of {sorted(ALLOWED_PREDICTIONS)}")

    if feedback_value == "SKIP":
        raise HTTPException(status_code=400, detail="Skip must bypass feedback storage and training")

    if feedback_value not in ALLOWED_PREDICTIONS:
        raise HTTPException(status_code=400, detail=f"Feedback must be one of {sorted(ALLOWED_PREDICTIONS)}")

    image_bytes = await image.read()
    _validate_upload(image, image_bytes)

    try:
        job = enqueue_feedback_job(
            image_bytes=image_bytes,
            prediction=prediction_value,
            user_feedback=feedback_value,
            confidence_score=confidence_score,
            ai_probability=ai_probability,
            real_probability=real_probability,
            classifier_score=classifier_score,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to enqueue feedback job: {exc}") from exc

    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "stage": job["stage"],
        "prediction": prediction_value,
        "user_feedback": feedback_value,
    }


@router.get("/feedback/jobs/{job_id}")
async def get_feedback_job(job_id: str):
    status = get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Feedback job not found")
    return status
