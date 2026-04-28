"""
Bootstrap XGBoost with synthetic score patterns.
Run ONCE before collecting real feedback.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pickle
import xgboost as xgb
from pathlib import Path

# Synthetic training data based on known patterns
# Format: [meta_score, forensic_score, classifier_score, similarity_score]
# Label: 1 = AI, 0 = Real

np.random.seed(42)

# AI images: high classifier, high forensic, low/no metadata, sometimes high similarity
ai_samples = np.column_stack([
    np.random.uniform(15, 30, 300),   # meta: missing camera data → high
    np.random.uniform(20, 35, 300),   # forensic: artifacts
    np.random.uniform(25, 40, 300),   # classifier: CNN says AI
    np.random.uniform(8, 15, 300),    # similarity: close to known AI
])

# Real images: low across all (has EXIF, natural noise, CNN says real, not similar to AI db)
real_samples = np.column_stack([
    np.random.uniform(0, 10, 300),    # meta: has camera info
    np.random.uniform(0, 15, 300),    # forensic: natural noise
    np.random.uniform(0, 15, 300),    # classifier: CNN says real
    np.random.uniform(0, 5, 300),     # similarity: not in AI db
])

X = np.vstack([ai_samples, real_samples]).astype(np.float32)
y = np.array([1]*300 + [0]*300, dtype=np.int32)

# Shuffle
idx = np.random.permutation(len(X))
X, y = X[idx], y[idx]

model = xgb.XGBClassifier(
    n_estimators=100,
    max_depth=4,
    learning_rate=0.05,
    scale_pos_weight=1.0,
    eval_metric="logloss",
    random_state=42
)
model.fit(X, y)

acc = (model.predict(X) == y).mean()
print(f"Bootstrap training accuracy: {acc:.1%}")

output = Path(__file__).parent.parent / "xgb_fusion.pkl"
with open(output, "wb") as f:
    pickle.dump(model, f)

print(f"Saved to {output}")
print("Now as real feedback comes in, it will retrain over this.")