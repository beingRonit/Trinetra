import os
from datetime import datetime

def build_evidence(input_path, best_result):
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "input_image": input_path,
        "matched_image": best_result["path"],
        "score": round(best_result["final"], 2),
        "clip": round(best_result["clip"], 3),
        "phash": round(best_result["phash"], 3),
        "label": best_result["label"]
    }