import asyncio
import hashlib
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import xgboost as xgb

from app.config import RUNTIME_FEEDBACK_DB_PATH, RUNTIME_FEEDBACK_IMAGE_DIR
from app.models.xgboost_fusion import build_feature_vector, persist_xgb_model


AI_LABEL = "AI"
REAL_LABEL = "REAL"
JOB_TERMINAL_STATES = {"completed", "failed"}

_workflow_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
_job_registry: dict[str, dict[str, Any]] = {}
_worker_task: asyncio.Task[None] | None = None


def _connect_runtime_db() -> sqlite3.Connection:
    connection = sqlite3.connect(str(RUNTIME_FEEDBACK_DB_PATH))
    connection.row_factory = sqlite3.Row
    return connection


def initialize_feedback_runtime() -> None:
    RUNTIME_FEEDBACK_IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    with _connect_runtime_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS runtime_feedback (
                image_id TEXT PRIMARY KEY,
                image_hash TEXT NOT NULL,
                prediction TEXT NOT NULL,
                user_feedback TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                confidence_score REAL NOT NULL,
                ai_probability REAL,
                real_probability REAL,
                classifier_score INTEGER NOT NULL,
                image_path TEXT NOT NULL
            )
            """
        )
        connection.commit()

    purge_runtime_feedback()


def purge_runtime_feedback() -> None:
    if RUNTIME_FEEDBACK_IMAGE_DIR.exists():
        for file_path in RUNTIME_FEEDBACK_IMAGE_DIR.glob("*"):
            if file_path.is_file():
                try:
                    file_path.unlink()
                except OSError:
                    pass

    with _connect_runtime_db() as connection:
        connection.execute("DELETE FROM runtime_feedback")
        connection.commit()


def _build_seed_training_data() -> tuple[np.ndarray, np.ndarray]:
    seed_rows = [
        (0.04, 0.96, 0),
        (0.09, 0.91, 0),
        (0.18, 0.82, 0),
        (0.31, 0.69, 0),
        (0.69, 0.31, 1),
        (0.82, 0.18, 1),
        (0.91, 0.09, 1),
        (0.96, 0.04, 1),
    ]
    features = np.vstack([build_feature_vector(ai_prob, real_prob) for ai_prob, real_prob, _ in seed_rows])
    labels = np.array([label for _, _, label in seed_rows], dtype=np.int32)
    return features, labels


def _resolve_sample_probabilities(
    *,
    ai_probability: float | None,
    real_probability: float | None,
    classifier_score: int,
) -> tuple[float, float]:
    if ai_probability is not None and real_probability is not None:
        return float(ai_probability), float(real_probability)

    ai_prob = max(0.0, min(1.0, classifier_score / 100.0))
    return ai_prob, max(0.0, min(1.0, 1.0 - ai_prob))


def _train_runtime_model(
    ai_probability: float | None,
    real_probability: float | None,
    classifier_score: int,
    user_feedback: str,
) -> None:
    seed_features, seed_labels = _build_seed_training_data()
    sample_ai_probability, sample_real_probability = _resolve_sample_probabilities(
        ai_probability=ai_probability,
        real_probability=real_probability,
        classifier_score=classifier_score,
    )
    sample_features = build_feature_vector(sample_ai_probability, sample_real_probability).reshape(1, -1)
    sample_label = np.array([1 if user_feedback == AI_LABEL else 0], dtype=np.int32)

    features = np.vstack([seed_features, sample_features])
    labels = np.concatenate([seed_labels, sample_label])

    model = xgb.XGBClassifier(
        n_estimators=24,
        max_depth=2,
        learning_rate=0.2,
        eval_metric="logloss",
        random_state=42,
    )
    model.fit(features, labels)
    persist_xgb_model(model)


def _set_job_state(job_id: str, status: str, *, error: str | None = None, completed: bool = False) -> None:
    job = _job_registry[job_id]
    job["status"] = status
    job["stage"] = status
    job["error"] = error
    if completed:
        job["completed_at"] = datetime.now(timezone.utc).isoformat()


def _prune_completed_jobs(limit: int = 100) -> None:
    completed_jobs = [job_id for job_id, payload in _job_registry.items() if payload["status"] in JOB_TERMINAL_STATES]
    if len(completed_jobs) <= limit:
        return

    completed_jobs.sort(key=lambda job_id: _job_registry[job_id].get("completed_at") or _job_registry[job_id]["created_at"])
    for job_id in completed_jobs[:-limit]:
        _job_registry.pop(job_id, None)


def _write_temp_image(image_id: str, image_bytes: bytes) -> Path:
    image_path = RUNTIME_FEEDBACK_IMAGE_DIR / f"{image_id}.jpg"
    with image_path.open("wb") as file_handle:
        file_handle.write(image_bytes)
    return image_path


def _store_runtime_record(payload: dict[str, Any], image_path: Path) -> None:
    with _connect_runtime_db() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO runtime_feedback (
                image_id,
                image_hash,
                prediction,
                user_feedback,
                timestamp,
                confidence_score,
                ai_probability,
                real_probability,
                classifier_score,
                image_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["image_id"],
                payload["image_hash"],
                payload["prediction"],
                payload["user_feedback"],
                payload["timestamp"],
                payload["confidence_score"],
                payload.get("ai_probability"),
                payload.get("real_probability"),
                payload["classifier_score"],
                str(image_path),
            ),
        )
        connection.commit()


def _delete_runtime_record(image_id: str) -> None:
    with _connect_runtime_db() as connection:
        connection.execute("DELETE FROM runtime_feedback WHERE image_id = ?", (image_id,))
        connection.commit()


async def _run_feedback_job(job_payload: dict[str, Any]) -> None:
    job_id = job_payload["job_id"]
    image_path: Path | None = None

    try:
        _set_job_state(job_id, "storing")
        image_path = _write_temp_image(job_payload["image_id"], job_payload["image_bytes"])
        _store_runtime_record(job_payload, image_path)

        _set_job_state(job_id, "training")
        await asyncio.to_thread(
            _train_runtime_model,
            job_payload.get("ai_probability"),
            job_payload.get("real_probability"),
            job_payload["classifier_score"],
            job_payload["user_feedback"],
        )

        _set_job_state(job_id, "cleaning")
        if image_path and image_path.exists():
            try:
                image_path.unlink()
            except OSError:
                pass
        _delete_runtime_record(job_payload["image_id"])

        _set_job_state(job_id, "completed", completed=True)
    except Exception as exc:
        if image_path and image_path.exists():
            try:
                image_path.unlink()
            except OSError:
                pass
        try:
            _delete_runtime_record(job_payload["image_id"])
        except Exception:
            pass
        _set_job_state(job_id, "failed", error=str(exc), completed=True)


async def _worker_loop() -> None:
    while True:
        payload = await _workflow_queue.get()
        try:
            await _run_feedback_job(payload)
        finally:
            _workflow_queue.task_done()


async def start_feedback_worker() -> None:
    global _worker_task
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(_worker_loop())


async def stop_feedback_worker() -> None:
    global _worker_task
    if _worker_task is None:
        return

    _worker_task.cancel()
    try:
        await _worker_task
    except asyncio.CancelledError:
        pass
    _worker_task = None


def enqueue_feedback_job(
    *,
    image_bytes: bytes,
    prediction: str,
    user_feedback: str,
    confidence_score: float,
    ai_probability: float | None = None,
    real_probability: float | None = None,
    classifier_score: int | None = None,
) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    image_id = uuid.uuid4().hex
    image_hash = hashlib.sha256(image_bytes).hexdigest()
    classifier_value = classifier_score if classifier_score is not None else int(round((ai_probability or 0.0) * 100))
    timestamp = datetime.now(timezone.utc).isoformat()

    payload = {
        "job_id": job_id,
        "image_id": image_id,
        "image_hash": image_hash,
        "prediction": prediction,
        "user_feedback": user_feedback,
        "confidence_score": confidence_score,
        "ai_probability": ai_probability,
        "real_probability": real_probability,
        "classifier_score": classifier_value,
        "timestamp": timestamp,
        "image_bytes": image_bytes,
    }

    _job_registry[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "stage": "queued",
        "prediction": prediction,
        "user_feedback": user_feedback,
        "image_id": image_id,
        "error": None,
        "created_at": timestamp,
        "completed_at": None,
    }
    _workflow_queue.put_nowait(payload)
    _prune_completed_jobs()
    return dict(_job_registry[job_id])


def get_job_status(job_id: str) -> dict[str, Any] | None:
    status = _job_registry.get(job_id)
    if status is None:
        return None
    _prune_completed_jobs()
    return dict(status)


def get_runtime_feedback_stats() -> dict[str, Any]:
    with _connect_runtime_db() as connection:
        pending_records = connection.execute("SELECT COUNT(*) FROM runtime_feedback").fetchone()[0]

    active_jobs = {
        state: sum(1 for payload in _job_registry.values() if payload["status"] == state)
        for state in ["queued", "storing", "training", "cleaning", "completed", "failed"]
    }

    return {
        "pending_records": pending_records,
        "queue_depth": _workflow_queue.qsize(),
        "jobs": active_jobs,
    }
