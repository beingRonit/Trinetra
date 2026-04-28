import io
from PIL import Image
import imagehash


def get_phash(path):
    return imagehash.phash(Image.open(path).convert("RGB"))


def get_phash_from_bytes(data: bytes):
    return imagehash.phash(Image.open(io.BytesIO(data)).convert("RGB"))


def compute(data: bytes) -> str:
    return str(get_phash_from_bytes(data))


def phash_similarity(h1, h2):
    return 1 - (h1 - h2) / 64
