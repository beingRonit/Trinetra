import cv2
import numpy as np
from io import BytesIO
from PIL import Image

FORENSIC_MAX_SCORE = 35

def analyze_forensics(image_bytes: bytes) -> dict:
    score = 0
    flags = []

    img_pil = Image.open(BytesIO(image_bytes)).convert("RGB")
    img_np = np.array(img_pil)

    ela_score = _ela_analysis(image_bytes, img_pil)
    if ela_score > 0.85:
        score += 15
        flags.append(f"ela_anomaly:{ela_score:.2f}")

    noise_score = _noise_analysis(img_np)
    # Graduated scoring instead of hard binary cutoff
    if noise_score < 0.002:
        score += 10   # Very suspicious (extremely smooth = AI)
        flags.append(f"very_low_sensor_noise:{noise_score:.4f}")
    elif noise_score < 0.008:
        score += 5    # Mildly suspicious
        flags.append(f"low_sensor_noise:{noise_score:.4f}")
    # Above 0.008 = normal real photo noise, no flag

    fft_score = _fft_grid_artifact(img_np)
    if fft_score > 0.8:
        score += 5
        flags.append(f"fft_grid_artifact:{fft_score:.2f}")

    dct_score = _dct_analysis(img_np)
    if dct_score > 0.7:
        score += 10
        flags.append(f"dct_artifact:{dct_score:.2f}")

    color_consistency = _color_consistency_analysis(img_np)
    if color_consistency < 0.3:
        score += 5
        flags.append(f"inconsistent_color:{color_consistency:.2f}")

    score = min(score, FORENSIC_MAX_SCORE)
    return {"score": score, "flags": flags}


def _ela_analysis(image_bytes: bytes, original_pil: Image.Image) -> float:
    from PIL import Image as PILImage
    from io import BytesIO
    import numpy as np

    # Detect original format
    try:
        temp = PILImage.open(BytesIO(image_bytes))
        fmt = temp.format  # 'JPEG', 'PNG', 'WEBP', etc.
    except Exception:
        fmt = "JPEG"

    buffer = BytesIO()

    if fmt == "JPEG":
        # Standard ELA: re-save at lower quality, measure diff
        original_pil.save(buffer, format="JPEG", quality=75)
    elif fmt == "PNG":
        # Re-save PNG with compression, measure diff
        original_pil.save(buffer, format="PNG", compress_level=9)
    elif fmt == "WEBP":
        # Re-save WEBP at lower quality
        original_pil.save(buffer, format="WEBP", quality=75)
    else:
        # Unknown format: skip ELA, return neutral score
        return 0.5

    buffer.seek(0)
    resaved = PILImage.open(buffer).convert("RGB")

    ela_img = np.abs(np.array(original_pil).astype(int) - np.array(resaved).astype(int))
    return float(np.mean(ela_img) / 255.0)


def _noise_analysis(img_np: np.ndarray) -> float:
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY).astype(float)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    variance = laplacian.var()
    return min(variance / 1000.0, 1.0)


def _fft_grid_artifact(img_np: np.ndarray) -> float:
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY).astype(float)
    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    magnitude = np.log(np.abs(fshift) + 1)

    h, w = magnitude.shape
    center_h, center_w = h // 2, w // 2
    center_region = magnitude[center_h-10:center_h+10, center_w-10:center_w+10]
    outer_region = magnitude.copy()
    outer_region[center_h-10:center_h+10, center_w-10:center_w+10] = 0

    ratio = float(np.max(outer_region) / (np.mean(outer_region) + 1e-6))
    return min(ratio / 20.0, 1.0)


def _dct_analysis(img_np: np.ndarray) -> float:
    """Detect JPEG compression artifacts using DCT analysis"""
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY).astype(np.float32)
    
    h, w = gray.shape
    h = (h // 8) * 8
    w = (w // 8) * 8
    gray = gray[:h, :w]
    
    blocks = []
    for i in range(0, h - 7, 8):
        for j in range(0, w - 7, 8):
            block = gray[i:i+8, j:j+8]
            dct = cv2.dct(block)
            blocks.append(dct[0, 1] + dct[1, 0])
    
    if not blocks:
        return 0.0
    
    blocks = np.array(blocks)
    variance = np.var(blocks)
    mean = np.mean(np.abs(blocks))
    
    score = min(variance / (mean + 1e-6) / 10.0, 1.0)
    return score


def _color_consistency_analysis(img_np: np.ndarray) -> float:
    """Check color channel consistency - AI images often have inconsistencies"""
    channels = cv2.split(img_np)
    
    means = [np.mean(ch) for ch in channels]
    stds = [np.std(ch) for ch in channels]
    
    mean_ratio = max(means) / (min(means) + 1e-6)
    std_ratio = max(stds) / (min(stds) + 1e-6)
    
    consistency = 1.0 / (mean_ratio * std_ratio)
    return min(consistency, 1.0)