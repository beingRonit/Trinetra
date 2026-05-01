import os
import requests
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO
import torch
import clip
from transformers import BlipProcessor, BlipForConditionalGeneration
from takedown import trigger_takedown

# ------------------ ENV ------------------
load_dotenv()
API_KEY = os.getenv("SERPER_API_KEY")

# ------------------ DEVICE ------------------
device = "cuda" if torch.cuda.is_available() else "cpu"

# ------------------ MODELS ------------------
print("🔄 Loading models...")

clip_model, preprocess = clip.load("ViT-B/32", device=device)

processor = BlipProcessor.from_pretrained(
    "Salesforce/blip-image-captioning-base",
    backend="pil",
)
blip_model = BlipForConditionalGeneration.from_pretrained(
    "Salesforce/blip-image-captioning-base"
).to(device)

print("✅ Models loaded\n")

# ------------------ CAPTION ------------------
def generate_caption(image):
    inputs = processor(image, return_tensors="pt").to(device)
    out = blip_model.generate(**inputs, max_new_tokens=30)
    return processor.decode(out[0], skip_special_tokens=True)

# ------------------ DOMAIN ------------------
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

    return DOMAIN_LABELS[similarity.argmax().item()]

# ------------------ SERPER ------------------
def serper_search(query):
    url = "https://google.serper.dev/images"

    headers = {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json"
    }

    try:
        res = requests.post(url, headers=headers, json={"q": query, "num": 5})
        return res.json().get("images", [])
    except:
        return []

# ------------------ SIMILARITY ------------------
def compute_similarity(input_image, image_url):
    try:
        res = requests.get(image_url, timeout=5)
        img = Image.open(BytesIO(res.content)).convert("RGB")

        img1 = preprocess(input_image).unsqueeze(0).to(device)
        img2 = preprocess(img).unsqueeze(0).to(device)

        with torch.no_grad():
            f1 = clip_model.encode_image(img1)
            f2 = clip_model.encode_image(img2)

            f1 /= f1.norm(dim=-1, keepdim=True)
            f2 /= f2.norm(dim=-1, keepdim=True)

            return (f1 @ f2.T).item()

    except:
        return 0

# ------------------ MAIN ------------------
def run_pipeline(image_path):
    if not os.path.exists(image_path):
        print("❌ Image not found")
        return

    image = Image.open(image_path).convert("RGB")
    print(f"\n📥 Loaded: {image_path}")

    caption = generate_caption(image)
    domain = detect_domain(image)
    query = f"{caption} {domain}"

    print(f"🧠 {caption}")
    print(f"🎯 {domain}")
    print(f"🔍 {query}")

    results = serper_search(query)

    best_match = None
    best_score = 0

    for r in results:
        url = r.get("imageUrl")
        if not url:
            continue

        score = compute_similarity(image, url)
        print(f"🧮 {score:.3f} → {url}")

        if score > best_score:
            best_score = score
            best_match = url

    # 🔥 ONLY ONE EMAIL
    if best_match and best_score > 0.90:
        print("\n🚨 BEST MATCH FOUND")
        trigger_takedown(best_match, image_path, best_score)
    else:
        print("\n❌ No strong match")


if __name__ == "__main__":
    path = input("Enter image path: ")
    run_pipeline(path)
