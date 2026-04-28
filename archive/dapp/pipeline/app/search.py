import requests

SERPER_API_KEY = ""
TIMEOUT = 10


def find_similar(clip_vec: list[float], num: int = 10) -> list[str]:
    if not SERPER_API_KEY:
        return []
    headers = {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json"
    }
    try:
        query = " ".join(map(str, clip_vec[:10])) + " image"
        res = requests.post(
            "https://google.serper.dev/images",
            json={"q": query, "num": num},
            headers=headers,
            timeout=TIMEOUT
        )
        if res.status_code != 200:
            return []
        return [r.get("imageUrl", "") for r in res.json().get("images", []) if r.get("imageUrl")]
    except:
        return []