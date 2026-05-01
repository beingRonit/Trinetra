from app.analyzer import (
    calibrate_clip_similarity,
    compute_match_score,
    is_confident_external_match,
)


def test_calibrate_clip_similarity_suppresses_weak_cosine():
    assert calibrate_clip_similarity(0.10) == 0.0
    assert calibrate_clip_similarity(0.22) == 0.0
    assert calibrate_clip_similarity(0.92) == 1.0


def test_compute_match_score_penalizes_disagreement():
    aligned = compute_match_score(0.90, 0.88)
    conflicted = compute_match_score(0.90, 0.35)
    assert aligned > conflicted


def test_is_confident_external_match_requires_strong_signal():
    assert is_confident_external_match(84, 0.90, 0.80) is True
    assert is_confident_external_match(63, 0.78, 0.60) is False
    assert is_confident_external_match(72, 0.68, 0.69) is False
