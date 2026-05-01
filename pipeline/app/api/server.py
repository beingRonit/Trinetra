import os
import uuid
import shutil
import asyncio
import io
import base64
import traceback
import sys
import json
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app import run_pipeline_async
from app.pipeline import get_last_run_summary
from app.validator import validate_image, ImageValidationError
from app.extraction import extract_all_features
from app.phash import get_phash_from_bytes
from app.db import insert_image_features, find_existing_by_phash, get_connection, search_local_vectors, fetch_media_file_url

# Calculate paths relative to this file's location
_current_dir = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(_current_dir)  # app/
PROJECT_ROOT = os.path.dirname(PIPELINE_DIR)  # pipeline/
INTEGRATION_ROOT = os.path.dirname(PROJECT_ROOT)  # Integration-main/
FRONTEND_DIST = os.path.join(INTEGRATION_ROOT, "frontend", "dist")
UPLOAD_DIR = os.path.join(PIPELINE_DIR, "data", "uploads")
VERIDEX_DIR = os.path.join(INTEGRATION_ROOT, "veridex")
VERIDEX_PYTHON = os.path.join(VERIDEX_DIR, "venv", "Scripts", "python.exe")
VERIDEX_RUNNER = os.path.join(VERIDEX_DIR, "integration_predict.py")
VERIDEX_API_URL = os.environ.get("VERIDEX_API_URL", "http://127.0.0.1:8001")
VERIDEX_HEALTH_URL = f"{VERIDEX_API_URL.rstrip('/')}/health"
_veridex_sidecar_process = None

os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Trinetra OS API")

print(f"[DEBUG] Current dir: {_current_dir}")
print(f"[DEBUG] Integration root: {INTEGRATION_ROOT}")
print(f"[DEBUG] loading.html exists: {os.path.exists(os.path.join(INTEGRATION_ROOT, 'loading.html'))}")

@app.get("/debug/paths")
def debug_paths():
    loading_path = os.path.join(INTEGRATION_ROOT, "loading.html")
    return {
        "integration_root": INTEGRATION_ROOT,
        "frontend_dist": FRONTEND_DIST,
        "loading_path": loading_path,
        "loading_exists": os.path.exists(loading_path),
        "frontend_dist_exists": os.path.exists(FRONTEND_DIST),
        "files_in_root": os.listdir(INTEGRATION_ROOT) if os.path.exists(INTEGRATION_ROOT) else "N/A",
    }

@app.get("/")
def root():
    return JSONResponse(
        content={"message": "Redirecting to frontend..."},
        status_code=307,
        headers={"Location": "/frontend/"}
    )

if os.path.exists(FRONTEND_DIST):
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

OUTPUT_DIR = os.path.join(PROJECT_ROOT, "data", "output")

os.makedirs(OUTPUT_DIR, exist_ok=True)


def sanitize_pipeline_results(results):
    sanitized = []
    for item in results[:5]:
        sanitized.append({
            "source": item.get("source"),
            "final": round(float(item.get("final", 0)), 2),
            "clip": round(float(item.get("clip", 0)), 4),
            "phash": round(float(item.get("phash", 0)), 4),
            "risk": item.get("risk"),
            "fraud": item.get("fraud"),
            "explanation": item.get("explanation"),
            "label": item.get("label"),
            "action": item.get("action"),
            "match_confident": bool(item.get("match_confident", False)),
        })
    return sanitized


def is_veridex_api_healthy(timeout: float = 1.5) -> bool:
    try:
        response = requests.get(VERIDEX_HEALTH_URL, timeout=timeout)
        return response.ok
    except requests.RequestException:
        return False


