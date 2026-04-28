"""
Training utilities for feedback-driven model retraining.
Handles XGBoost fusion model retraining from user feedback.
"""
import json
import os
import logging
import pickle
from pathlib import Path
from typing import List, Dict, Any, Optional
import numpy as np

from app.db.database import SessionLocal
from app.db.models import FeedbackEntry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Paths
BASE_DIR = Path(__file__).parent.parent.parent
STAGING_DIR = BASE_DIR / "app" / "storage" / "feedback_staging"
XGB_MODEL_PATH = BASE_DIR / "xgb_fusion.pkl"


def count_staging_files() -> int:
    """Count number of pending staging files."""
    if not STAGING_DIR.exists():
        return 0
    return len(list(STAGING_DIR.glob("*.json")))


def count_untrained() -> int:
    """Count untrained feedback entries in database."""
    db = SessionLocal()
    try:
        return db.query(FeedbackEntry).filter(FeedbackEntry.trained == False).count()
    finally:
        db.close()


def load_staging_files() -> List[Dict[str, Any]]:
    """Load all staging files and return as list of dicts."""
    staging_data = []

    if not STAGING_DIR.exists():
        return staging_data

    for json_file in STAGING_DIR.glob("*.json"):
        try:
            with open(json_file, "r") as f:
                data = json.load(f)
                data["_staging_file"] = str(json_file)  # Track file for cleanup
                staging_data.append(data)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Failed to load staging file {json_file}: {e}")

    return staging_data


def prepare_training_data(staging_data: List[Dict[str, Any]]) -> tuple:
    """
    Prepare features and labels from staging data for XGBoost training.

    Returns:
        X: Feature matrix (n_samples, 4) - [meta, forensic, classifier, similarity]
        y: Labels (n_samples,) - binary (0=real, 1=fake)
        sample_ids: List of sample identifiers for tracking
    """
    X = []
    y = []
    sample_ids = []

    for sample in staging_data:
        # Extract features
        features = [
            sample.get("meta_score", 0),
            sample.get("forensic_score", 0),
            sample.get("classifier_score", 0),
            sample.get("similarity_score", 0)
        ]

        # Derive label from user feedback (CORRECT/WRONG) and original score
        user_label = sample.get("user_label", "").upper()
        original_score = sample.get("original_score", 50)

        # Binary label: 1 = AI/Fake, 0 = Real
        # CORRECT = agree with detection, WRONG = disagree
        if user_label == "CORRECT":
            label = 1 if original_score >= 50 else 0
        elif user_label == "WRONG":
            label = 0 if original_score >= 50 else 1
        else:
            # Default: use score threshold
            label = 1 if original_score >= 50 else 0

        X.append(features)
        y.append(label)
        sample_ids.append(sample.get("image_hash", sample.get("_staging_file", "unknown")))

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32), sample_ids


def train_xgb_model(X: np.ndarray, y: np.ndarray, sample_ids: List[str]) -> bool:
    """
    Train XGBoost fusion model on provided data.
    """
    try:
        import xgboost as xgb
    except ImportError:
        logger.error("XGBoost not installed")
        return False

    if len(X) < 3:
        logger.warning(f"Insufficient training data: {len(X)} samples")
        return False

    unique_classes = np.unique(y)
    if len(unique_classes) < 2:
        logger.warning(f"Single-class data: only label {unique_classes[0]} present")
        return False

    n_pos = sum(y)
    n_neg = len(y) - n_pos
    scale_pos_weight = n_neg / max(n_pos, 1)

    logger.info(f"[TRAINING] Step 1/4: Initializing model with {len(X)} samples")
    logger.info(f"[TRAINING] Class distribution: AI={sum(y)}, Real={len(y)-sum(y)}")

    model = xgb.XGBClassifier(
        n_estimators=50,
        max_depth=3,
        learning_rate=0.05,
        scale_pos_weight=scale_pos_weight,
        min_child_weight=2,
        eval_metric="logloss",
        random_state=42
    )

    try:
        logger.info("[TRAINING] Step 2/4: Fitting model...")
        model.fit(X, y)
        
        logger.info("[TRAINING] Step 3/4: Evaluating...")
        train_acc = (model.predict(X) == y).mean()
        logger.info(f"[TRAINING] Training accuracy: {train_acc:.0%}")

        logger.info("[TRAINING] Step 4/4: Saving model...")
        with open(XGB_MODEL_PATH, "wb") as f:
            pickle.dump(model, f)

        logger.info(f"[TRAINING] Complete! Model saved to {XGB_MODEL_PATH}")
        return True

    except Exception as e:
        logger.error(f"Training failed: {e}")
        return False


