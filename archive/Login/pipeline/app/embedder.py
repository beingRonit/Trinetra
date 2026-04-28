import torch
import io
import clip
from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration, AutoImageProcessor, AutoModel

print("Loading CLIP model...")
device = "cuda" if torch.cuda.is_available() else "cpu"

clip_model, preprocess = clip.load("ViT-B/32", device=device)
clip_model.eval()
print("CLIP loaded")

print("Loading BLIP model...")
try:
    blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base", use_fast=False)
    blip_model = BlipForConditionalGeneration.from_pretrained(
        "Salesforce/blip-image-captioning-base"
    ).to(device)
    blip_model.eval()
    print("BLIP loaded")
except Exception as e:
    print(f"BLIP load error: {e}, disabling BLIP")
    blip_processor = None
    blip_model = None


def get_embedding(path):
    img = preprocess(Image.open(path).convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        emb = clip_model.encode_image(img)
    return emb / emb.norm(dim=-1, keepdim=True)


def get_embedding_from_image(img):
    img = preprocess(img).unsqueeze(0).to(device)
    with torch.no_grad():
        emb = clip_model.encode_image(img)
    return emb / emb.norm(dim=-1, keepdim=True)


def get_embedding_from_bytes(data: bytes):
    try:
        img = preprocess(Image.open(io.BytesIO(data)).convert("RGB")).unsqueeze(0).to(device)
        with torch.no_grad():
            emb = clip_model.encode_image(img)
        return emb / emb.norm(dim=-1, keepdim=True)
    except Exception as e:
        print(f"ERROR in get_embedding_from_bytes: {e}")
        import traceback
        traceback.print_exc()
        raise


def generate_captions(path):
    img = Image.open(path).convert("RGB")
    inputs = blip_processor(img, return_tensors="pt").to(device)

    captions = []
    with torch.no_grad():
        outputs = blip_model.generate(
            **inputs,
            max_new_tokens=30,
            num_beams=5,
            num_return_sequences=3
        )

    for o in outputs:
        captions.append(blip_processor.decode(o, skip_special_tokens=True).lower().strip())

    return list(set(captions))


def generate_captions_from_bytes(data: bytes):
    if blip_processor is None or blip_model is None:
        return ["caption unavailable"]
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        inputs = blip_processor(img, return_tensors="pt").to(device)

        captions = []
        with torch.no_grad():
            outputs = blip_model.generate(
                **inputs,
                max_new_tokens=30,
                num_beams=5,
                num_return_sequences=3
            )

        for o in outputs:
            captions.append(blip_processor.decode(o, skip_special_tokens=True).lower().strip())

        return list(set(captions))
    except Exception as e:
        print(f"BLIP caption error: {e}")
        return ["caption unavailable"]