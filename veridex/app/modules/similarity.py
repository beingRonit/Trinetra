from typing import Any
import faiss
import numpy as np
import pickle
from app.models.vit_classifier import VITClassifier


_vit: VITClassifier | None = None
_index: Any | None = None
_hashes: list[str] | None = None


def _load() -> None:
    global _vit, _index, _hashes

    if _vit is None:
        _vit = VITClassifier()
        _index = faiss.read_index("faiss_ai_index.bin")
        with open("faiss_hashes.pkl", "rb") as f:
            _hashes = pickle.load(f)


def analyze_similarity(image_bytes: bytes) -> dict:
    _load()

    assert _vit is not None
    assert _index is not None
    assert _hashes is not None

    emb = np.array([_vit.embed(image_bytes)], dtype=np.float32)
    distances, indices = _index.search(emb, 5)
    avg_dist = float(np.mean(distances[0]))

    boost = max(0, int((1.0 - min(avg_dist / 2.0, 1.0)) * 15))
    flags: list[str] = []

    if boost > 8:
        flags.append(f"similar_to_known_ai:dist={avg_dist:.3f}")

    return {
        "score": boost,
        "flags": flags
    }