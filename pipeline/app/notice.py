def generate_notice(evidence, target_url):
    return f"""
Subject: Copyright Infringement Notice

To whom it may concern,

I am the owner of the original image located at:
{evidence['input_image']}

It has come to my attention that a substantially similar or identical image appears at:
{target_url}

Evidence:
- Match Score: {evidence['score']}%
- Classification: {evidence['label']}

This use is unauthorized.

I request that you remove or disable access to this content immediately.

Regards,
Asset Protection System
"""


def generate_text(matches):
    if not matches:
        return "No evidence available."

    first = matches[0]
    evidence = {
        "input_image": "Registered asset",
        "score": getattr(first, "similarity_score", 0),
        "label": getattr(first, "label", "unknown"),
    }
    target_url = getattr(first, "url", "unknown")
    return generate_notice(evidence, target_url)
