from functools import lru_cache
from pathlib import Path
import pickle
from typing import Any

import numpy as np
import xgboost as xgb


XGB_MODEL_PATH = Path(__file__).resolve().parents[2] / "xgb_fusion.pkl"
MODEL_SIGNATURE = "strict-cnn-xgb-v2"


def _clamp_probability(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def build_feature_vector(ai_probability: float, real_probability: float) -> np.ndarray:
    ai_prob = _clamp_probability(ai_probability)
    real_prob = _clamp_probability(real_probability)
    margin = abs(ai_prob - real_prob)
    uncertainty = 1.0 - margin

    return np.array(
        [
            ai_prob * 100.0,
            real_prob * 100.0,
            margin * 100.0,
            uncertainty * 100.0,
        ],
        dtype=np.float32,
    )


def _build_bootstrap_training_data() -> tuple[np.ndarray, np.ndarray]:
    features: list[np.ndarray] = []
    labels: list[int] = []

    for ai_prob in np.linspace(0.01, 0.99, 99):
        real_prob = 1.0 - ai_prob
        features.append(build_feature_vector(ai_prob, real_prob))
        labels.append(1 if ai_prob >= 0.5 else 0)

    for ai_prob in [0.38, 0.42, 0.46, 0.49, 0.51, 0.54, 0.58, 0.62]:
        real_prob = 1.0 - ai_prob
        features.append(build_feature_vector(ai_prob, real_prob))
        labels.append(1 if ai_prob >= 0.5 else 0)

    return np.vstack(features), np.array(labels, dtype=np.int32)


def _create_bootstrap_model() -> xgb.XGBClassifier:
    features, labels = _build_bootstrap_training_data()
    model = xgb.XGBClassifier(
        n_estimators=48,
        max_depth=3,
        learning_rate=0.08,
        eval_metric="logloss",
        random_state=42,
    )
    model.fit(features, labels)
    return model


def _unwrap_model_blob(blob: Any) -> tuple[Any, str | None]:
    if isinstance(blob, dict) and "model" in blob:
        return blob["model"], blob.get("signature")
    return blob, None


@lru_cache(maxsize=1)
def load_xgb() -> tuple[Any, str]:
    if not XGB_MODEL_PATH.exists():
        return _create_bootstrap_model(), MODEL_SIGNATURE

    with XGB_MODEL_PATH.open("rb") as file_handle:
        blob = pickle.load(file_handle)

    model, signature = _unwrap_model_blob(blob)

    if model is None or not hasattr(model, "predict_proba"):
        return _create_bootstrap_model(), MODEL_SIGNATURE

    return model, signature or "legacy"


def reset_xgb_cache() -> None:
    load_xgb.cache_clear()


def persist_xgb_model(model: Any) -> None:
    payload = {
        "signature": MODEL_SIGNATURE,
        "model": model,
    }
    with XGB_MODEL_PATH.open("wb") as file_handle:
        pickle.dump(payload, file_handle)
    reset_xgb_cache()


def predict_ai_probability(ai_probability: float, real_probability: float) -> float:
    model, signature = load_xgb()
    feature_vector = build_feature_vector(ai_probability, real_probability).reshape(1, -1)
    xgb_probability = float(model.predict_proba(feature_vector)[0][1])

    base_probability = _clamp_probability(ai_probability)
    if signature == MODEL_SIGNATURE:
        calibrated_probability = (xgb_probability * 0.75) + (base_probability * 0.25)
    else:
        calibrated_probability = (xgb_probability * 0.25) + (base_probability * 0.75)

    return _clamp_probability(calibrated_probability)


def xgb_fuse(ai_probability: float, real_probability: float) -> int:
    return int(round(predict_ai_probability(ai_probability, real_probability) * 100))
