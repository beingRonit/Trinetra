import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.intelligence_engine import analyze_image_bytes  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: integration_predict.py <image_path>"}))
        return 1

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(json.dumps({"error": f"Image not found: {image_path}"}))
        return 1

    with image_path.open("rb") as handle:
        payload = analyze_image_bytes(handle.read(), filename=image_path.name)
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
