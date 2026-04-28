from PIL import Image
import imagehash
from io import BytesIO


def compute(image_bytes: bytes) -> str:
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    return str(imagehash.phash(img))