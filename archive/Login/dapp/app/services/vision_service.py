import torch
from PIL import Image
from transformers import CLIPProcessor, CLIPModel, BlipProcessor, BlipForConditionalGeneration
import logging
import os

logger = logging.getLogger(__name__)

class VisionService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        logger.info("Loading models...")
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        self.clip_processor = CLIPProcessor.from_pretrained(
            os.getenv("CLIP_MODEL_ID", "openai/clip-vit-base-patch32")
        )
        self.clip_model = CLIPModel.from_pretrained(
            os.getenv("CLIP_MODEL_ID", "openai/clip-vit-base-patch32")
        ).to(self.device)
        self.clip_model.eval()
        
        self.blip_processor = BlipProcessor.from_pretrained(
            os.getenv("BLIP_MODEL_ID", "Salesforce/blip-image-captioning-base")
        )
        self.blip_model = BlipForConditionalGeneration.from_pretrained(
            os.getenv("BLIP_MODEL_ID", "Salesforce/blip-image-captioning-base")
        ).to(self.device)
        self.blip_model.eval()
        
        self.domain_labels = [
            "cricket stadium crowd", "football stadium", "concert crowd",
            "landscape nature", "city skyline", "sports broadcast"
        ]
        
        self._initialized = True
        logger.info("Models loaded")
    
    def generate_caption(self, image: Image.Image) -> str:
        try:
            inputs = self.blip_processor(image, return_tensors="pt").to(self.device)
            with torch.no_grad():
                out = self.blip_model.generate(**inputs, max_new_tokens=30)
            return self.blip_processor.decode(out[0], skip_special_tokens=True)
        except Exception as e:
            logger.error(f"Caption failed: {e}")
            raise
    
    def detect_domain(self, image: Image.Image) -> str:
        try:
            inputs = self.clip_processor(
                text=self.domain_labels, images=image, 
                return_tensors="pt", padding=True
            ).to(self.device)
            
            with torch.no_grad():
                outputs = self.clip_model(**inputs)
            
            probs = outputs.logits_per_image.softmax(dim=1)
            idx = probs.argmax(dim=1).item()
            return self.domain_labels[idx]
        except Exception as e:
            logger.error(f"Domain detection failed: {e}")
            raise
    
    def compute_similarity(self, img1: Image.Image, img2: Image.Image) -> float:
        try:
            inputs1 = self.clip_processor(images=img1, return_tensors="pt").to(self.device)
            inputs2 = self.clip_processor(images=img2, return_tensors="pt").to(self.device)
            
            with torch.no_grad():
                emb1 = self.clip_model.get_image_features(**inputs1)
                emb2 = self.clip_model.get_image_features(**inputs2)
                
                emb1 = emb1 / emb1.norm(dim=-1, keepdim=True)
                emb2 = emb2 / emb2.norm(dim=-1, keepdim=True)
                
                return (emb1 @ emb2.T).item()
        except Exception as e:
            logger.error(f"Similarity failed: {e}")
            raise

vision_service = VisionService()