#!/usr/bin/env python3
"""
Retrain XGBoost fusion model with user feedback.

This script can be run:
1. Manually to retrain from all database entries
2. Automatically via the feedback API (uses staging files)

Usage:
    python scripts/retrain_with_feedback.py [--from-staging] [--force]

Options:
    --from-staging  Use staging files instead of database (default for API)
    --force         Retrain even with insufficient samples
"""

import pickle
import os
import sys
import argparse

script_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(script_dir)
sys.path.insert(0, project_dir)
os.chdir(project_dir)

import numpy as np
from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.db import models
import xgboost as xgb


def retrain_from_database(min_samples: int = 10):
    """Retrain XGBoost model from database feedback entries."""
    print("[*] Connecting to database...")
    db: Session = SessionLocal()

    try:
        entries = db.query(models.FeedbackEntry).all()

        if len(entries) < min_samples:
            print(f"[!] Need at least {min_samples} feedback entries, have {len(entries)}")
            return False

        print(f"[+] Found {len(entries)} feedback entries")

        X = []
        y = []

        for e in entries:
            meta = e.meta_score
            forensic = e.forensic_score
            classifier = e.classifier_score or 0
            similarity = e.similarity_score or 0

            if meta is None or forensic is None:
                continue

            X.append([meta, forensic, classifier, similarity])

            # Derive label from user feedback
            user_lbl = (e.user_label or "").upper()

            if user_lbl == "AI":
                label = 1  # AI-generated
            elif user_lbl == "REAL":
                label = 0  # Real image
            elif user_lbl == "EDITED":
                label = 0  # Treat edited as real
            else:
                # Fallback for old CORRECT/WRONG format
                original = e.original_score
                is_correct = e.is_correct or (user_lbl == "CORRECT")

                if is_correct:
                    label = 1 if (original >= 50) else 0
                else:
                    label = 0 if (original >= 50) else 1

            y.append(label)

        X = np.array(X, dtype=np.float32)
        y = np.array(y, dtype=np.int32)

        print(f"[+] Training data: {len(X)} samples")
        print(f"    Label 1 (AI): {sum(y)}")
        print(f"    Label 0 (Real): {len(y) - sum(y)}")

        print("[+] Training model...")

        # Calculate class weight for imbalanced data
        n_pos = sum(y)
        n_neg = len(y) - n_pos
        scale_pos_weight = n_neg / max(n_pos, 1)

        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            scale_pos_weight=scale_pos_weight,
            eval_metric="logloss",
            random_state=42
        )
        model.fit(X, y)

        # Evaluate
        train_acc = (model.predict(X) == y).mean()
        print(f"[+] Training accuracy: {train_acc:.2%}")

        filename = "xgb_fusion.pkl"
        with open(filename, "wb") as f:
            pickle.dump(model, f)

        print(f"[+] Saved: {filename}")

        # Mark entries as trained
        for e in entries:
            e.trained = True
        db.commit()
        print("[+] Marked entries as trained")

        return True

    finally:
        db.close()


def retrain_from_staging(force: bool = False):
    """Retrain from staging JSON files (used by API)."""
    from app.utils.training_utils import retrain_from_staging as retrain_fn

    print("[*] Loading staging files...")
    result = retrain_fn(force=force)

    if result["success"]:
        print(f"[+] {result['message']}")
        print(f"[+] Cleaned up {result['files_cleaned']} staging files")
    else:
        print(f"[!] {result['message']}")

    return result["success"]


def main():
    parser = argparse.ArgumentParser(description="Retrain XGBoost fusion model")
    parser.add_argument("--from-staging", action="store_true",
                        help="Use staging files instead of database")
    parser.add_argument("--force", action="store_true",
                        help="Retrain even with insufficient samples")
    args = parser.parse_args()

    if args.from_staging:
        success = retrain_from_staging(force=args.force)
    else:
        min_samples = 3 if args.force else 10
        success = retrain_from_database(min_samples=min_samples)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
