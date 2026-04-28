import piexif
from PIL import Image
from io import BytesIO
from app.config import AI_SOFTWARE_TAGS, METADATA_MAX_SCORE

def analyze_metadata(image_bytes: bytes) -> dict:
    score = 0
    flags = []

    try:
        img = Image.open(BytesIO(image_bytes))
        exif_data = piexif.load(img.info.get("exif", b""))
    except Exception:
        return {"score": 20, "flags": ["could_not_read_exif"], "definitive": False}

    ifd0 = exif_data.get("0th", {})

    software_tag = ifd0.get(piexif.ImageIFD.Software, b"").decode("utf-8", errors="ignore").lower()
    make_tag = ifd0.get(piexif.ImageIFD.Make, b"").decode("utf-8", errors="ignore")
    model_tag = ifd0.get(piexif.ImageIFD.Model, b"").decode("utf-8", errors="ignore")

    # Check for known AI software
    for ai_tag in AI_SOFTWARE_TAGS:
        if ai_tag in software_tag:
            score += 30
            flags.append(f"ai_software_tag:{software_tag}")
            return {"score": score, "flags": flags, "definitive": True}

    # Missing camera make/model is suspicious
    if not make_tag and not model_tag:
        score += 5
        flags.append("no_camera_make_or_model")
    
    # Missing GPS on what looks like a real photo
    gps_data = exif_data.get("GPS", {})
    if not gps_data:
        score += 0
        flags.append("no_gps_data")

    # Cap at max
    score = min(score, METADATA_MAX_SCORE)

    return {
        "score": score,
        "flags": flags,
        "definitive": score >= 25
    }