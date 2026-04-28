import os
import uuid
import shutil
import asyncio
import io
import traceback
import sys
import json
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app import run_pipeline_async
from app.validator import validate_image, ImageValidationError
from app.extraction import extract_all_features
from app.phash import get_phash_from_bytes
from app.db import insert_image_features, find_existing_by_phash, get_connection, search_local_vectors

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
    file: UploadFile = File(...)
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
        asset_id = insert_image_features(
            media_id=0,
            phash=phash,
            clip_embedding=features["clip_embedding"].cpu().numpy().tolist()[0],
            metadata=features["ela_metadata"],
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
            return JSONResponse({
                "source": "local_db",
                "match_found": True,
                "score": round(local_matches[0]["similarity"] * 100, 2),
                "label": "MATCH FOUND",
                "risk": "HIGH",
                "fraud": "HIGH",
                "action": "BLOCK",
                "explanation": f"Exact match found in local database with {local_matches[0]['similarity']*100:.1f}% similarity",
                "matched_id": local_matches[0]["id"],
                "similarity": local_matches[0]["similarity"],
                "blip_captions": blip_captions,
                "uploaded_image_analysis": uploaded_image_analysis,
            })

        print("No match in local DB, running web search pipeline...")
        pipeline_results = await run_pipeline_async(temp_path)

        if not pipeline_results:
            return JSONResponse({"error": "No results"}, status_code=400)

        best = pipeline_results[0]

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
            "blip_captions": blip_captions,
            "uploaded_image_analysis": uploaded_image_analysis,
            "clip_score": round(best.get("clip", 0) * 100, 2),
            "phash_score": round(best.get("phash", 0) * 100, 2),
            "all_results": pipeline_results[:5]
        }

        return response

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
