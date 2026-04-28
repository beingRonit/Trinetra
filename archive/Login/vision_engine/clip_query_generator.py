import torch
import clip
from PIL import Image

# -------- LOAD MODEL --------
device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

# -------- PROMPTS --------
PROMPTS = [
    "IPL cricket stadium crowd night match",
    "cricket match broadcast screenshot",
    "cricket stadium full crowd fans cheering",
    "sports stadium audience night event",
    "football stadium crowd match",
    "concert crowd stage lights audience",
    "people crowd event outdoor night",
    "sports event stadium audience close view",
    "stadium spectators cheering crowd",
    "large audience watching sports match"
]

# -------- FUNCTION --------
def generate_queries(image_path, top_k=3):
    image = Image.open(image_path).convert("RGB")

    # ✅ THIS IS THE FIX
    image_input = preprocess(image).unsqueeze(0).to(device)

    text_tokens = clip.tokenize(PROMPTS).to(device)

    with torch.no_grad():
        image_features = model.encode_image(image_input)
        text_features = model.encode_text(text_tokens)

        # Normalize
        image_features /= image_features.norm(dim=-1, keepdim=True)
        text_features /= text_features.norm(dim=-1, keepdim=True)

        similarity = (image_features @ text_features.T).squeeze(0)

    top_indices = similarity.topk(top_k).indices

    queries = [PROMPTS[i] for i in top_indices]

    return queries