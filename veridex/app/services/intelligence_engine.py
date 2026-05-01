from functools import lru_cache
from pathlib import Path

from app.config import VERIDEX_AI_THRESHOLD
from app.models.cnn_classifier import CNNClassifier
from app.models.xgboost_fusion import build_feature_vector, predict_ai_probability


CNN_WEIGHTS_NAME = "resnet50_veridex.pt"
XGB_WEIGHTS_NAME = "xgb_fusion.pkl"


@lru_cache(maxsize=1)
def get_classifier() -> CNNClassifier:
    base_dir = Path(__file__).resolve().parents[2]
    weights_path = base_dir / CNN_WEIGHTS_NAME
    if not weights_path.exists():
        raise RuntimeError(f"Veridex weights not found: {weights_path}")
    return CNNClassifier(weights_path=str(weights_path))


def _resolve_prediction(ai_probability: float) -> str:
    return "AI" if ai_probability > VERIDEX_AI_THRESHOLD else "REAL"


def _resolve_display_label(prediction: str) -> str:
    return "AI / Suspicious" if prediction == "AI" else "Likely Real"


def analyze_image_bytes(image_bytes: bytes, filename: str = "uploaded-image") -> dict:
    classifier = get_classifier()
    cnn_prediction = classifier.predict(image_bytes)

    cnn_ai_probability = float(cnn_prediction.get("ai_probability", 0.0))
    cnn_real_probability = float(cnn_prediction.get("real_probability", 0.0))
    classifier_score = int(round(cnn_ai_probability * 100))
    feature_vector = build_feature_vector(cnn_ai_probability, cnn_real_probability)

    ai_probability = predict_ai_probability(cnn_ai_probability, cnn_real_probability)
    real_probability = max(0.0, min(1.0, 1.0 - ai_probability))
    prediction = _resolve_prediction(ai_probability)
    display_label = _resolve_display_label(prediction)
    confidence_score = max(ai_probability, real_probability)

    return {
        "label": display_label,
        "prediction": prediction,
        "display_label": display_label,
        "ai_probability": ai_probability,
        "real_probability": real_probability,
        "confidence_score": confidence_score,
        "threshold": VERIDEX_AI_THRESHOLD,
        "model": "Strict Veridex Chain",
        "engine": "Veridex",
        "weights": f"{CNN_WEIGHTS_NAME} -> {XGB_WEIGHTS_NAME}",
        "raw_score": int(round(ai_probability * 100)),
        "filename": filename,
        "component_scores": {
            "cnn": classifier_score,
            "xgb": int(round(ai_probability * 100)),
            "cnn_real": int(round(cnn_real_probability * 100)),
            "feature_vector": [float(value) for value in feature_vector.tolist()],
        },
    }
