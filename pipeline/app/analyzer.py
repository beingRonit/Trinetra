def clamp01(value):
    return max(0.0, min(1.0, value))


def calibrate_clip_similarity(raw_clip):
    """
    Convert raw CLIP cosine similarity into a conservative 0..1 confidence.

    Unrelated images can still produce moderately positive cosine scores, so we
    avoid mapping [-1, 1] directly into [0, 1]. Instead we suppress the weak
    similarity band and only reward stronger semantic matches.
    """
    clipped = max(-1.0, min(1.0, raw_clip))
    floor = 0.22
    ceiling = 0.92
    if clipped <= floor:
        return 0.0
    if clipped >= ceiling:
        return 1.0
    return clamp01((clipped - floor) / (ceiling - floor))


def compute_match_score(clip, phash):
    """
    Blend semantic and pixel similarity while penalizing disagreement.
    """
    clip = clamp01(clip)
    phash = clamp01(phash)

    if phash >= 0.88:
        base = (clip * 0.52) + (phash * 0.48)
    elif phash >= 0.72:
        base = (clip * 0.58) + (phash * 0.42)
    else:
        base = (clip * 0.66) + (phash * 0.34)

    disagreement = abs(clip - phash)
    penalty = min(0.22, disagreement * 0.35)

    if clip < 0.70 and phash < 0.70:
        penalty += 0.10
    if clip > 0.90 and phash < 0.45:
        penalty += 0.06
    if phash > 0.90 and clip < 0.72:
        penalty += 0.05

    score = max(0.0, min(100.0, (base - penalty) * 100))
    # Cap at 95% to prevent false positives from self-comparison
    return min(score, 95.0)


def is_confident_external_match(final, clip, phash):
    clip = clamp01(clip)
    phash = clamp01(phash)
    return (
        final >= 68
        and (clip >= 0.80 or phash >= 0.76)
        and not (clip < 0.72 and phash < 0.72)
    )


def compute_risk_score(final, clip, phash):
    """
    Risk = probability of misuse (0-100)
    """
    if clip >= 0.96 and phash >= 0.94 and final >= 95:
        return 92

    if clip > 0.90 and phash < 0.45 and final >= 72:
        return 84

    if clip >= 0.88 and phash >= 0.76 and final >= 84:
        return 76

    if final >= 72:
        return 62

    return 24


def fraud_likelihood(risk_score):
    if risk_score >= 88:
        return "HIGH"
    if risk_score >= 72:
        return "HIGH"
    if risk_score >= 55:
        return "MEDIUM"
    return "LOW"


def get_action(risk_score, label):
    """
    Returns recommended action based on risk and classification.
    """
    if label == "EXACT MATCH" or risk_score >= 90:
        return "BLOCK"
    if label == "STRONG MATCH" or label == "CROPPED FRAUD":
        return "REVIEW"
    if label == "PARTIAL MATCH" or risk_score >= 55:
        return "WEB_SEARCH"
    return "PASS"


def generate_explanation(final, clip, phash):
    explanation = []

    if clip > 0.93:
        explanation.append("Very high semantic similarity (same object or scene)")
    elif clip > 0.82:
        explanation.append("Strong visual similarity")
    elif clip > 0.72:
        explanation.append("Moderate similarity in structure")

    if phash > 0.93:
        explanation.append("Images nearly identical at pixel level")
    elif phash < 0.45:
        explanation.append("Significant pixel-level differences")

    if clip > 0.90 and phash < 0.45:
        explanation.append("Possible cropped or modified reuse detected")

    if final < 68:
        explanation.append("Low confidence match")

    return " | ".join(explanation)


def score_matches(raw_matches):
    return raw_matches or []
