def generate_text(scored: list[dict]) -> str:
    if not scored:
        return "No matches found."
    lines = ["Copyright Infringement Notice", "", "Matches detected:"]
    for m in scored[:5]:
        lines.append(f"- URL: {m.get('url', 'unknown')}")
        lines.append(f"  Score: {m.get('similarity_score', 0):.2%}")
        lines.append(f"  Risk: {m.get('risk_level', 'unknown').upper()}")
        lines.append("")
    return "\n".join(lines)