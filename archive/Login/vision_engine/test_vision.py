import requests
import os
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO

load_dotenv()

API_KEY = os.getenv("SERPER_API_KEY")

def serper_search(query):
    url = "https://google.serper.dev/images"

    payload = {
        "q": query,
        "num": 5
    }

    headers = {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=payload, headers=headers)

    if response.status_code != 200:
        print("❌ API Error:", response.text)
        return []

    return response.json().get("images", [])


def download_and_show(image_url):
    try:
        resp = requests.get(image_url, timeout=5)

        if "image" not in resp.headers.get("Content-Type", ""):
            print("⚠️ Not an image")
            return

        img = Image.open(BytesIO(resp.content))
        img.show()

    except Exception as e:
        print("❌ Failed to load image:", e)


if __name__ == "__main__":
    query = "Techno India University"

    print(f"\n🔍 Searching for: {query}")

    results = serper_search(query)

    print(f"\nFound {len(results)} results\n")

    for i, r in enumerate(results):
        print(f"[{i+1}] {r.get('title')}")
        print("Source:", r.get("source"))
        print("Image URL:", r.get("imageUrl"))

        if i < 2:
            download_and_show(r.get("imageUrl"))

        print("-" * 40)