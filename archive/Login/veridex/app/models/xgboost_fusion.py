import pickle
import numpy as np

_model = None

def load_xgb():
    global _model
    if _model is None:
        try:
            with open("xgb_fusion.pkl", "rb") as f:
                _model = pickle.load(f)
        except FileNotFoundError:
            _model = None
    return _model

def xgb_fuse(meta, forensic, classifier, similarity) -> int:
    model = load_xgb()
    if model is None:
        # Fall back to simple weighted sum from Phase 5
        from app.modules.fusion import fuse_scores
        return fuse_scores(meta, forensic, classifier, similarity)

    features = np.array([[meta, forensic, classifier, similarity]], dtype="float32")
    prob = float(model.predict_proba(features)[0][1])
    return int(prob * 100)