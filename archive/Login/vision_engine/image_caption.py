from transformers import BlipProcessor, BlipForConditionalGeneration
from PIL import Image
import torch

# Load model
device = "cuda" if torch.cuda.is_available() else "cpu"

processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base").to(device)


def generate_caption(image_path):
    image = Image.open(image_path).convert("RGB")

    inputs = processor(image, return_tensors="pt").to(device)

    out = model.generate(**inputs)

    caption = processor.decode(out[0], skip_special_tokens=True)

    return caption