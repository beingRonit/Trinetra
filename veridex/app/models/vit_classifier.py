from typing import Any, Callable, cast
import torch
import open_clip
from PIL import Image
from io import BytesIO


class VITClassifier:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        model, _, preprocess_val = open_clip.create_model_and_transforms(
            "ViT-L-14",
            pretrained="openai"
        )

        self.model: Any = model
        self.preprocess: Callable[[Image.Image], torch.Tensor] = cast(
            Callable[[Image.Image], torch.Tensor],
            preprocess_val
        )

        self.model.to(self.device).eval()

    def embed(self, image_bytes: bytes) -> list[float]:
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        tensor = self.preprocess(img).unsqueeze(0).to(self.device)

        with torch.no_grad():
            features: torch.Tensor = cast(torch.Tensor, self.model.encode_image(tensor))
            features = features / features.norm(dim=-1, keepdim=True)

        return cast(list[float], features[0].cpu().numpy().tolist())