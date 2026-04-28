from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import CNN_THRESHOLD
from app.modules.forensics import analyze_forensics
from app.modules.fusion import fuse_scores
from app.modules.metadata import analyze_metadata
from app.models.cnn_classifier import CNNClassifier
from app.models.zero_shot_ai_classifier import ZeroShotAIClassifier


router = APIRouter(prefix="/intelligence/veridex", tags=["intelligence"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE_MB = 10
WEIGHTS_NAME = "resnet50_veridex.pt"


@lru_cache(maxsize=1)
def get_classifier() -> CNNClassifier:
    base_dir = Path(__file__).resolve().parents[2]
    weights_path = base_dir / WEIGHTS_NAME
    if not weights_path.exists():
        raise RuntimeError(f"Veridex weights not found: {weights_path}")
    return CNNClassifier(weights_path=str(weights_path))


@lru_cache(maxsize=1)
def get_zero_shot_classifier() -> ZeroShotAIClassifier:
    return ZeroShotAIClassifier()


@router.post("/analyze")
async def analyze_intelligence_image(file: UploadFile = File(...)):
    content_type = file.content_type or "image/webp"
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Only JPEG, PNG, WebP allowed. Got: {content_type}")

    image_bytes = await file.read()
    if len(image_bytes) > MAX_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max {MAX_SIZE_MB}MB")

    try:
        classifier = get_classifier()
        zero_shot_classifier = get_zero_shot_classifier()
        prediction = classifier.predict(image_bytes)
        zero_shot_prediction = zero_shot_classifier.predict(image_bytes)
        metadata = analyze_metadata(image_bytes)
        forensics = analyze_forensics(image_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Veridex inference failed: {exc}") from exc

    cnn_ai_probability = float(prediction.get("ai_probability", 0.0))
    classifier_score = int(round(cnn_ai_probability * 40))
    fused_score = fuse_scores(
        metadata.get("score", 0),
        forensics.get("score", 0),
        classifier_score,
        0,
    )
    heuristic_ai_probability = max(0.0, min(1.0, fused_score / 100.0))
    zero_shot_ai_probability = float(zero_shot_prediction.get("ai_probability", 0.0))
    ai_probability = max(cnn_ai_probability, heuristic_ai_probability, zero_shot_ai_probability)
    real_probability = 1.0 - ai_probability

    if ai_probability >= CNN_THRESHOLD:
        label = "AI GENERATED"
    elif ai_probability >= 0.4:
        label = "SUSPICIOUS"
    else:
        label = "LIKELY REAL"

    return {
        "label": label,
        "ai_probability": ai_probability,
        "real_probability": real_probability,
        "threshold": CNN_THRESHOLD,
        "model": "Veridex CNN (ResNet50)",
        "engine": "Veridex",
        "weights": WEIGHTS_NAME,
        "raw_score": fused_score,
        "filename": file.filename or "uploaded-image",
        "component_scores": {
            "metadata": metadata.get("score", 0),
            "forensics": forensics.get("score", 0),
            "cnn": int(round(cnn_ai_probability * 100)),
            "zero_shot": int(round(zero_shot_ai_probability * 100)),
        },
    }
