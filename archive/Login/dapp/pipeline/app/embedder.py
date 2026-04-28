import torch
import clip
from PIL import Image
from io import BytesIO

device = "cuda" if torch.cuda.is_available() else "cpu"

try:
    clip_model, preprocess = clip.load("ViT-B/32", device=device)
except:
    clip_model = None
    preprocess = None


def extract(image_bytes: bytes) -> list[float]:
    if clip_model is None:
        raise NotImplementedError("CLIP model not loaded")
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    img_tensor = preprocess(img).unsqueeze(0).to(device)
    with torch.no_grad():
        emb = clip_model.encode_image(img_tensor)
    normalized = emb / emb.norm(dim=-1, keepdim=True)
    return normalized.squeeze().cpu().tolist()