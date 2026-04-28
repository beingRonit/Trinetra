import os
import requests
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO
import torch
import clip
from transformers import BlipProcessor, BlipForConditionalGeneration

# ------------------ LOAD ENV ------------------
load_dotenv()
API_KEY = os.getenv("SERPER_API_KEY")

if not API_KEY:
    print("❌ Missing SERPER_API_KEY in .env")
    exit()

# ------------------ DEVICE ------------------
device = "cuda" if torch.cuda.is_available() else "cpu"

# ------------------ LOAD MODELS ------------------
print("🔄 Loading models...")

# CLIP
clip_model, preprocess = clip.load("ViT-B/32", device=device)

# BLIP
processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
blip_model = BlipForConditionalGeneration.from_pretrained(
    "Salesforce/blip-image-captioning-base"
).to(device)

print("✅ Models loaded\n")

# ------------------ BLIP CAPTION ------------------
def generate_caption(image):
    inputs = processor(image, return_tensors="pt").to(device)
    out = blip_model.generate(**inputs, max_new_tokens=30)
    caption = processor.decode(out[0], skip_special_tokens=True)
    return caption

# ------------------ CLIP DOMAIN ------------------
DOMAIN_LABELS = [
    "cricket stadium crowd",
    "football stadium",
    "concert crowd",
    "landscape nature",
    "city skyline",
    "sports broadcast"
]

def detect_domain(image):
    image_input = preprocess(image).unsqueeze(0).to(device)
    text_tokens = clip.tokenize(DOMAIN_LABELS).to(device)

    with torch.no_grad():
        img_feat = clip_model.encode_image(image_input)
        txt_feat = clip_model.encode_text(text_tokens)

        img_feat /= img_feat.norm(dim=-1, keepdim=True)
        txt_feat /= txt_feat.norm(dim=-1, keepdim=True)

        similarity = (img_feat @ txt_feat.T).squeeze(0)

    best_idx = similarity.argmax().item()
    return DOMAIN_LABELS[best_idx]

# ------------------ SERPER ------------------
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

    try:
        response = requests.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            print("❌ API Error:", response.text)
            return []

        return response.json().get("images", [])

    except Exception as e:
        print("❌ Request failed:", e)
        return []

# ------------------ MAIN PIPELINE ------------------
def run_pipeline(image_path):
    image_path = image_path.strip().replace("\\", "/")

    if not os.path.exists(image_path):
        print(f"❌ Image not found: {image_path}")
        return

    try:
        image = Image.open(image_path).convert("RGB")
        print(f"\n📥 Image loaded: {image_path}")
    except Exception as e:
        print(f"❌ Failed to open image: {e}")
        return

    # Step 1: Caption
    caption = generate_caption(image)
    print(f"🧠 BLIP Caption: {caption}")

    # Step 2: Domain
    domain = detect_domain(image)
    print(f"🎯 CLIP Domain: {domain}")

    # Step 3: Build query
    query = f"{caption} {domain}"
    print(f"🔍 Final Query: {query}")

    # Step 4: Search
    results = serper_search(query)

    print(f"\n📡 Found {len(results)} results\n")

    for i, r in enumerate(results):
        print(f"[{i+1}] {r.get('title')}")
        print("Source:", r.get("source"))
        print("Image:", r.get("imageUrl"))
        print("-" * 40)

# ------------------ RUN ------------------
if __name__ == "__main__":
    user_input = input("\n📂 Enter image path (or filename): ")
    run_pipeline(user_input)