import io
from PIL import Image

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
MAX_SIZE_MB = 20
MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
MIN_DIM = 32
MAX_DIM = 16384

JPEG_SIGNATURES = [b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"\xff\xd8\xff\xdb", b"\xff\xd8\xff\xe2"]
PNG_SIGNATURE = b"\x89PNG"
WEBP_SIGNATURE = b"RIFF"


def _detect_mime(data: bytes) -> str:
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:4] == PNG_SIGNATURE:
        return "image/png"
    if data[:4] == WEBP_SIGNATURE and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] == b"GIF87a" or data[:6] == b"GIF89a":
        return "image/gif"
    if data[:2] == b"BM":
        return "image/bmp"
    return "application/octet-stream"


class ImageValidationError(Exception):
    pass


def validate_image(file_obj: io.BytesIO, filename: str = "") -> dict:
    file_obj.seek(0)
    data = file_obj.getvalue()

    if len(data) > MAX_SIZE_BYTES:
        raise ImageValidationError(f"File exceeds {MAX_SIZE_MB}MB limit ({len(data)} bytes)")

    mime = _detect_mime(data)

    if filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext in ALLOWED_EXT:
            mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext[1:], mime)

    if mime not in ALLOWED_MIME:
        raise ImageValidationError(f"Unsupported file type: {mime}")

    file_obj.seek(0)
    img = Image.open(file_obj)

    width, height = img.size
    if width < MIN_DIM or height < MIN_DIM:
        raise ImageValidationError(f"Image too small: {width}x{height}")
    if width > MAX_DIM or height > MAX_DIM:
        raise ImageValidationError(f"Image too large: {width}x{height}")

    return {
        "mime": mime,
        "width": width,
        "height": height,
        "size_bytes": len(data),
    }