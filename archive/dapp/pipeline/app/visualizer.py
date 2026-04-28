import cv2
import numpy as np
from PIL import Image
from io import BytesIO


def generate(image_bytes: bytes, scored: list[dict]) -> bytes:
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    img_array = np.array(img)
    img_cv = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    h, w = img_cv.shape[:2]
    y_offset = max(h // 4, 30)
    cv2.putText(img_cv, "Match Report", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
    for i, m in enumerate(scored[:3]):
        text = f"{m.get('url', 'unknown')[:40]} - {m.get('similarity_score', 0):.2f}"
        cv2.putText(img_cv, text, (10, y_offset + 30 * (i + 1)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    _, buffer = cv2.imencode('.jpg', img_cv)
    return buffer.tobytes()