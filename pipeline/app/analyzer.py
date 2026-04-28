def compute_risk_score(final, clip, phash):
    """
    Risk = probability of misuse (0–100)
    """

    # CROPPED FRAUD: strong semantic but weak pixel similarity (likely cropped/re-sized)
    if clip > 0.9 and phash < 0.5:
        return 90

    # suspicious: strong semantic but weak pixel similarity
    if clip > 0.85 and phash < 0.5:
        return min(100, final + 10)

    # strong overall similarity
    if final > 85:
        return 85

    if final > 75:
        return 70

    return 40


def fraud_likelihood(risk_score):
    if risk_score >= 90:
        return "HIGH"
    elif risk_score >= 80:
        return "HIGH"
    elif risk_score >= 65:
        return "MEDIUM"
    else:
        return "LOW"


def get_action(risk_score, label):
    """
    Returns recommended action based on risk and classification.
    """
    if label == "EXACT MATCH" or risk_score >= 90:
        return "BLOCK"
    if label == "STRONG MATCH" or label == "CROPPED FRAUD":
        return "REVIEW"
    if label == "PARTIAL MATCH" or risk_score >= 65:
        return "WEB_SEARCH"
    return "PASS"


def generate_explanation(final, clip, phash):
    explanation = []

    # CLIP reasoning
    if clip > 0.9:
        explanation.append("Very high semantic similarity (same object/scene)")
    elif clip > 0.8:
        explanation.append("Strong visual similarity")
    elif clip > 0.7:
        explanation.append("Moderate similarity in structure")

    # pHash reasoning
    if phash > 0.9:
        explanation.append("Images nearly identical at pixel level")
    elif phash < 0.5:
        explanation.append("Significant pixel-level differences")

    # combined reasoning
    if clip > 0.85 and phash < 0.5:
        explanation.append("Possible cropped or modified reuse detected")

    if final < 70:
        explanation.append("Low confidence match")

    return " | ".join(explanation)


def score_matches(raw_matches):
    return raw_matches or []
