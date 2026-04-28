from PIL import Image
from io import BytesIO
import requests
import logging
from typing import List, Dict, Any
from .vision_service import vision_service

logger = logging.getLogger(__name__)

class ComparisonService:
    @staticmethod
    def compare_with_results(
        original: Image.Image,
        results: List[Dict[str, Any]],
        threshold: float = 0.75
    ) -> List[Dict[str, Any]]:
        logger.info(f"Comparing {len(results)} results...")
        matches = []
        
        for i, result in enumerate(results):
            try:
                url = result.get("imageUrl")
                if not url:
                    continue
                
                resp = requests.get(url, timeout=5)
                candidate = Image.open(BytesIO(resp.content)).convert("RGB")
                
                similarity = vision_service.compute_similarity(original, candidate)
                
                if similarity >= threshold:
                    matches.append({
                        **result,
                        "similarity": similarity,
                        "match_type": "high" if similarity > 0.9 else "medium"
                    })
                    logger.info(f"  [{i+1}] {result.get('title')}: {similarity:.2%}")
                    
            except Exception as e:
                logger.warning(f"  [{i+1}] Skipped: {e}")
                continue
        
        logger.info(f"Found {len(matches)} matches above {threshold:.0%}")
        return matches

comparison_service = ComparisonService()