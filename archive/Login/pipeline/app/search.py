import requests
from .config import SERPER_API_KEY, TIMEOUT

URL = "https://google.serper.dev/images"

def _single_search(query, num=10):
    headers = {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json"
    }

    try:
        res = requests.post(URL, json={"q": query, "num": num}, headers=headers, timeout=TIMEOUT)
        if res.status_code != 200:
            return []
        return res.json().get("images", [])
    except:
        return []

def search_images_from_captions(captions):
    queries = []
    for cap in captions:
        queries += [
            cap,
            f"{cap} building",
            f"{cap} exterior",
            f"{cap} campus"
        ]

    results = []
    for q in queries:
        results += _single_search(q)

    seen, unique = set(), []
    for r in results:
        url = r.get("imageUrl")
        if url and url not in seen:
            seen.add(url)
            unique.append(r)

    return unique