from app.models.cnn_classifier import CNNClassifier
from app.config import CNN_THRESHOLD

_cnn = None

def get_cnn():
    global _cnn
    if _cnn is None:
        _cnn = CNNClassifier(weights_path="resnet50_veridex.pt")
    return _cnn

def analyze_classifier(image_bytes: bytes) -> dict:
    # Temporarily disabled due to untrained model and severe data imbalance
    # TODO: Re-enable after collecting balanced training data
    return {"score": 0, "flags": []}