def ensure_veridex_api_running(start_timeout: float = 20.0) -> None:
    global _veridex_sidecar_process

    if is_veridex_api_healthy():
        return

    if not os.path.exists(VERIDEX_PYTHON):
        raise RuntimeError(f"Veridex runtime not found at {VERIDEX_PYTHON}")

    if _veridex_sidecar_process is None or _veridex_sidecar_process.poll() is not None:
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        _veridex_sidecar_process = subprocess.Popen(
            [VERIDEX_PYTHON, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"],
            cwd=VERIDEX_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )

    deadline = time.monotonic() + start_timeout
    while time.monotonic() < deadline:
        if is_veridex_api_healthy():
            return

        if _veridex_sidecar_process and _veridex_sidecar_process.poll() is not None:
            raise RuntimeError("Veridex sidecar exited before becoming ready")

        time.sleep(0.4)

    raise RuntimeError("Veridex sidecar did not become ready in time")

@app.get("/api/visualization/{filename}")
@app.get("/visualization/{filename}")
async def get_visualization(filename: str):
    safe_filename = os.path.basename(filename)
    visual_path = os.path.join(OUTPUT_DIR, safe_filename)
    print(f"[DEBUG] Visualization requested: {filename}")
    print(f"[DEBUG] Full path: {visual_path}")
    print(f"[DEBUG] Exists: {os.path.exists(visual_path)}")
    print(f"[DEBUG] OUTPUT_DIR: {OUTPUT_DIR}")
    if os.path.exists(visual_path):
        return FileResponse(visual_path, media_type="image/jpeg")
    return JSONResponse({"error": "Not found", "path": visual_path}, status_code=404)


@app.post("/signup")
async def signup(
    email: str = Form(...),
    password: str = Form(...)
):
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("SELECT id FROM public.users WHERE email = %s", (email,))
        if cur.fetchone():
            return JSONResponse({"error": "User already exists"}, status_code=400)

        cur.execute("""
            INSERT INTO public.users (email, password_hash, created_at)
            VALUES (%s, %s, NOW())
            RETURNING id
        """, (email, password))
        user_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()

        return {"status": "success", "user_id": user_id, "email": email}

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/login")
async def login(
    email: str = Form(...),
    password: str = Form(...)
):
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("SELECT id, password_hash FROM public.users WHERE email = %s", (email,))
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return JSONResponse({"error": "Invalid credentials"}, status_code=401)

        if row[1] != password:
            return JSONResponse({"error": "Invalid credentials"}, status_code=401)

        return {"status": "success", "user_id": row[0], "email": email}

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/register")
async def register_image(
    artist_name: str = Form(...),
    file: UploadFile = File(...),
    user_email: str = Form("")
):
    file_obj = io.BytesIO()

    try:
        shutil.copyfileobj(file.file, file_obj)
        file_obj.seek(0)
        image_data = file_obj.getvalue()
        print(f"DEBUG file read: {len(image_data)} bytes")
        sys.stdout.flush()
    except Exception as e:
        print(f"DEBUG file read error: {e}")
        sys.stdout.flush()
        return JSONResponse({"error": f"Failed to read file: {e}"}, status_code=400)

    try:
        phash = str(get_phash_from_bytes(image_data))
        print(f"DEBUG phash: {phash}")
        sys.stdout.flush()
    except Exception as e:
        print(f"DEBUG phash error: {e}")
        sys.stdout.flush()
        return JSONResponse({"error": f"Invalid image: {e}"}, status_code=400)

    try:
        existing = find_existing_by_phash(phash)
        print("DEBUG existing: {exists}".format(exists=existing))
        sys.stdout.flush()

        if existing:
            return JSONResponse({
                "status": "duplicate",
                "deduplicated_id": existing["id"],
                "similarity": existing["similarity"],
            })

        print("DEBUG: About to call extract_all_features")
        sys.stdout.flush()
        features = await extract_all_features(image_data)
        print("DEBUG: extract_all_features returned")
        sys.stdout.flush()

        print("DEBUG: Inserting to DB...")
        sys.stdout.flush()
        preview_url = f"data:{getattr(file, 'content_type', None) or 'image/jpeg'};base64,{base64.b64encode(image_data).decode('ascii')}"
        enriched_metadata = {
            **(features["ela_metadata"] or {}),
            "artist_name": artist_name,
            "filename": getattr(file, "filename", "uploaded.jpg"),
            "mime_type": getattr(file, "content_type", None) or "image/jpeg",
            "preview_url": preview_url,
            "user_email": user_email.strip().lower(),
            "blip_captions": features["blip_captions"],
        }

        asset_id = insert_image_features(
            media_id=0,
            phash=phash,
            clip_embedding=features["clip_embedding"].cpu().numpy().tolist()[0],
            metadata=enriched_metadata,
        )

        return JSONResponse({
            "status": "registered",
            "artist": artist_name,
            "phash": phash,
            "asset_id": asset_id,
            "clip_embedding_shape": list(features["clip_embedding"].shape),
            "blip_captions": features["blip_captions"],
            "ela_metadata": features["ela_metadata"],
        })

    except ImageValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    except Exception as e:
        import traceback
        print(f"DEBUG unhandled error: {e}")
        print(traceback.format_exc())
        sys.stdout.flush()
        return JSONResponse({"error": str(e), "trace": traceback.format_exc()}, status_code=500)


@app.post("/ingest")
async def ingest_image(file: UploadFile = File(...)):
    temp_path = None
    file_obj = io.BytesIO()

    try:
        shutil.copyfileobj(file.file, file_obj)
        file_obj.seek(0)

        filename = getattr(file, "filename", "uploaded.jpg")
        validation = validate_image(file_obj, filename)
        file_obj.seek(0)

        phash = str(get_phash_from_bytes(file_obj.getvalue()))
        features = await extract_all_features(file_obj.getvalue())

        return JSONResponse({
            "status": "ingested",
            "phash": phash,
            "clip_embedding_shape": list(features["clip_embedding"].shape),
            "blip_captions": features["blip_captions"],
            "metadata": features["ela_metadata"],
        })

    except ImageValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    except Exception as e:
        return JSONResponse({"error": str(e), "trace": traceback.format_exc()}, status_code=500)

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/analyze-image")
async def analyze_image(file: UploadFile = File(...)):
    temp_path = None

    try:
        filename = f"{uuid.uuid4().hex}.jpg"
        temp_path = os.path.join(UPLOAD_DIR, filename)

        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        features = await extract_all_features(open(temp_path, "rb").read())
        clip_embedding = features["clip_embedding"].cpu().numpy().tolist()[0]
        blip_captions = features.get("blip_captions", [])
        uploaded_image_analysis = {
            "filename": getattr(file, "filename", "uploaded.jpg"),
            "captions": blip_captions,
            "embedding": {
                "model": "CLIP ViT-B/32",
                "type": "full_image",
                "dimensions": len(clip_embedding),
                "vector": clip_embedding,
                "preview": clip_embedding[:16],
            },
        }

        print("Checking local vector database...")
        local_matches = search_local_vectors(clip_embedding, top_k=5, similarity_threshold=0.80)

        if local_matches and local_matches[0]["similarity"] >= 0.80:
            print(f"Match found in local DB! Similarity: {local_matches[0]['similarity']}")
            local_match = local_matches[0]
            local_metadata = local_match.get("metadata") or {}
            if isinstance(local_metadata, str):
                try:
                    local_metadata = json.loads(local_metadata)
                except Exception:
                    local_metadata = {}
            local_preview_url = local_metadata.get("preview_url") or local_metadata.get("image_url")
            if not local_preview_url and local_match.get("media_id") and str(local_match.get("media_id")) != "0":
                local_preview_url = fetch_media_file_url(local_match.get("media_id"))
            local_filename = (
                local_metadata.get("filename")
                or local_metadata.get("title")
                or local_metadata.get("artist_name")
                or "local_db"
            )
            return JSONResponse({
                "source": "local_db",
                "match_found": True,
                "score": round(local_match["similarity"] * 100, 2),
                "label": "MATCH FOUND",
                "risk": "HIGH",
                "fraud": "HIGH",
                "action": "BLOCK",
                "explanation": f"Exact match found in local database with {local_match['similarity']*100:.1f}% similarity",
                "matched_id": local_match["id"],
                "matched_media_id": local_match.get("media_id"),
                "matched_phash": local_match.get("phash"),
                "matched_file": local_filename,
                "matched_image_url": local_preview_url,
                "similarity": local_match["similarity"],
                "web_search_attempted": False,
                "local_match": {
                    "id": local_match["id"],
                    "media_id": local_match.get("media_id"),
                    "phash": local_match.get("phash"),
                    "image_url": local_preview_url,
                    "filename": local_filename,
                },
                "blip_captions": blip_captions,
                "uploaded_image_analysis": uploaded_image_analysis,
            })

        print("No match in local DB, running web search pipeline...")
        pipeline_results = await run_pipeline_async(temp_path)

        if not pipeline_results:
            run_summary = get_last_run_summary()
            searched_candidates = run_summary.get("searched_candidates", 0)
            filtered_self_matches = run_summary.get("filtered_self_matches", 0)
            downloaded_candidates = run_summary.get("downloaded_candidates", 0)
            explanation = (
                "Web search completed, but only self or near-self matches were found and excluded"
                if filtered_self_matches > 0 and downloaded_candidates > 0
                else "Web search completed, but no external matches were found for this image"
            )
            return JSONResponse({
                "source": "web",
                "match_found": False,
                "score": 0,
                "label": "NO EXTERNAL MATCH",
                "risk": "LOW",
                "fraud": "LOW",
                "action": "PASS",
                "explanation": explanation,
                "web_search_attempted": True,
                "searched_candidates": searched_candidates,
                "downloaded_candidates": downloaded_candidates,
                "filtered_self_matches": filtered_self_matches,
                "blip_captions": blip_captions,
                "uploaded_image_analysis": uploaded_image_analysis,
                "clip_score": 0,
                "phash_score": 0,
                "all_results": []
            })

        best = pipeline_results[0]

        if not best.get("match_confident", False):
            run_summary = get_last_run_summary()
            comparison_image = None
            if best.get("visual"):
                comparison_image = f"/api/visualization/{os.path.basename(best['visual'])}"
            return JSONResponse({
                "source": "web",
                "match_found": False,
                "score": round(best.get("final", 0), 2),
                "label": "NO EXTERNAL MATCH",
                "risk": "LOW",
                "fraud": "LOW",
                "action": "PASS",
                "explanation": f"{best.get('explanation') or 'Low confidence web result'} | Strong external evidence was not found",
                "web_search_attempted": True,
                "searched_candidates": run_summary.get("searched_candidates", 0),
                "downloaded_candidates": run_summary.get("downloaded_candidates", 0),
                "filtered_self_matches": run_summary.get("filtered_self_matches", 0),
                "visual": comparison_image,
                "blip_captions": blip_captions,
                "uploaded_image_analysis": uploaded_image_analysis,
                "clip_score": round(best.get("clip", 0) * 100, 2),
                "phash_score": round(best.get("phash", 0) * 100, 2),
                "all_results": sanitize_pipeline_results(pipeline_results),
            })

        comparison_image = None
        if best.get("visual"):
            comparison_image = f"/api/visualization/{os.path.basename(best['visual'])}"

        response = {
            "score": round(best["final"], 2),
            "label": best["label"],
            "risk": best["risk"],
            "fraud": best["fraud"],
            "action": best.get("action", "REVIEW"),
            "explanation": best["explanation"],
            "source": best.get("source"),
            "visual": comparison_image,
            "web_search_attempted": True,
            "blip_captions": blip_captions,
            "uploaded_image_analysis": uploaded_image_analysis,
            "clip_score": round(best.get("clip", 0) * 100, 2),
            "phash_score": round(best.get("phash", 0) * 100, 2),
            "all_results": sanitize_pipeline_results(pipeline_results)
        }

        return JSONResponse(response)

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/intelligence/veridex/analyze")
async def analyze_with_veridex(file: UploadFile = File(...)):
    temp_path = None

    try:
        suffix = Path(getattr(file, "filename", "upload.jpg")).suffix or ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            shutil.copyfileobj(file.file, temp_file)
            temp_path = temp_file.name

        if not os.path.exists(VERIDEX_PYTHON):
            return JSONResponse({"error": f"Veridex runtime not found at {VERIDEX_PYTHON}"}, status_code=500)

        if not os.path.exists(VERIDEX_RUNNER):
            return JSONResponse({"error": f"Veridex runner not found at {VERIDEX_RUNNER}"}, status_code=500)

        completed = await asyncio.to_thread(
            subprocess.run,
            [VERIDEX_PYTHON, VERIDEX_RUNNER, temp_path],
            capture_output=True,
            text=True,
            cwd=VERIDEX_DIR,
            check=False,
        )

        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip() or "Veridex execution failed"
            return JSONResponse({"error": detail}, status_code=500)

        stdout = completed.stdout.strip()
        try:
            result = json.loads(stdout)
        except json.JSONDecodeError:
            return JSONResponse({"error": f"Invalid Veridex response: {stdout}"}, status_code=500)

        if result.get("error"):
            return JSONResponse({"error": result["error"]}, status_code=500)

        return {
            "filename": getattr(file, "filename", "uploaded.jpg"),
            "engine": "Veridex",
            "task": "real-vs-ai-cnn",
            **result,
        }

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/intelligence/veridex/feedback")
async def submit_veridex_feedback(
    image: UploadFile = File(...),
    prediction: str = Form(...),
    user_feedback: str = Form(...),
    confidence_score: float = Form(...),
    ai_probability: float | None = Form(None),
    real_probability: float | None = Form(None),
    classifier_score: int | None = Form(None),
):
    try:
        await asyncio.to_thread(ensure_veridex_api_running)
        image_bytes = await image.read()
        files = {
            "image": (
                getattr(image, "filename", "feedback-image.jpg"),
                image_bytes,
                image.content_type or "image/jpeg",
            )
        }
        data = {
            "prediction": prediction,
            "user_feedback": user_feedback,
            "confidence_score": str(confidence_score),
        }
        if ai_probability is not None:
            data["ai_probability"] = str(ai_probability)
        if real_probability is not None:
            data["real_probability"] = str(real_probability)
        if classifier_score is not None:
            data["classifier_score"] = str(classifier_score)

        response = await asyncio.to_thread(
            requests.post,
            f"{VERIDEX_API_URL}/intelligence/veridex/feedback",
            files=files,
            data=data,
            timeout=60,
        )
        payload = response.json()
        return JSONResponse(payload, status_code=response.status_code)
    except requests.RequestException as exc:
        return JSONResponse({"error": f"Veridex feedback service unavailable: {exc}"}, status_code=502)
    except ValueError as exc:
        return JSONResponse({"error": f"Invalid Veridex feedback response: {exc}"}, status_code=502)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.get("/intelligence/veridex/feedback/jobs/{job_id}")
async def get_veridex_feedback_job(job_id: str):
    try:
        await asyncio.to_thread(ensure_veridex_api_running)
        response = await asyncio.to_thread(
            requests.get,
            f"{VERIDEX_API_URL}/intelligence/veridex/feedback/jobs/{job_id}",
            timeout=30,
        )
        payload = response.json()
        return JSONResponse(payload, status_code=response.status_code)
    except requests.RequestException as exc:
        return JSONResponse({"error": f"Veridex job service unavailable: {exc}"}, status_code=502)
    except ValueError as exc:
        return JSONResponse({"error": f"Invalid Veridex job response: {exc}"}, status_code=502)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)
