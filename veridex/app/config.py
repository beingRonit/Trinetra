import os
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
STORAGE_DIR = BASE_DIR / "app" / "storage"

# Feedback image storage paths
FEEDBACK_IMAGE_DIR = {
    "AI": DATA_DIR / "train" / "ai" / "feedback",
    "REAL": DATA_DIR / "train" / "real" / "feedback",
    "EDITED": DATA_DIR / "train" / "real" / "feedback",  # Treat edited as real
}

# Staging directory for pending feedback
FEEDBACK_STAGING_DIR = STORAGE_DIR / "feedback_staging"

# Retraining settings
RETRAIN_BATCH_SIZE = 10  # Retrain after every N feedback samples
MIN_FEEDBACK_SAMPLES = 10  # Minimum samples for initial training

# CNN settings
CNN_THRESHOLD = 0.7  # CNN probability threshold for AI flag

# Ensure directories exist
for path in FEEDBACK_IMAGE_DIR.values():
    path.mkdir(parents=True, exist_ok=True)
FEEDBACK_STAGING_DIR.mkdir(parents=True, exist_ok=True)

# AI software tags for metadata analysis
AI_SOFTWARE_TAGS = [
    "stable diffusion", "dall-e", "midjourney", "comfyui", "flux",
    "firefly", "imagen", "generative"
]
METADATA_MAX_SCORE = 30

API_KEY = "your-secret-key-here"