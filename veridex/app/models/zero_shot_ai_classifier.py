from typing import Any, Callable, cast

import open_clip
import torch
from PIL import Image
from io import BytesIO


class ZeroShotAIClassifier:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model, _, preprocess_val = open_clip.create_model_and_transforms(
            "ViT-L-14",
            pretrained="openai",
        )
        self.model: Any = model
        self.preprocess: Callable[[Image.Image], torch.Tensor] = cast(
            Callable[[Image.Image], torch.Tensor],
            preprocess_val,
        )
        self.tokenizer = open_clip.get_tokenizer("ViT-L-14")
        self.model.to(self.device).eval()

        self.real_prompts = [
            "a real photograph of a person in a natural scene",
            "a real camera photo",
        ]
        self.ai_prompts = [
            "an AI generated portrait with synthetic details and unreal rendering",
            "a computer generated image",
        ]
        self.prompts = self.real_prompts + self.ai_prompts
        self.real_prompt_count = len(self.real_prompts)

    def predict(self, image_bytes: bytes) -> dict:
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        image_tensor = self.preprocess(img).unsqueeze(0).to(self.device)
        text_tokens = self.tokenizer(self.prompts).to(self.device)

        with torch.no_grad():
            image_features = cast(torch.Tensor, self.model.encode_image(image_tensor))
            text_features = cast(torch.Tensor, self.model.encode_text(text_tokens))
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            prompt_probs = (100.0 * image_features @ text_features.T).softmax(dim=-1)[0]

        real_probability = float(prompt_probs[:self.real_prompt_count].sum().item())
        ai_probability = float(prompt_probs[self.real_prompt_count:].sum().item())

        return {
            "real_probability": real_probability,
            "ai_probability": ai_probability,
            "prompt_breakdown": {
                prompt: float(score)
                for prompt, score in zip(self.prompts, prompt_probs.tolist())
            },
        }