def cleanup_staging_files(staging_data: List[Dict[str, Any]]) -> int:
    """
    Delete staging files that were successfully used in training.

    Returns:
        Number of files deleted
    """
    deleted = 0
    for sample in staging_data:
        staging_file = sample.get("_staging_file")
        if staging_file and os.path.exists(staging_file):
            try:
                os.remove(staging_file)
                deleted += 1
                logger.debug(f"Deleted staging file: {staging_file}")
            except OSError as e:
                logger.error(f"Failed to delete {staging_file}: {e}")

    return deleted


def mark_samples_as_trained(sample_ids: List[str]) -> int:
    """
    Mark feedback entries in database as used in training.

    Returns:
        Number of entries updated
    """
    db = SessionLocal()
    try:
        updated = 0
        for sample_id in sample_ids:
            entry = db.query(FeedbackEntry).filter(
                FeedbackEntry.image_hash == sample_id
            ).first()
            if entry:
                entry.trained = True
                updated += 1

        db.commit()
        logger.info(f"Marked {updated} feedback entries as trained")
        return updated
    except Exception as e:
        logger.error(f"Failed to update database: {e}")
        db.rollback()
        return 0
    finally:
        db.close()


def retrain_from_staging(force: bool = False) -> Dict[str, Any]:
    """
    Main retraining function. Processes staging files OR database entries and retrains XGBoost model.

    Args:
        force: If True, retrain regardless of sample count

    Returns:
        Dict with training results
    """
    result = {
        "success": False,
        "samples_used": 0,
        "files_cleaned": 0,
        "message": ""
    }

    # Try staging files first
    staging_data = load_staging_files()
    
    # If no staging files, try database
    if not staging_data:
        staging_data = load_from_database()
    
    if not staging_data:
        result["message"] = "No feedback data found (no staging files or DB entries)"
        return result

    # Check minimum sample count
    if not force and len(staging_data) < 3:
        result["message"] = f"Insufficient samples: {len(staging_data)} (need at least 3)"
        return result

    # Prepare training data
    X, y, sample_ids = prepare_training_data(staging_data)

    # Train model
    if not train_xgb_model(X, y, sample_ids):
        result["message"] = "Training failed"
        return result

    # Cleanup staging files
    files_cleaned = cleanup_staging_files(staging_data)

    # Mark database entries as trained
    mark_samples_as_trained(sample_ids)

    result["success"] = True
    result["samples_used"] = len(staging_data)
    result["files_cleaned"] = files_cleaned
    result["message"] = f"Successfully retrained on {len(staging_data)} samples"

    return result


def load_from_database() -> List[Dict[str, Any]]:
    """
    Load feedback data directly from database for retraining.
    Uses only untrained entries.
    """
    db = SessionLocal()
    try:
        entries = db.query(FeedbackEntry).filter(
            FeedbackEntry.trained == False
        ).all()
        
        staging_data = []
        for e in entries:
            staging_data.append({
                "image_hash": e.image_hash,
                "image_path": e.image_path,
                "original_score": e.original_score,
                "user_label": e.user_label,
                "meta_score": e.meta_score,
                "forensic_score": e.forensic_score,
                "classifier_score": e.classifier_score,
                "similarity_score": e.similarity_score,
                "_from_db": True
            })
        
        return staging_data
    finally:
        db.close()


def get_training_stats() -> Dict[str, Any]:
    """Get statistics about feedback and training status."""
    db = SessionLocal()
    try:
        total = db.query(FeedbackEntry).count()
        trained = db.query(FeedbackEntry).filter(FeedbackEntry.trained == True).count()
        pending = count_staging_files()

        # Count by user label
        correct_count = db.query(FeedbackEntry).filter(FeedbackEntry.user_label == "CORRECT").count()
        wrong_count = db.query(FeedbackEntry).filter(FeedbackEntry.user_label == "WRONG").count()

        return {
            "total_feedback": total,
            "trained_samples": trained,
            "pending_staging": pending,
            "by_label": {
                "CORRECT": correct_count,
                "WRONG": wrong_count
            }
        }
    finally:
        db.close()
