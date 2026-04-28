from typing import cast
import torch
import torch.nn as nn
from torchvision import models, transforms
from torchvision.models import ResNet50_Weights
from PIL import Image
from io import BytesIO


class CNNClassifier:
    def __init__(self, weights_path: str | None = None):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        weights = ResNet50_Weights.IMAGENET1K_V2
        self.model = models.resnet50(weights=weights)
        self.model.fc = nn.Linear(self.model.fc.in_features, 2)

        if weights_path:
            state_dict = torch.load(weights_path, map_location=self.device)
            self.model.load_state_dict(state_dict)

        self.model.to(self.device)
        self.model.eval()

        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                [0.485, 0.456, 0.406],
                [0.229, 0.224, 0.225]
            )
        ])

    def predict(self, image_bytes: bytes) -> dict:
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        img_tensor = cast(torch.Tensor, self.transform(img))
        input_tensor = img_tensor.unsqueeze(0).to(self.device)

        with torch.no_grad():
            logits = self.model(input_tensor)
            probs = torch.softmax(logits, dim=1)[0]

        # Training uses label 0 for real images and label 1 for AI images.
        real_prob = float(probs[0].item())
        ai_prob = float(probs[1].item())

        return {
            "real_probability": real_prob,
            "ai_probability": ai_prob,
            "score": int(ai_prob * 40)
        }
