def compute_risk_score(final, clip, phash):
    if clip > 0.85 and phash < 0.5:
        return min(100, final + 10)
    if final > 85:
        return 85
    if final > 75:
        return 70
    return 40


def fraud_likelihood(risk_score):
    if risk_score >= 85:
        return "HIGH"
    elif risk_score >= 65:
        return "MEDIUM"
    return "LOW"


def score_matches(raw_matches: list[dict]) -> list[dict]:
    scored = []
    for match in raw_matches:
        final = match.get("final_score", 0) * 100
        clip_val = match.get("clip_score", 0)
        phash_val = match.get("phash_score", 0)
        risk = compute_risk_score(final, clip_val, phash_val)
        scored.append({
            "url": match.get("url", ""),
            "similarity_score": final / 100,
            "phash_distance": int((1 - phash_val) * 64),
            "label": fraud_likelihood(risk),
            "risk_level": fraud_likelihood(risk).lower(),
            "is_fraud": risk >= 70,
            "region_matches": [],
            "source_domain": match.get("url", "").split("/")[2] if "/" in match.get("url", "") else ""
        })
    return scored