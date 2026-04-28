from typing import Any
import torch
import numpy as np
import cv2
from PIL import Image
from io import BytesIO


class GradCAM:
    def __init__(self, model: torch.nn.Module, target_layer: torch.nn.Module):
        self.model = model
        self.target_layer = target_layer
        self.gradients: torch.Tensor | None = None
        self.activations: torch.Tensor | None = None

        self.target_layer.register_forward_hook(self._save_activation)
        self.target_layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(
        self,
        module: torch.nn.Module,
        inputs: Any,
        output: Any,
    ) -> None:
        if isinstance(output, torch.Tensor):
            self.activations = output.detach()
        else:
            self.activations = None

    def _save_gradient(
        self,
        module: torch.nn.Module,
        grad_input: Any,
        grad_output: Any,
    ) -> None:
        if isinstance(grad_output, tuple) and len(grad_output) > 0 and isinstance(grad_output[0], torch.Tensor):
            self.gradients = grad_output[0].detach()
        elif isinstance(grad_output, torch.Tensor):
            self.gradients = grad_output.detach()
        else:
            self.gradients = None

    def generate(self, tensor: torch.Tensor) -> np.ndarray:
        self.gradients = None
        self.activations = None

        output = self.model(tensor)
        self.model.zero_grad()
        output[0, output.argmax()].backward()

        if self.gradients is None:
            raise RuntimeError("Gradients were not captured. Check target_layer and hooks.")

        if self.activations is None:
            raise RuntimeError("Activations were not captured. Check target_layer and hooks.")

        weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        cam = (weights * self.activations).sum(dim=1).squeeze()
        cam = torch.relu(cam).detach().cpu().numpy()
        cam = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)

        return cam


def generate_heatmap(image_bytes: bytes, cam_array: np.ndarray) -> bytes:
    img = Image.open(BytesIO(image_bytes)).convert("RGB").resize((224, 224))
    img_np = np.array(img)

    heatmap = cv2.resize(cam_array, (224, 224))
    heatmap_uint8 = (heatmap * 255).astype(np.uint8)
    heatmap_color = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    heatmap_color = cv2.cvtColor(heatmap_color, cv2.COLOR_BGR2RGB)

    blended = cv2.addWeighted(img_np, 0.6, heatmap_color, 0.4, 0)
    result = Image.fromarray(blended)

    buf = BytesIO()
    result.save(buf, format="PNG")
    return buf.getvalue()