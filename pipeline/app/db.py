import os
import json
import psycopg2
import psycopg2.extras
import numpy as np
from urllib.parse import unquote
from dotenv import load_dotenv

load_dotenv()

RAW_DB_URL = os.getenv("DATABASE_URL")
if not RAW_DB_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Copy pipeline/.env.example to pipeline/.env "
        "or set DATABASE_URL before starting the pipeline API."
    )

DATABASE_URL = unquote(RAW_DB_URL)


def get_connection():
    return psycopg2.connect(DATABASE_URL, sslmode="require")


def fetch_media_files(limit=5):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT id, file_url
        FROM public.media_files
        LIMIT %s
    """, (limit,))

    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows


def fetch_media_file_url(media_id):
    conn = get_connection()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT file_url
            FROM public.media_files
            WHERE id = %s
            LIMIT 1
        """, (media_id,))
        row = cur.fetchone()
        return row[0] if row else None
    except Exception as e:
        print(f"DB media file lookup error: {e}")
        return None
    finally:
        cur.close()
        conn.close()


def insert_scan_result(media_id, score, label, risk, fraud):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO public.scan_results
        (media_id, score, label, risk, fraud)
        VALUES (%s, %s, %s, %s, %s)
    """, (media_id, score, label, risk, fraud))

    conn.commit()
    cur.close()
    conn.close()


def find_existing_by_phash(phash_str: str, threshold: float = 0.85):
    conn = get_connection()
    cur = conn.cursor()

    try:
        print(f"DEBUG DB searching for phash: {phash_str}")

        cur.execute("""
            SELECT id, phash
            FROM public.image_features
            WHERE phash = %s
            LIMIT 1
        """, (phash_str,))

        row = cur.fetchone()
        print(f"DEBUG DB row found: {row}")
        if row:
            return {"id": row[0], "similarity": 1.0}

        return None
    except Exception as e:
        print(f"DB find error: {e}")
        return None
    finally:
        cur.close()
        conn.close()


def phash_similarity_str(h1_str: str, h2_str: str):
    try:
        diff = abs(len(h1_str) - len(h2_str))
        return max(0.0, 1.0 - diff / 64.0)
    except Exception:
        return 0.0


def insert_image_features(media_id: int, phash: str, clip_embedding: list, metadata: dict):
    conn = get_connection()
    cur = conn.cursor()

    embedding_json = json.dumps(clip_embedding)

    try:
        cur.execute("""
            INSERT INTO public.image_features
            (media_id, phash, clip_embedding, metadata)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (media_id, phash, embedding_json, json.dumps(metadata)))

        row = cur.fetchone()
        conn.commit()
        print(f"DB insert success: id={row[0]}")
        return row[0] if row else None
    except Exception as e:
        print(f"DB insert error: {e}")
        return None
    finally:
        cur.close()
        conn.close()


def search_local_vectors(clip_embedding: list, top_k: int = 5, similarity_threshold: float = 0.80):
    import json
    conn = get_connection()
    cur = conn.cursor()

    embedding_arr = np.array(clip_embedding)

    try:
        cur.execute("""
            SELECT id, media_id, phash, clip_embedding, metadata
            FROM public.image_features
            WHERE clip_embedding IS NOT NULL
            LIMIT 500
        """,)

        rows = cur.fetchall()

        results = []
        for row in rows:
            stored_embedding = np.array(json.loads(row[3]))
            similarity = float(np.dot(embedding_arr, stored_embedding))
            metadata = row[4]
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except Exception:
                    metadata = {}

            if similarity >= similarity_threshold:
                results.append({
                    "id": row[0],
                    "media_id": row[1],
                    "phash": row[2],
                    "similarity": similarity,
                    "metadata": metadata if isinstance(metadata, dict) else {}
                })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]

    except Exception as e:
        print(f"DB vector search error: {e}")
        return []
    finally:
        cur.close()
        conn.close()
