import hashlib
import os
import pickle
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Depends, Security
from fastapi.security.api_key import APIKeyHeader
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.modules.metadata import analyze_metadata
from app.modules.forensics import analyze_forensics
from app.modules.classifier import analyze_classifier
from app.modules.similarity import analyze_similarity
from app.modules.fusion import fuse_scores
from app.config import API_KEY
from app.utils.heatmap import generate_heatmap, GradCAM

limiter = Limiter(key_func=get_remote_address)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler("veridex.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

router = APIRouter()

executor = ThreadPoolExecutor(max_workers=4)

ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
MAX_SIZE_MB = 10

api_key_header = APIKeyHeader(name="X-API-Key")

def verify_api_key(key: str = Security(api_key_header)):
    if key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")

_xgb_model = None

_result_cache = {}

def _get_xgb_model():
    global _xgb_model
    if _xgb_model is None:
        if os.path.exists("xgb_fusion.pkl"):
            with open("xgb_fusion.pkl", "rb") as f:
                _xgb_model = pickle.load(f)
    return _xgb_model

def _score_to_label(score: int) -> str:
    if score >= 80:
        return "FAKE"
    elif score >= 50:
        return "SUSPICIOUS"
    else:
        return "LIKELY REAL"

def _get_cached_result(image_hash: str):
    if image_hash in _result_cache:
        logger.info(f"Cache hit for image: {image_hash}")
        result = _result_cache[image_hash].copy()
        result["cached"] = True
        return result
    return None

def _cache_result(image_hash: str, result: dict):
    _result_cache[image_hash] = result
    if len(_result_cache) > 10000:
        oldest = next(iter(_result_cache))
        del _result_cache[oldest]

@router.post("/analyze")
@limiter.limit("100/minute")
async def analyze_image(request: Request, file: UploadFile = File(...), api_key: str = Depends(verify_api_key)):
    content_type = file.content_type
    
    if content_type is None:
        content_type = "image/webp"
    
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Only JPEG, PNG, WebP allowed. Got: {content_type}")
    
    image_bytes = await file.read()
    
    if len(image_bytes) > MAX_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max {MAX_SIZE_MB}MB")
    
    image_hash = hashlib.sha256(image_bytes).hexdigest()
    
    cached_result = _get_cached_result(image_hash)
    if cached_result:
        return cached_result
    
    logger.info(f"Started analysis for image: {image_hash}")
    
    loop = asyncio.get_event_loop()
    
    meta_fut = loop.run_in_executor(executor, analyze_metadata, image_bytes)
    forensic_fut = loop.run_in_executor(executor, analyze_forensics, image_bytes)
    classifier_fut = loop.run_in_executor(executor, analyze_classifier, image_bytes)
    
    meta, forensic, classifier = await asyncio.gather(
        meta_fut, forensic_fut, classifier_fut
    )
    
    if meta["definitive"]:
        logger.info(f"Early exit - definitive metadata for {image_hash}: score={meta['score']}")
        return {
            "image_hash": image_hash,
            "risk_score": meta["score"],
            "confidence": "HIGH",
            "label": _score_to_label(meta["score"]),
            "reason": meta["flags"],
            "heatmap_url": None,
            "meta_score": meta["score"],
            "forensic_score": 0,
            "classifier_score": 0,
            "similarity_score": 0,
            "skipped_modules": ["forensic", "classifier", "similarity"]
        }
    
    similarity = await loop.run_in_executor(executor, analyze_similarity, image_bytes)
    
    xgb_model = _get_xgb_model()
    if xgb_model:
        import numpy as np
        features = np.array([[meta["score"], forensic["score"], classifier["score"], similarity["score"]]], dtype=np.float32)
        ai_prob = float(xgb_model.predict_proba(features)[0][1])
        risk_score = int(ai_prob * 100)
    else:
        risk_score = fuse_scores(
            meta["score"],
            forensic["score"],
            classifier["score"],
            similarity["score"]
        )
    
    all_flags = meta["flags"] + forensic["flags"] + classifier["flags"] + similarity["flags"]
    confidence = "HIGH" if meta["definitive"] else ("MEDIUM" if risk_score > 40 else "LOW")
    
    # Generate explanations for each component
    reasons = []
    
    if meta["score"] > 50:
        reasons.append(f"Metadata analysis: {meta['score']}% anomaly")
    if forensic["score"] > 50:
        reasons.append(f"Forensic artifacts: {forensic['score']}% suspicious")
    if classifier["score"] > 50:
        reasons.append(f"CNN AI probability: {classifier['score']}%")
    if similarity["score"] > 50:
        reasons.append(f"Similarity match: {similarity['score']}%")
    
    # Determine highest impact
    scores = {
        "Metadata": meta["score"],
        "Forensics": forensic["score"],
        "Classifier": classifier["score"],
        "Similarity": similarity["score"]
    }
    top_component = max(scores, key=scores.get)
    if scores[top_component] > 40:
        reasons.append(f"Highest impact: {top_component} ({scores[top_component]}%)")
    
    # Generate heatmap for suspicious/fake images
    heatmap_url = None
    if risk_score >= 40:
        try:
            heatmap_url = f"/api/heatmap/{image_hash[:16]}"
        except Exception as e:
            logger.warning(f"Heatmap generation failed: {e}")
    
    result = {
        "image_hash": image_hash,
        "risk_score": risk_score,
        "confidence": confidence,
        "label": _score_to_label(risk_score),
        "reason": reasons,
        "heatmap_url": heatmap_url,
        "meta_score": meta["score"],
        "forensic_score": forensic["score"],
        "classifier_score": classifier["score"],
        "similarity_score": similarity["score"],
        "component_breakdown": {
            "metadata": meta["score"],
            "forensics": forensic["score"],
            "classifier": classifier["score"],
            "similarity": similarity["score"]
        }
    }
    
    _cache_result(image_hash, result)
    logger.info(f"Analyzed image {image_hash} | score={risk_score} | label={_score_to_label(risk_score)}")
    
    return result
