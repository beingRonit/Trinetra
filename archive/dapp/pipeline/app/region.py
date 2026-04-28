from PIL import Image
import torch
import clip
from io import BytesIO

device = "cuda" if torch.cuda.is_available() else "cpu"

try:
    clip_model, preprocess = clip.load("ViT-B/32", device=device)
except:
    clip_model = None
    preprocess = None


def extract_regions(image_bytes: bytes, grid: int = 2) -> list[list[float]]:
    if clip_model is None:
        raise NotImplementedError("CLIP model not loaded")
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    w, h = img.size
    pw, ph = w // grid, h // grid

    regions = []
    for i in range(grid):
        for j in range(grid):
            patch = img.crop((i * pw, j * ph, (i + 1) * pw, (j + 1) * ph))
            patch_tensor = preprocess(patch).unsqueeze(0).to(device)
            with torch.no_grad():
                emb = clip_model.encode_image(patch_tensor)
            normalized = emb / emb.norm(dim=-1, keepdim=True)
            regions.append(normalized.squeeze().cpu().tolist())

    return regions