import asyncio
import os
import requests
import uuid

from app import run_pipeline_async
from app.db import fetch_media_files, insert_scan_result

INPUT_DIR = "data/input"


def download_image(url):
    try:
        os.makedirs(INPUT_DIR, exist_ok=True)

        filename = f"{uuid.uuid4().hex}.jpg"
        file_path = os.path.join(INPUT_DIR, filename)

        response = requests.get(url, timeout=8)

        if response.status_code != 200:
            print(f"⚠️ Failed to fetch (status {response.status_code})")
            return None

        with open(file_path, "wb") as f:
            f.write(response.content)

        return file_path

    except Exception as e:
        print("❌ Download error:", e)
        return None


def main():
    print("📦 Fetching media files from DB...\n")

    rows = fetch_media_files(limit=5)

    if not rows:
        print("❌ No media files found")
        return

    for media_id, file_url in rows:
        print(f"\n🔍 Processing Media ID: {media_id}")

        if not file_url:
            print("⚠️ Missing URL")
            continue

        input_path = download_image(file_url)

        if not input_path:
            print("❌ Skipping (download failed)")
            continue

        try:
            results = asyncio.run(run_pipeline_async(input_path))
        except Exception as e:
            print("❌ Pipeline crashed:", e)
            continue

        if not results:
            print("❌ No results returned")
            continue

        best = results[0]

        print(f"🏆 Score: {best['final']:.2f}%")
        print(f"📊 Label: {best['label']}")
        print(f"⚠️ Risk: {best['risk']} ({best['fraud']})")

        # -------------------------------
        # STORE RESULT IN DB
        # -------------------------------
        try:
            insert_scan_result(
                media_id,
                best["final"],
                best["label"],
                best["risk"],
                best["fraud"]
            )
            print("💾 Stored in scan_results")
        except Exception as e:
            print("❌ DB insert failed:", e)

        # -------------------------------
        # SHOW VISUALIZATION
        # -------------------------------
        if "visual" in best:
            print(f"🖼️ Visualization: {best['visual']}")

        # -------------------------------
        # CLEANUP TEMP FILE
        # -------------------------------
        try:
            os.remove(input_path)
        except:
            pass

    print("\n✅ Batch completed")


if __name__ == "__main__":
    main()