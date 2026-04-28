# Weights must sum to 1.0
# CNN re-enabled: restore original design intent
WEIGHTS = {
    "metadata":   0.30,
    "forensic":   0.35,
    "classifier": 0.25,  # Re-enabled after training
    "similarity": 0.10
}

# Score maxes per module
SCORE_MAX = {
    "metadata":   30,
    "forensic":   35,
    "classifier": 40,
    "similarity": 15
}

def fuse_scores(meta_score, forensic_score, classifier_score, similarity_score) -> int:
    scores = {
        "metadata":   meta_score,
        "forensic":   forensic_score,
        "classifier": classifier_score,
        "similarity": similarity_score
    }

    # Normalize each to 0-1, then weight
    normalized = sum(
        (scores[k] / SCORE_MAX[k]) * WEIGHTS[k]
        for k in WEIGHTS
    ) * 100

    return min(int(normalized), 100)