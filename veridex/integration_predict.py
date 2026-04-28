import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import CNN_THRESHOLD  # noqa: E402
from app.models.cnn_classifier import CNNClassifier  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: integration_predict.py <image_path>"}))
        return 1

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(json.dumps({"error": f"Image not found: {image_path}"}))
        return 1

    classifier = CNNClassifier(weights_path=str(ROOT / "resnet50_veridex.pt"))

    with image_path.open("rb") as handle:
        result = classifier.predict(handle.read())

    ai_probability = float(result.get("ai_probability", 0.0))
    real_probability = max(0.0, 1.0 - ai_probability)

    if ai_probability >= CNN_THRESHOLD:
        label = "AI GENERATED"
    elif ai_probability >= 0.4:
        label = "SUSPICIOUS"
    else:
        label = "LIKELY REAL"

    payload = {
        "label": label,
        "ai_probability": ai_probability,
        "real_probability": real_probability,
        "threshold": CNN_THRESHOLD,
        "model": "Veridex CNN (ResNet50)",
        "weights": "resnet50_veridex.pt",
        "raw_score": result.get("score", int(ai_probability * 100)),
    }
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())