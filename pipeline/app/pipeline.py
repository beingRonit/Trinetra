import os
import shutil

from .config import TEMP_DIR, MAX_RESULTS, DEBUG
from .embedder import (
    generate_captions,
    get_embedding
)
from .search import search_images_from_captions
from .downloader import download_images_async
from .phash import get_phash, phash_similarity
from .comparator import cosine_similarity
from .analyzer import (
    compute_risk_score,
    fraud_likelihood,
    generate_explanation,
    get_action
)
from .visualizer import create_full_image_comparison


def classify(score, clip, phash):
    if score >= 90 and phash > 0.9:
        return "EXACT MATCH"

    if clip > 0.85 and phash > 0.7:
        return "STRONG MATCH"

    if clip > 0.9 and phash < 0.4:
        return "CROPPED FRAUD"

    if clip > 0.75:
        return "PARTIAL MATCH"

    return "WEAK"


async def run_pipeline_async(input_path):
    try:
        if os.path.exists(TEMP_DIR):
            shutil.rmtree(TEMP_DIR, ignore_errors=True)
        os.makedirs(TEMP_DIR, exist_ok=True)

        print("Running pipeline...")

        captions = generate_captions(input_path)

        print("Captions:")
        for c in captions:
            print(" -", c)

        results = search_images_from_captions(captions)

        candidates = [
            {
                "image": r.get("imageUrl"),
                "source": r.get("link")
            }
            for r in results if r.get("imageUrl")
        ][:MAX_RESULTS]

        urls = [c["image"] for c in candidates]

        print(f"Downloading {len(urls)} images...")

        downloaded_paths = await download_images_async(urls)

        valid_pairs = []
        for i, path in enumerate(downloaded_paths):
            if path is not None:
                valid_pairs.append((path, candidates[i]))

        if not valid_pairs:
            print("No valid images downloaded")
            return []

        print(f"Valid images: {len(valid_pairs)}")

        input_emb = get_embedding(input_path)
        input_hash = get_phash(input_path)

        scored = []

        for path, meta in valid_pairs:
            try:
                img_emb = get_embedding(path)

                full_clip = cosine_similarity(input_emb, img_emb)

                # Full-image vector similarity is the primary scan signal.
                full_clip_norm = (full_clip + 1) / 2

                ph = get_phash(path)
                phash_norm = phash_similarity(input_hash, ph)

                if phash_norm > 0.9:
                    w_clip, w_phash = 0.5, 0.5
                else:
                    w_clip, w_phash = 0.7, 0.3

                final_score = (w_clip * full_clip_norm + w_phash * phash_norm) * 100

                risk = compute_risk_score(final_score, full_clip_norm, phash_norm)
                fraud = fraud_likelihood(risk)
                explanation = generate_explanation(final_score, full_clip_norm, phash_norm)
                label = classify(final_score, full_clip_norm, phash_norm)
                action = get_action(risk, label)

                scored.append({
                    "path": path,
                    "source": meta["source"],
                    "final": final_score,
                    "clip": full_clip_norm,
                    "full_clip": full_clip_norm,
                    "phash": phash_norm,
                    "risk": risk,
                    "fraud": fraud,
                    "explanation": explanation,
                    "label": label,
                    "action": action
                })

            except Exception as e:
                print("Skipped image:", e)

        if not scored:
            print("No scored results")
            return []

        scored.sort(key=lambda x: x["final"], reverse=True)

        best = scored[0]

        print(f"Best score: {best['final']:.2f}%")

        try:
            vis_path = create_full_image_comparison(
                input_path,
                best["path"]
            )
            best["visual"] = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "output", "comparison.jpg")
            print("Visualization saved:", best["visual"])

        except Exception as e:
            print("Visualization failed:", e)
            best["visual"] = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "output", "comparison.jpg")

        return scored

    finally:
        if not DEBUG:
            shutil.rmtree(TEMP_DIR, ignore_errors=True)
