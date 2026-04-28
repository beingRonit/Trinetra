import torch
import clip
from PIL import Image
import requests
from io import BytesIO

# Load model once
device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)


def get_image_embedding(image):
    image = preprocess(image).unsqueeze(0).to(device)

    with torch.no_grad():
        embedding = model.encode_image(image)

    # Normalize (VERY IMPORTANT)
    embedding /= embedding.norm(dim=-1, keepdim=True)

    return embedding


def load_image_from_url(url):
    try:
        resp = requests.get(url, timeout=5)
        if "image" not in resp.headers.get("Content-Type", ""):
            return None
        return Image.open(BytesIO(resp.content)).convert("RGB")
    except:
        return None


def compute_similarity(img1, img2):
    emb1 = get_image_embedding(img1)
    emb2 = get_image_embedding(img2)

    similarity = (emb1 @ emb2.T).item()  # cosine similarity
    return similarity