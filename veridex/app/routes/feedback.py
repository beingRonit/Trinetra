import json
import logging
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db import models
from app.config import FEEDBACK_IMAGE_DIR, FEEDBACK_STAGING_DIR, RETRAIN_BATCH_SIZE
from app.utils.training_utils import count_staging_files, count_untrained, retrain_from_staging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def save_feedback_image(image_bytes: bytes, image_hash: str, user_label: str) -> str:
    """
    Save feedback image to appropriate directory based on user label.

    Returns:
        Relative path to saved image
    """
    # Determine target directory based on label
    label_upper = user_label.upper()
    if label_upper == "AI":
        target_dir = FEEDBACK_IMAGE_DIR["AI"]
    else:
        target_dir = FEEDBACK_IMAGE_DIR["REAL"]  # REAL or EDITED

    # Ensure directory exists
    target_dir.mkdir(parents=True, exist_ok=True)

    # Save image with hash-based name
    image_path = target_dir / f"{image_hash}.jpg"
    with open(image_path, "wb") as f:
        f.write(image_bytes)

    # Return relative path from project root
    relative_path = image_path.relative_to(Path(__file__).parent.parent.parent)
    return str(relative_path)


def write_staging_json(data: dict) -> str:
    """
    Write feedback data to staging JSON file.

    Returns:
        Path to staging file
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{data['image_hash'][:12]}.json"
    staging_path = FEEDBACK_STAGING_DIR / filename

    with open(staging_path, "w") as f:
        json.dump(data, f, indent=2)

    return str(staging_path)


def should_retrain() -> bool:
    """Check if we have enough staging files to trigger retraining."""
    return count_staging_files() >= RETRAIN_BATCH_SIZE


@router.post("/feedback")
async def submit_feedback(
    image_hash: str = Form(...),
    original_score: float = Form(...),
    user_label: str = Form(...),  # CORRECT | WRONG
    meta_score: float = Form(0),
    forensic_score: float = Form(0),
    classifier_score: float = Form(0),
    similarity_score: float = Form(0),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    """
    Submit feedback for an analyzed image.

    Accepts:
    - Feedback data (scores)
    - Optional image file (will be saved for future training)

    Behavior:
    1. Saves image to data/train/{label}/feedback/
    2. Writes staging JSON file
    3. Stores feedback entry in database
    4. Triggers XGBoost retraining if batch threshold reached
    """
    image_path = None

    # Save image if provided
    if image:
        try:
            image_bytes = await image.read()
            image_path = save_feedback_image(image_bytes, image_hash, user_label)
            logger.info(f"Saved feedback image to {image_path}")
        except Exception as e:
            logger.error(f"Failed to save image: {e}")

    # Prepare staging data
    staging_data = {
        "image_hash": image_hash,
        "image_path": image_path,
        "original_score": original_score,
        "user_label": user_label.upper(),
        "meta_score": meta_score,
        "forensic_score": forensic_score,
        "classifier_score": classifier_score,
        "similarity_score": similarity_score
    }

    # Write staging file
    try:
        staging_path = write_staging_json(staging_data)
        logger.info(f"Created staging file: {staging_path}")
    except Exception as e:
        logger.error(f"Failed to write staging file: {e}")
        staging_path = None

    # Create database entry
    entry = models.FeedbackEntry(
        image_hash=image_hash,
        image_path=image_path,
        original_score=original_score,
        user_label=user_label.upper(),
        meta_score=meta_score,
        forensic_score=forensic_score,
        classifier_score=classifier_score,
        similarity_score=similarity_score,
        trained=False
    )

    db.add(entry)
    db.commit()
    db.refresh(entry)

    logger.info(f"Feedback saved for image {image_hash[:16]}... | user_label={user_label}")

    # Check if retraining should be triggered
    training_status = None
    pending_count = count_staging_files() + count_untrained()

    if should_retrain():
        logger.info(f"Batch threshold reached ({pending_count} samples). Starting retraining...")
        try:
            training_status = {
                "triggered": True,
                "samples": pending_count,
                "status": "training"
            }
            retrain_result = retrain_from_staging(force=False)
            if retrain_result["success"]:
                training_status.update({
                    "success": True,
                    "samples_used": retrain_result["samples_used"],
                    "message": retrain_result["message"]
                })
                logger.info(f"Retraining complete: {retrain_result['message']}")
            else:
                training_status.update({
                    "success": False,
                    "message": retrain_result["message"]
                })
        except Exception as e:
            logger.error(f"Retraining failed: {e}")
            training_status = {
                "triggered": True,
                "success": False,
                "message": str(e)
            }
    else:
        training_status = {
            "triggered": False,
            "pending_samples": pending_count,
            "samples_needed": RETRAIN_BATCH_SIZE - pending_count
        }

    return {
        "status": "recorded",
        "feedback_id": entry.id,
        "image_saved": image_path is not None,
        "image_path": image_path,
        "staging_file": staging_path,
        "training": training_status
    }
