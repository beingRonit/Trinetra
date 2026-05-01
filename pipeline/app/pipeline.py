import os
import shutil
import hashlib

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
    calibrate_clip_similarity,
    compute_match_score,
    compute_risk_score,
    fraud_likelihood,
    generate_explanation,
    get_action,
    is_confident_external_match,
)
from .visualizer import create_full_image_comparison


LAST_RUN_SUMMARY = {
    "searched_candidates": 0,
    "downloaded_candidates": 0,
    "filtered_self_matches": 0,
    "scored_candidates": 0,
}


def get_last_run_summary():
    return dict(LAST_RUN_SUMMARY)


def _update_last_run_summary(**updates):
    LAST_RUN_SUMMARY.update(updates)


def compute_file_digest(path: str) -> str:
    """Compute SHA-256 digest of file contents for exact match detection."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_near_self_similarity(clip_score: float, phash_score: float) -> bool:
    return clip_score >= 0.985 and phash_score >= 0.95


def is_self_match(
    input_digest: str,
    candidate_path: str,
    clip_score: float,
    phash_score: float
) -> bool:
    """
    Check if a candidate is a self-match (same image or near-identical copy).

    A candidate is marked as self-match if:
    - Exact file digest match (same image file)
    - OR CLIP >= 0.985 AND pHash >= 0.95 (near-identical copy)
    """
    if is_near_self_similarity(clip_score, phash_score):
        return True

    candidate_digest = compute_file_digest(candidate_path)
    if input_digest == candidate_digest:
        return True

    return False


def _get_input_url(input_path: str) -> str | None:
    """Extract URL from input path if it's a URL rather than a local file."""
    if input_path.startswith(("http://", "https://")):
        return input_path
    return None


def _urls_match(url1: str, url2: str) -> bool:
    """Check if two URLs refer to the same image (ignoring query params and fragments)."""
    from urllib.parse import urlparse
    p1 = urlparse(url1)
    p2 = urlparse(url2)
    # Compare scheme + netloc + path (ignore query/fragment)
    return p1.scheme == p2.scheme and p1.netloc == p2.netloc and p1.path == p2.path


def classify(score, clip, phash):
    if score >= 95 and clip >= 0.96 and phash >= 0.94:
        return "EXACT MATCH"

    if score >= 84 and clip >= 0.88 and phash >= 0.76:
        return "STRONG MATCH"

    if score >= 72 and clip >= 0.90 and phash < 0.45:
        return "CROPPED FRAUD"

    if score >= 68 and clip >= 0.80:
        return "PARTIAL MATCH"

    return "WEAK"


async def run_pipeline_async(input_path):
    try:
        _update_last_run_summary(
            searched_candidates=0,
            downloaded_candidates=0,
            filtered_self_matches=0,
            scored_candidates=0,
        )
        if os.path.exists(TEMP_DIR):
            shutil.rmtree(TEMP_DIR, ignore_errors=True)
        os.makedirs(TEMP_DIR, exist_ok=True)

        print("Running pipeline...")

        captions = generate_captions(input_path)

        print("Captions:")
        for c in captions:
            print(" -", c)

        results = search_images_from_captions(captions)

        # Filter out self-matches by URL before downloading
        # This prevents comparing the input image against itself if it's already on the web
        input_url = _get_input_url(input_path)
        seen_urls = set()
        self_match_count = 0

        candidates = []
        for r in results:
            url = r.get("imageUrl")
            if not url:
                continue
            # Skip if URL matches input image URL (self-comparison prevention)
            if input_url and _urls_match(url, input_url):
                self_match_count += 1
                print(f"Self-match (URL) filtered: {url}")
                continue
            # Skip duplicate URLs in search results
            if url in seen_urls:
                continue
            seen_urls.add(url)
            candidates.append({
                "image": url,
                "source": r.get("link")
            })
            if len(candidates) >= MAX_RESULTS:
                break
        _update_last_run_summary(filtered_self_matches=self_match_count)
        _update_last_run_summary(searched_candidates=len(candidates))

        urls = [c["image"] for c in candidates]

        print(f"Downloading {len(urls)} images...")

        downloaded_paths = await download_images_async(urls)

        valid_pairs = []
        for i, path in enumerate(downloaded_paths):
            if path is not None:
                valid_pairs.append((path, candidates[i]))
        _update_last_run_summary(downloaded_candidates=len(valid_pairs))

        if not valid_pairs:
            print("No valid images downloaded")
            return []

        print(f"Valid images: {len(valid_pairs)}")

        input_emb = get_embedding(input_path)
        input_hash = get_phash(input_path)
        input_digest = compute_file_digest(input_path)

        scored = []
        self_match_count = 0

        for path, meta in valid_pairs:
            try:
                img_emb = get_embedding(path)

                full_clip = cosine_similarity(input_emb, img_emb)
                full_clip_norm = calibrate_clip_similarity(full_clip)

                ph = get_phash(path)
                phash_norm = phash_similarity(input_hash, ph)

                # Self-match guard: skip exact/near-self candidates
                if is_self_match(input_digest, path, full_clip_norm, phash_norm):
                    self_match_count += 1
                    print(f"Self-match filtered: {path} (CLIP={full_clip_norm:.4f}, pHash={phash_norm:.4f})")
                    continue

                # Defense in depth: near-self candidates should never flow into fraud scoring.
                if is_near_self_similarity(full_clip_norm, phash_norm):
                    self_match_count += 1
                    print(f"Near-self candidate filtered by score guard: {path} (CLIP={full_clip_norm:.4f}, pHash={phash_norm:.4f})")
                    continue

                final_score = compute_match_score(full_clip_norm, phash_norm)

                risk = compute_risk_score(final_score, full_clip_norm, phash_norm)
                fraud = fraud_likelihood(risk)
                explanation = generate_explanation(final_score, full_clip_norm, phash_norm)
                label = classify(final_score, full_clip_norm, phash_norm)
                action = get_action(risk, label)
                match_confident = is_confident_external_match(final_score, full_clip_norm, phash_norm)

                scored.append({
                    "path": path,
                    "source": meta["source"],
                    "raw_clip": full_clip,
                    "final": final_score,
                    "clip": full_clip_norm,
                    "full_clip": full_clip_norm,
                    "phash": phash_norm,
                    "risk": risk,
                    "fraud": fraud,
                    "explanation": explanation,
                    "label": label,
                    "action": action,
                    "match_confident": match_confident,
                })

            except Exception as e:
                print("Skipped image:", e)

        if self_match_count > 0:
            print(f"Filtered {self_match_count} self-match(es)")
        _update_last_run_summary(
            filtered_self_matches=self_match_count,
            scored_candidates=len(scored),
        )

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
