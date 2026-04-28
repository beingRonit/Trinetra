import io
import sys
from PIL import Image
import piexif

def run_ela_metadata(image_data: bytes) -> dict:
    import sys
    print("DEBUG metadata.py: Starting...")
    sys.stdout.flush()
    metadata = {
        "exif": {},
        "orientation": None,
    }

    try:
        exif_dict = piexif.load(io.BytesIO(image_data))
        print("DEBUG metadata.py: EXIF loaded")
        for ifd_name in ("0th", "Exif", "GPS", "1st"):
            if ifd_name in exif_dict:
                for tag_id, value in exif_dict[ifd_name].items():
                    metadata["exif"][str(tag_id)] = str(value)
    except Exception:
        pass

    try:
        print("DEBUG metadata.py: Opening image...")
        img = Image.open(io.BytesIO(image_data))
        print("DEBUG metadata.py: Image opened")
        if hasattr(img, "_getexif") and img._getexif():
            exif = img._getexif()
            if exif:
                metadata["orientation"] = exif.get(0x0112)
    except Exception as e:
        print(f"DEBUG metadata.py error: {e}")
        pass

    print("DEBUG metadata.py: Done")
    sys.stdout.flush()
    return metadata