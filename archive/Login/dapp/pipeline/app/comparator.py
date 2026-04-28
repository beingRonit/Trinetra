import torch
from PIL import Image
import imagehash
from io import BytesIO

device = "cuda" if torch.cuda.is_available() else "cpu"

try:
    clip_model, preprocess = clip.load("ViT-B/32", device=device)
except:
    clip_model = None


def cosine_similarity(a, b):
    return torch.nn.functional.cosine_similarity(a, b.unsqueeze(0)).item()


def compare_all(source_bytes, source_phash, source_clip, source_regions, candidate_urls) -> list[dict]:
    if clip_model is None:
        return []
    results = []
    for url in candidate_urls:
        try:
            resp = requests.get(url, timeout=10)
            img = Image.open(BytesIO(resp.content)).convert("RGB")
            tensor = preprocess(img).unsqueeze(0).to(device)
            with torch.no_grad():
                emb = clip_model.encode_image(tensor)
            normalized = emb / emb.norm(dim=-1, keepdim=True)
            clip_sim = cosine_similarity(normalized.squeeze(), torch.tensor(source_clip).to(device))
            phash_sim = 1 - (imagehash.phash(img) - imagehash.hex_to_hash(source_phash)) / 64
            results.append({
                "url": url,
                "clip_score": clip_sim,
                "phash_score": phash_sim,
                "final_score": (clip_sim + phash_sim) / 2
            })
        except:
            pass
    return results