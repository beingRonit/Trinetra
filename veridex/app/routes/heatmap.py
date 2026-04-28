from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
from app.utils.heatmap import generate_heatmap
import numpy as np

router = APIRouter()

# Cache for heatmaps
_heatmap_cache = {}

@router.post("/heatmap")
async def get_heatmap(file: UploadFile = File(...)):
    """Generate heatmap from uploaded image"""
    image_bytes = await file.read()
    # placeholder cam until you wire in the real GradCAM from CNN
    dummy_cam = np.random.rand(14, 14).astype(np.float32)
    heatmap_bytes = generate_heatmap(image_bytes, dummy_cam)
    return Response(content=heatmap_bytes, media_type="image/png")

@router.get("/heatmap/{image_hash}")
async def get_cached_heatmap(image_hash: str):
    """Retrieve cached heatmap by image hash"""
    if image_hash not in _heatmap_cache:
        raise HTTPException(status_code=404, detail="Heatmap not found. Please analyze image first.")
    heatmap_bytes = _heatmap_cache[image_hash]
    return Response(content=heatmap_bytes, media_type="image/png")

def cache_heatmap(image_hash: str, heatmap_bytes: bytes):
    """Store heatmap in cache"""
    _heatmap_cache[image_hash] = heatmap_bytes
    if len(_heatmap_cache) > 1000:
        # Remove oldest
        oldest = next(iter(_heatmap_cache))
        del _heatmap_cache[oldest]