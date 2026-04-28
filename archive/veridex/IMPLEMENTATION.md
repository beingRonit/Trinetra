# Digital Asset Protection Platform — Full Implementation Blueprint

> **Covers:** dapp (IP/copyright backend) + Veridex (AI/tamper detection) full integration.
> **Stack:** FastAPI · Supabase (PostgreSQL + Storage) · Celery · Redis · pgvector
> **Rule:** Never modify `pipeline/app/` or `veridex/app/` modules directly.

---

## ⚠️ BUGS FIXED IN THIS DOCUMENT

The following issues were found in the original design and are corrected here:

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `contracts.py` | `discovered_at: datetime = None` — Pydantic v2 rejects bare `None` default on non-Optional typed field | Changed to `Optional[datetime] = None` |
| 2 | `contracts.py` | `ScanResult` missing `authenticity` field for Veridex | Added `authenticity: Optional[AuthenticityResult] = None` |
| 3 | `asset_repo.py` | `.single()` throws on Supabase if row not found — not handled | Wrapped in try/except, returns `None` safely |
| 4 | `scan_repo.py` | `clip_embedding_ref` column doesn't exist in schema but is written | Removed — debug data stays in-memory only |
| 5 | `storage.py` | `get_db().supabase_url` — attribute doesn't exist on Supabase client | Fixed to use `settings.SUPABASE_URL` |
| 6 | `errors.py` | `safe_download` calls `asyncio.run()` inside potentially async context → crash | Fixed: `safe_download` is now `async def` using `await` |
| 7 | `asset_service.py` | `UploadFile` imported but never used | Removed unused import |
| 8 | `api/routes/assets.py` | `status_code` computed but not used — FastAPI ignores it after response already started | Fixed: return `JSONResponse` with correct code on duplicate |
| 9 | `main.py` | `global_exception_handler` imported in comments but not wired | Added to `main.py` properly |
| 10 | `001_init.sql` | `ivfflat` index on `clip_embedding` created at table creation — fails when column is empty | Moved to separate block with `WHERE clip_embedding IS NOT NULL` comment |
| 11 | `workers/tasks.py` | `asyncio.run()` inside Celery worker can fail if event loop already running | Added `nest_asyncio` patch + note |
| 12 | `veridex_runner.py` | Python 3.14 vs 3.11/3.12 conflict — Veridex uses cpython-314 | Added explicit version guard + sidecar service option |

---

## PROJECT TREE

```
dapp/
├── .env.example
├── Makefile
├── main.py                              ← updated (Veridex router + error handler wired)
├── requirements.txt
│
├── app/
│   ├── api/
│   │   └── routes/
│   │       ├── assets.py
│   │       ├── scans.py
│   │       ├── reports.py
│   │       └── authenticity.py          ← NEW (Veridex endpoints)
│   │
│   ├── core/
│   │   ├── config.py                    ← updated (Veridex flags added)
│   │   ├── db.py
│   │   ├── errors.py                    ← fixed (safe_download async)
│   │   └── storage.py                   ← fixed (supabase_url ref)
│   │
│   ├── pipeline/
│   │   ├── runner.py                    ← dapp copyright pipeline (pure fn)
│   │   └── veridex_runner.py            ← NEW (Veridex pipeline, pure fn)
│   │
│   ├── repositories/
│   │   ├── asset_repo.py                ← fixed (.single() guard)
│   │   ├── scan_repo.py                 ← fixed (removed bad column ref)
│   │   ├── report_repo.py
│   │   └── authenticity_repo.py         ← NEW
│   │
│   ├── schemas/
│   │   └── contracts.py                 ← updated + fixed
│   │
│   ├── services/
│   │   ├── asset_service.py             ← fixed (removed unused import)
│   │   ├── scan_service.py
│   │   ├── report_service.py            ← updated (includes authenticity in notice)
│   │   └── authenticity_service.py      ← NEW
│   │
│   └── workers/
│       └── tasks.py                     ← updated (authenticity_task added)
│
├── migrations/
│   ├── 001_init.sql                     ← fixed (ivfflat index separated)
│   ├── 002_field_rename.sql
│   └── 003_authenticity.sql             ← NEW
│
├── scripts/
│   └── lint_pipeline_purity.sh          ← updated (veridex runner check added)
│
└── veridex/                             ← existing code, NEVER modify
    └── app/
        ├── config.py
        ├── main.py
        ├── db/
        │   ├── database.py
        │   └── models.py
        ├── models/
        │   ├── cnn_classifier.py
        │   ├── vit_classifier.py
        │   ├── mvss_net.py
        │   └── xgboost_fusion.py
        ├── modules/
        │   ├── classifier.py
        │   ├── forensics.py
        │   ├── fusion.py
        │   ├── metadata.py
        │   └── similarity.py
        ├── routes/
        │   ├── analyze.py
        │   ├── feedback.py
        │   └── heatmap.py
        └── utils/
            ├── hash_utils.py
            ├── heatmap.py
            ├── image_utils.py
            └── score_utils.py
```

---

## PHASE 1 — SCHEMAS & CONTRACTS

**File:** `app/schemas/contracts.py`

Single source of truth. All models live here. Nothing else defines types.

### Canonical field names — enforce everywhere

| Concept | Use | Never use |
|---------|-----|-----------|
| Storage path | `storage_key` | `file_url`, `image_path`, `path`, `url` |
| Asset primary key | `media_id` | `asset_id`, `image_id`, `file_id` |
| CLIP vector | `clip_embedding` | `visual_dna`, `vector`, `clip_vector` |
| Match score | `similarity_score` | `confidence`, `score`, `match_score` |
| Perceptual hash | `phash` | `hash`, `img_hash`, `pHash` |

```python
# app/schemas/contracts.py

from pydantic import BaseModel, UUID4
from datetime import datetime
from typing import Optional


# ── Core asset ────────────────────────────────
class AssetObject(BaseModel):
    id: UUID4
    user_id: UUID4
    storage_key: str
    phash: str
    clip_embedding: Optional[list[float]] = None
    filename: str
    mime_type: str
    created_at: datetime


class UploadResponse(BaseModel):
    asset: AssetObject
    is_duplicate: bool
    message: Optional[str] = None


# ── Copyright scan ────────────────────────────
class MatchResult(BaseModel):
    url: str
    similarity_score: float
    phash_distance: int = -1
    label: str = "unknown"          # exact | modified | partial | unrelated
    risk_level: str = "low"         # critical | high | medium | low
    is_fraud: bool = False
    region_matches: list[str] = []
    source_domain: str = ""
    discovered_at: Optional[datetime] = None   # FIX: was `datetime = None` — Pydantic v2 rejects

    def model_post_init(self, __context):
        if self.discovered_at is None:
            object.__setattr__(self, "discovered_at", datetime.utcnow())


class ScanResult(BaseModel):
    id: UUID4
    media_id: UUID4
    status: str                     # pending | running | complete | failed
    matches: list[MatchResult] = []
    total_matches: int = 0
    max_risk: str = "low"
    authenticity: Optional["AuthenticityResult"] = None   # populated if Veridex ran
    scan_duration_ms: int = 0
    error: Optional[str] = None
    created_at: datetime


# ── Authenticity (Veridex) ────────────────────
class AuthenticityResult(BaseModel):
    id: UUID4
    media_id: UUID4
    is_ai_generated: bool
    ai_confidence: float
    is_tampered: bool
    tamper_confidence: float
    forensics_score: float
    fusion_label: str               # real | ai_generated | tampered | uncertain
    heatmap_storage_key: Optional[str] = None
    metadata_flags: list[str] = []
    error: Optional[str] = None
    analyzed_at: datetime


# ── Report ────────────────────────────────────
class ReportObject(BaseModel):
    id: UUID4
    media_id: UUID4
    scan_id: UUID4
    viz_storage_key: str
    notice_text: str
    evidence_urls: list[str]
    generated_at: datetime


# ── Pipeline boundary — dapp ──────────────────
class PipelineInput(BaseModel):
    image_bytes: bytes
    storage_key: str
    media_id: str
    phash: str
    model_config = {"arbitrary_types_allowed": True}


class PipelineOutput(BaseModel):
    matches: list[MatchResult]
    clip_embedding: list[float]
    viz_bytes: Optional[bytes] = None
    notice_text: Optional[str] = None
    error: Optional[str] = None
    model_config = {"arbitrary_types_allowed": True}


# ── Pipeline boundary — Veridex ───────────────
class VeridexInput(BaseModel):
    image_bytes: bytes
    media_id: str
    model_config = {"arbitrary_types_allowed": True}


class VeridexOutput(BaseModel):
    is_ai_generated: bool
    ai_confidence: float
    is_tampered: bool
    tamper_confidence: float
    forensics_score: float
    fusion_label: str
    heatmap_bytes: Optional[bytes] = None
    metadata_flags: list[str] = []
    error: Optional[str] = None
    model_config = {"arbitrary_types_allowed": True}


# resolve forward ref
ScanResult.model_rebuild()
```

---

## PHASE 2 — CORE LAYER

### `app/core/config.py`

```python
# app/core/config.py

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_KEY: str
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_BACKEND: str = "redis://localhost:6379/1"
    SYNC_MODE: bool = False
    SIMILARITY_THRESHOLD: float = 0.40
    MAX_FILE_SIZE_MB: int = 20
    ALLOWED_MIME_TYPES: list[str] = ["image/jpeg", "image/png", "image/webp"]

    # Veridex
    VERIDEX_ENABLED: bool = True
    VERIDEX_AI_THRESHOLD: float = 0.75
    VERIDEX_TAMPER_THRESHOLD: float = 0.60
    VERIDEX_AS_SIDECAR: bool = False        # True = call Veridex via HTTP (separate process)
    VERIDEX_SIDECAR_URL: str = "http://localhost:8001"

    model_config = {"env_file": ".env"}


settings = Settings()
```

---

### `app/core/db.py`

```python
# app/core/db.py

from supabase import create_client, Client
from app.core.config import settings

_client: Client | None = None


def get_db() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return _client
```

---

### `app/core/storage.py` *(fixed)*

```python
# app/core/storage.py

from app.core.db import get_db
from app.core.config import settings   # FIX: use settings.SUPABASE_URL not get_db().supabase_url


class StorageClient:
    """
    DB stores storage_key (path string) ONLY.
    URLs generated on-demand. Never stored in DB — they expire.
    """

    async def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        get_db().storage.from_(bucket).upload(
            path, data, {"content-type": content_type, "upsert": "true"}
        )
        return path

    async def download(self, bucket: str, path: str) -> bytes:
        return get_db().storage.from_(bucket).download(path)

    def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        result = get_db().storage.from_(bucket).create_signed_url(path, expires_in)
        return result["signedURL"]

    def get_public_url(self, bucket: str, path: str) -> str:
        """Only for public buckets."""
        return f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}"   # FIX


storage_client = StorageClient()
```

---

### `app/core/errors.py` *(fixed)*

```python
# app/core/errors.py

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from fastapi import Request
from fastapi.responses import JSONResponse


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
)
async def download_with_retry(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, follow_redirects=True)
        r.raise_for_status()
        return r.content


async def safe_download(url: str) -> bytes | None:
    """FIX: async def — was sync calling asyncio.run() inside potentially async context."""
    try:
        return await download_with_retry(url)
    except Exception:
        return None


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )
```

---

## PHASE 3 — MIGRATIONS

### `migrations/001_init.sql` *(fixed)*

```sql
-- migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS media_files (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    storage_key     TEXT NOT NULL UNIQUE,
    phash           TEXT NOT NULL,
    clip_embedding  vector(512),
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON media_files (phash);
CREATE INDEX ON media_files (user_id);

-- FIX: do NOT create ivfflat index at migration time — it requires data to exist.
-- Run this manually AFTER you have >1000 rows:
-- CREATE INDEX ON media_files
--     USING ivfflat (clip_embedding vector_cosine_ops)
--     WITH (lists = 100);

CREATE TABLE IF NOT EXISTS scan_results (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_id            UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'pending',
    matches             JSONB NOT NULL DEFAULT '[]',
    total_matches       INT NOT NULL DEFAULT 0,
    max_risk            TEXT NOT NULL DEFAULT 'low',
    scan_duration_ms    INT NOT NULL DEFAULT 0,
    error               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON scan_results (media_id);
CREATE INDEX ON scan_results (status);

CREATE TABLE IF NOT EXISTS legal_reports (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_id            UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    scan_id             UUID NOT NULL REFERENCES scan_results(id),
    viz_storage_key     TEXT NOT NULL,
    notice_text         TEXT NOT NULL,
    evidence_urls       JSONB NOT NULL DEFAULT '[]',
    generated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON legal_reports (media_id);

CREATE OR REPLACE FUNCTION find_similar_assets(
    query_embedding vector(512),
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id UUID, user_id UUID, storage_key TEXT, phash TEXT,
    clip_embedding vector(512), filename TEXT, mime_type TEXT,
    created_at TIMESTAMPTZ, similarity float
)
LANGUAGE sql STABLE AS $$
    SELECT
        id, user_id, storage_key, phash, clip_embedding,
        filename, mime_type, created_at,
        1 - (clip_embedding <=> query_embedding) AS similarity
    FROM media_files
    WHERE 1 - (clip_embedding <=> query_embedding) > match_threshold
    ORDER BY clip_embedding <=> query_embedding
    LIMIT match_count;
$$;
```

---

### `migrations/002_field_rename.sql`

```sql
-- migrations/002_field_rename.sql
-- Run only if migrating from old schema with inconsistent names.

-- ALTER TABLE media_files RENAME COLUMN file_url TO storage_key;
-- ALTER TABLE media_files RENAME COLUMN visual_dna TO clip_embedding;

-- Verify no banned column names remain:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'media_files'
--   AND column_name IN ('file_url','image_path','visual_dna','clip_vector','asset_id');
-- Must return 0 rows.
```

---

### `migrations/003_authenticity.sql` *(NEW)*

```sql
-- migrations/003_authenticity.sql

CREATE TABLE IF NOT EXISTS authenticity_results (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_id            UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    is_ai_generated     BOOLEAN NOT NULL DEFAULT FALSE,
    ai_confidence       FLOAT NOT NULL DEFAULT 0.0,
    is_tampered         BOOLEAN NOT NULL DEFAULT FALSE,
    tamper_confidence   FLOAT NOT NULL DEFAULT 0.0,
    forensics_score     FLOAT NOT NULL DEFAULT 0.0,
    fusion_label        TEXT NOT NULL DEFAULT 'uncertain',
    heatmap_storage_key TEXT,
    metadata_flags      JSONB NOT NULL DEFAULT '[]',
    error               TEXT,
    analyzed_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON authenticity_results (media_id);
CREATE INDEX ON authenticity_results (fusion_label);
CREATE INDEX ON authenticity_results (is_ai_generated);
```

---

## PHASE 4 — REPOSITORIES

### `app/repositories/asset_repo.py` *(fixed)*

```python
# app/repositories/asset_repo.py

import uuid
from datetime import datetime
from app.core.db import get_db
from app.schemas.contracts import AssetObject


class AssetRepo:

    TABLE = "media_files"

    async def create(
        self, user_id: str, storage_key: str, phash: str, filename: str, mime_type: str
    ) -> AssetObject:
        record = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "storage_key": storage_key,
            "phash": phash,
            "filename": filename,
            "mime_type": mime_type,
            "created_at": datetime.utcnow().isoformat(),
        }
        res = get_db().table(self.TABLE).insert(record).execute()
        return self._row_to_model(res.data[0])

    async def get_by_id(self, media_id: str) -> AssetObject | None:
        # FIX: .single() raises on Supabase if no row — use try/except
        try:
            res = (
                get_db().table(self.TABLE)
                .select("*").eq("id", media_id).single().execute()
            )
            return self._row_to_model(res.data) if res.data else None
        except Exception:
            return None

    async def find_by_phash(self, phash: str) -> AssetObject | None:
        res = (
            get_db().table(self.TABLE)
            .select("*").eq("phash", phash).limit(1).execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    async def update_embedding(self, media_id: str, embedding: list[float]) -> None:
        get_db().table(self.TABLE).update(
            {"clip_embedding": embedding}
        ).eq("id", media_id).execute()

    async def find_similar_by_embedding(
        self, embedding: list[float], threshold: float = 0.85
    ) -> list[AssetObject]:
        vec_str = "[" + ",".join(map(str, embedding)) + "]"
        res = get_db().rpc(
            "find_similar_assets",
            {"query_embedding": vec_str, "match_threshold": threshold, "match_count": 20},
        ).execute()
        return [self._row_to_model(r) for r in res.data]

    def _row_to_model(self, row: dict) -> AssetObject:
        return AssetObject(
            id=row["id"],
            user_id=row["user_id"],
            storage_key=row["storage_key"],
            phash=row["phash"],
            clip_embedding=row.get("clip_embedding"),
            filename=row["filename"],
            mime_type=row["mime_type"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )


asset_repo = AssetRepo()
```

---

### `app/repositories/scan_repo.py` *(fixed)*

```python
# app/repositories/scan_repo.py

import uuid
import json
from datetime import datetime
from app.core.db import get_db
from app.schemas.contracts import ScanResult, MatchResult


class ScanRepo:

    TABLE = "scan_results"

    async def create(self, media_id: str, status: str = "pending") -> ScanResult:
        record = {
            "id": str(uuid.uuid4()),
            "media_id": media_id,
            "status": status,
            "matches": "[]",
            "total_matches": 0,
            "max_risk": "low",
            "scan_duration_ms": 0,
            "created_at": datetime.utcnow().isoformat(),
        }
        res = get_db().table(self.TABLE).insert(record).execute()
        return self._row_to_model(res.data[0])

    async def get_by_id(self, scan_id: str) -> ScanResult | None:
        try:
            res = (
                get_db().table(self.TABLE)
                .select("*").eq("id", scan_id).single().execute()
            )
            return self._row_to_model(res.data) if res.data else None
        except Exception:
            return None

    async def get_latest_complete(self, media_id: str) -> ScanResult | None:
        res = (
            get_db().table(self.TABLE)
            .select("*").eq("media_id", media_id).eq("status", "complete")
            .order("created_at", desc=True).limit(1).execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    async def update_status(self, scan_id: str, status: str, error: str | None = None) -> None:
        update = {"status": status}
        if error:
            update["error"] = error
        get_db().table(self.TABLE).update(update).eq("id", scan_id).execute()

    async def save_matches(
        self,
        scan_id: str,
        media_id: str,
        matches: list[MatchResult],
        duration_ms: int,
        clip_embedding: list[float],   # used by caller to backfill asset; not stored here
    ) -> None:
        risk_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
        max_risk = max(
            (m.risk_level for m in matches),
            key=lambda r: risk_order.get(r, 0),
            default="low",
        )
        # FIX: removed clip_embedding_ref — column doesn't exist in schema
        get_db().table(self.TABLE).update({
            "matches": json.dumps([m.model_dump(mode="json") for m in matches]),
            "total_matches": len(matches),
            "max_risk": max_risk,
            "scan_duration_ms": duration_ms,
        }).eq("id", scan_id).execute()

    def _row_to_model(self, row: dict) -> ScanResult:
        raw = json.loads(row["matches"]) if isinstance(row["matches"], str) else row["matches"]
        matches = [MatchResult(**m) for m in raw]
        return ScanResult(
            id=row["id"],
            media_id=row["media_id"],
            status=row["status"],
            matches=matches,
            total_matches=row.get("total_matches", len(matches)),
            max_risk=row.get("max_risk", "low"),
            scan_duration_ms=row.get("scan_duration_ms", 0),
            error=row.get("error"),
            created_at=datetime.fromisoformat(row["created_at"]),
        )


scan_repo = ScanRepo()
```

---

### `app/repositories/report_repo.py`

```python
# app/repositories/report_repo.py

import uuid
import json
from datetime import datetime
from app.core.db import get_db
from app.schemas.contracts import ReportObject


class ReportRepo:

    TABLE = "legal_reports"

    async def create(
        self,
        media_id: str,
        scan_id: str,
        viz_storage_key: str,
        notice_text: str,
        evidence_urls: list[str],
    ) -> ReportObject:
        record = {
            "id": str(uuid.uuid4()),
            "media_id": media_id,
            "scan_id": scan_id,
            "viz_storage_key": viz_storage_key,
            "notice_text": notice_text,
            "evidence_urls": json.dumps(evidence_urls),
            "generated_at": datetime.utcnow().isoformat(),
        }
        res = get_db().table(self.TABLE).insert(record).execute()
        return self._row_to_model(res.data[0])

    async def get_by_media_id(self, media_id: str) -> ReportObject | None:
        res = (
            get_db().table(self.TABLE)
            .select("*").eq("media_id", media_id)
            .order("generated_at", desc=True).limit(1).execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    def _row_to_model(self, row: dict) -> ReportObject:
        urls = json.loads(row["evidence_urls"]) if isinstance(row["evidence_urls"], str) else row["evidence_urls"]
        return ReportObject(
            id=row["id"],
            media_id=row["media_id"],
            scan_id=row["scan_id"],
            viz_storage_key=row["viz_storage_key"],
            notice_text=row["notice_text"],
            evidence_urls=urls,
            generated_at=datetime.fromisoformat(row["generated_at"]),
        )


report_repo = ReportRepo()
```

---

### `app/repositories/authenticity_repo.py` *(NEW)*

```python
# app/repositories/authenticity_repo.py

import uuid
import json
from datetime import datetime
from app.core.db import get_db
from app.schemas.contracts import AuthenticityResult


class AuthenticityRepo:

    TABLE = "authenticity_results"

    async def create(
        self,
        media_id: str,
        is_ai_generated: bool,
        ai_confidence: float,
        is_tampered: bool,
        tamper_confidence: float,
        forensics_score: float,
        fusion_label: str,
        heatmap_storage_key: str | None,
        metadata_flags: list[str],
        error: str | None = None,
    ) -> AuthenticityResult:
        record = {
            "id": str(uuid.uuid4()),
            "media_id": media_id,
            "is_ai_generated": is_ai_generated,
            "ai_confidence": ai_confidence,
            "is_tampered": is_tampered,
            "tamper_confidence": tamper_confidence,
            "forensics_score": forensics_score,
            "fusion_label": fusion_label,
            "heatmap_storage_key": heatmap_storage_key,
            "metadata_flags": json.dumps(metadata_flags),
            "error": error,
            "analyzed_at": datetime.utcnow().isoformat(),
        }
        res = get_db().table(self.TABLE).insert(record).execute()
        return self._row_to_model(res.data[0])

    async def get_by_media_id(self, media_id: str) -> AuthenticityResult | None:
        res = (
            get_db().table(self.TABLE)
            .select("*").eq("media_id", media_id)
            .order("analyzed_at", desc=True).limit(1).execute()
        )
        return self._row_to_model(res.data[0]) if res.data else None

    def _row_to_model(self, row: dict) -> AuthenticityResult:
        flags = json.loads(row["metadata_flags"]) if isinstance(row["metadata_flags"], str) else row["metadata_flags"]
        return AuthenticityResult(
            id=row["id"],
            media_id=row["media_id"],
            is_ai_generated=row["is_ai_generated"],
            ai_confidence=row["ai_confidence"],
            is_tampered=row["is_tampered"],
            tamper_confidence=row["tamper_confidence"],
            forensics_score=row["forensics_score"],
            fusion_label=row["fusion_label"],
            heatmap_storage_key=row.get("heatmap_storage_key"),
            metadata_flags=flags,
            error=row.get("error"),
            analyzed_at=datetime.fromisoformat(row["analyzed_at"]),
        )


authenticity_repo = AuthenticityRepo()
```

---

## PHASE 5 — PIPELINE RUNNERS (pure functions — zero DB, zero storage)

### `app/pipeline/runner.py`

```python
# app/pipeline/runner.py
# PURE FUNCTION. NO DB. NO STORAGE. NO SIDE EFFECTS.

from app.schemas.contracts import PipelineInput, PipelineOutput, MatchResult
from pipeline.app.embedder import extract as clip_extract
from pipeline.app.phash import compute as phash_compute
from pipeline.app.region import extract_regions
from pipeline.app.search import find_similar as web_search
from pipeline.app.comparator import compare_all
from pipeline.app.analyzer import score_matches
from pipeline.app.visualizer import generate as viz_generate
from pipeline.app.notice import generate_text as notice_generate


def run_pipeline(inp: PipelineInput) -> PipelineOutput:
    try:
        clip_vec: list[float] = clip_extract(inp.image_bytes)
        region_vecs = extract_regions(inp.image_bytes)
        candidate_urls: list[str] = web_search(clip_vec)
        raw_matches: list[dict] = compare_all(
            source_bytes=inp.image_bytes,
            source_phash=inp.phash,
            source_clip=clip_vec,
            source_regions=region_vecs,
            candidate_urls=candidate_urls,
        )
        scored: list[dict] = score_matches(raw_matches)
        viz_bytes: bytes | None = viz_generate(inp.image_bytes, scored) if scored else None
        notice_text: str | None = notice_generate(scored) if scored else None
        matches = [MatchResult(**m) for m in scored]

        return PipelineOutput(
            matches=matches,
            clip_embedding=clip_vec,
            viz_bytes=viz_bytes,
            notice_text=notice_text,
        )

    except Exception as e:
        return PipelineOutput(
            matches=[], clip_embedding=[], error=str(e)
        )
```

---

### `app/pipeline/veridex_runner.py` *(NEW)*

> ⚠️ **Python version warning:** Veridex uses cpython-314 (Python 3.14 alpha). If your dapp runs Python 3.11/3.12, do NOT import Veridex modules directly — they will crash at import. Set `VERIDEX_AS_SIDECAR=true` in `.env` and use the HTTP path instead.

```python
# app/pipeline/veridex_runner.py
# PURE FUNCTION. NO DB. NO STORAGE. NO SIDE EFFECTS.

import sys
from app.schemas.contracts import VeridexInput, VeridexOutput


def run_veridex(inp: VeridexInput) -> VeridexOutput:
    """
    Direct import path — only works if Veridex runs same Python version as dapp.
    If Python version mismatch → use veridex_runner_http.py instead.
    """
    try:
        from veridex.app.modules.classifier import classify
        from veridex.app.modules.forensics import analyze as forensics_analyze
        from veridex.app.modules.fusion import fuse
        from veridex.app.modules.metadata import extract_flags
        from veridex.app.utils.heatmap import generate as heatmap_generate

        clf_result: dict = classify(inp.image_bytes)
        forensics_result: dict = forensics_analyze(inp.image_bytes)
        meta_flags: list[str] = extract_flags(inp.image_bytes)
        fusion: dict = fuse(clf_result, forensics_result, meta_flags)

        heatmap_bytes: bytes | None = None
        if clf_result.get("is_ai") or forensics_result.get("is_tampered"):
            heatmap_bytes = heatmap_generate(inp.image_bytes, forensics_result)

        return VeridexOutput(
            is_ai_generated=clf_result["is_ai"],
            ai_confidence=clf_result["confidence"],
            is_tampered=forensics_result["is_tampered"],
            tamper_confidence=forensics_result["confidence"],
            forensics_score=forensics_result["score"],
            fusion_label=fusion["label"],
            heatmap_bytes=heatmap_bytes,
            metadata_flags=meta_flags,
        )

    except Exception as e:
        return VeridexOutput(
            is_ai_generated=False, ai_confidence=0.0,
            is_tampered=False, tamper_confidence=0.0,
            forensics_score=0.0, fusion_label="uncertain",
            error=str(e),
        )
```

---

### `app/pipeline/veridex_runner_http.py` *(NEW — use when Python version mismatch)*

```python
# app/pipeline/veridex_runner_http.py
# Used when VERIDEX_AS_SIDECAR=true
# Veridex runs as separate FastAPI process on port 8001

import httpx
import base64
from app.schemas.contracts import VeridexInput, VeridexOutput
from app.core.config import settings


async def run_veridex_http(inp: VeridexInput) -> VeridexOutput:
    """Call Veridex sidecar via HTTP. Veridex runs on its own port/Python version."""
    try:
        encoded = base64.b64encode(inp.image_bytes).decode()
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{settings.VERIDEX_SIDECAR_URL}/analyze",
                json={"image_b64": encoded, "media_id": inp.media_id},
            )
            r.raise_for_status()
            data = r.json()

        return VeridexOutput(
            is_ai_generated=data["is_ai_generated"],
            ai_confidence=data["ai_confidence"],
            is_tampered=data["is_tampered"],
            tamper_confidence=data["tamper_confidence"],
            forensics_score=data["forensics_score"],
            fusion_label=data["fusion_label"],
            heatmap_bytes=base64.b64decode(data["heatmap_b64"]) if data.get("heatmap_b64") else None,
            metadata_flags=data.get("metadata_flags", []),
        )

    except Exception as e:
        return VeridexOutput(
            is_ai_generated=False, ai_confidence=0.0,
            is_tampered=False, tamper_confidence=0.0,
            forensics_score=0.0, fusion_label="uncertain",
            error=str(e),
        )
```

---

## PHASE 6 — SERVICES

### `app/services/asset_service.py` *(fixed)*

```python
# app/services/asset_service.py

from app.repositories.asset_repo import asset_repo
from app.core.storage import storage_client
from app.core.config import settings
from app.schemas.contracts import UploadResponse
from pipeline.app.phash import compute as phash_compute


class AssetService:

    async def upload_asset(
        self, user_id: str, file_bytes: bytes, filename: str, mime_type: str
    ) -> UploadResponse:

        if mime_type not in settings.ALLOWED_MIME_TYPES:
            raise ValueError(f"Unsupported file type: {mime_type}")

        if len(file_bytes) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
            raise ValueError(f"File exceeds {settings.MAX_FILE_SIZE_MB}MB limit")

        phash_val: str = phash_compute(file_bytes)

        existing = await asset_repo.find_by_phash(phash_val)
        if existing:
            return UploadResponse(
                asset=existing, is_duplicate=True, message="Asset already registered"
            )

        storage_key = await storage_client.upload(
            bucket="assets",
            path=f"{user_id}/{filename}",
            data=file_bytes,
            content_type=mime_type,
        )

        asset = await asset_repo.create(
            user_id=user_id,
            storage_key=storage_key,
            phash=phash_val,
            filename=filename,
            mime_type=mime_type,
        )

        return UploadResponse(asset=asset, is_duplicate=False)


asset_service = AssetService()
```

---

### `app/services/scan_service.py`

```python
# app/services/scan_service.py

import time
from app.repositories.asset_repo import asset_repo
from app.repositories.scan_repo import scan_repo
from app.core.storage import storage_client
from app.core.config import settings
from app.schemas.contracts import PipelineInput, ScanResult
from app.pipeline.runner import run_pipeline


class ScanService:

    async def initiate_scan(self, media_id: str) -> dict:
        asset = await asset_repo.get_by_id(media_id)
        if not asset:
            raise ValueError(f"Asset {media_id} not found")

        scan = await scan_repo.create(media_id=media_id, status="pending")
        scan_id = str(scan.id)

        if settings.SYNC_MODE:
            await self.execute_scan(scan_id, media_id, asset.storage_key, asset.phash)
            updated = await scan_repo.get_by_id(scan_id)
            return {"scan_id": scan_id, "status": updated.status, "scan": updated}

        from app.workers.tasks import scan_task
        scan_task.delay(
            scan_id=scan_id, media_id=media_id,
            storage_key=asset.storage_key, phash=asset.phash,
        )

        return {"scan_id": scan_id, "status": "pending", "poll_url": f"/scans/status/{scan_id}"}

    async def execute_scan(
        self, scan_id: str, media_id: str, storage_key: str, phash: str
    ) -> None:
        await scan_repo.update_status(scan_id, "running")
        start = time.time()

        try:
            image_bytes = await storage_client.download(bucket="assets", path=storage_key)
            output = run_pipeline(PipelineInput(
                image_bytes=image_bytes, storage_key=storage_key,
                media_id=media_id, phash=phash,
            ))

            if output.error:
                await scan_repo.update_status(scan_id, "failed", error=output.error)
                return

            duration_ms = int((time.time() - start) * 1000)
            await scan_repo.save_matches(
                scan_id=scan_id, media_id=media_id,
                matches=output.matches, duration_ms=duration_ms,
                clip_embedding=output.clip_embedding,
            )

            if output.clip_embedding:
                await asset_repo.update_embedding(media_id, output.clip_embedding)

            await scan_repo.update_status(scan_id, "complete")

        except Exception as e:
            await scan_repo.update_status(scan_id, "failed", error=str(e))
            raise

    async def get_status(self, scan_id: str) -> ScanResult:
        scan = await scan_repo.get_by_id(scan_id)
        if not scan:
            raise ValueError(f"Scan {scan_id} not found")
        return scan


scan_service = ScanService()
```

---

### `app/services/authenticity_service.py` *(NEW)*

```python
# app/services/authenticity_service.py

from app.repositories.asset_repo import asset_repo
from app.repositories.authenticity_repo import authenticity_repo
from app.core.storage import storage_client
from app.core.config import settings
from app.schemas.contracts import AuthenticityResult, VeridexInput


class AuthenticityService:

    async def analyze(self, media_id: str) -> AuthenticityResult:
        asset = await asset_repo.get_by_id(media_id)
        if not asset:
            raise ValueError(f"Asset {media_id} not found")

        image_bytes = await storage_client.download(bucket="assets", path=asset.storage_key)

        # route to direct import or HTTP sidecar based on config
        if settings.VERIDEX_AS_SIDECAR:
            from app.pipeline.veridex_runner_http import run_veridex_http
            output = await run_veridex_http(VeridexInput(image_bytes=image_bytes, media_id=media_id))
        else:
            from app.pipeline.veridex_runner import run_veridex
            output = run_veridex(VeridexInput(image_bytes=image_bytes, media_id=media_id))

        heatmap_key: str | None = None
        if output.heatmap_bytes:
            heatmap_key = await storage_client.upload(
                bucket="heatmaps",
                path=f"{media_id}/heatmap.jpg",
                data=output.heatmap_bytes,
                content_type="image/jpeg",
            )

        return await authenticity_repo.create(
            media_id=media_id,
            is_ai_generated=output.is_ai_generated,
            ai_confidence=output.ai_confidence,
            is_tampered=output.is_tampered,
            tamper_confidence=output.tamper_confidence,
            forensics_score=output.forensics_score,
            fusion_label=output.fusion_label,
            heatmap_storage_key=heatmap_key,
            metadata_flags=output.metadata_flags,
            error=output.error,
        )

    async def get_result(self, media_id: str) -> AuthenticityResult:
        result = await authenticity_repo.get_by_media_id(media_id)
        if not result:
            raise ValueError(f"No authenticity result for {media_id}. Run POST /authenticity/{{media_id}} first.")
        return result

    async def get_heatmap_url(self, media_id: str) -> str | None:
        result = await authenticity_repo.get_by_media_id(media_id)
        if not result or not result.heatmap_storage_key:
            return None
        return storage_client.get_signed_url(bucket="heatmaps", path=result.heatmap_storage_key)


authenticity_service = AuthenticityService()
```

---

### `app/services/report_service.py` *(updated — includes authenticity in notice)*

```python
# app/services/report_service.py

from app.repositories.asset_repo import asset_repo
from app.repositories.scan_repo import scan_repo
from app.repositories.report_repo import report_repo
from app.repositories.authenticity_repo import authenticity_repo
from app.core.storage import storage_client
from app.schemas.contracts import ReportObject
from pipeline.app.visualizer import generate as viz_generate
from pipeline.app.notice import generate_text as notice_generate


class ReportService:

    async def generate_report(self, media_id: str) -> tuple[ReportObject, str]:
        asset = await asset_repo.get_by_id(media_id)
        if not asset:
            raise ValueError(f"Asset {media_id} not found")

        scan = await scan_repo.get_latest_complete(media_id)
        if not scan:
            raise ValueError("No completed scan. Run POST /scans/{media_id} first.")

        image_bytes = await storage_client.download(bucket="assets", path=asset.storage_key)

        viz_bytes: bytes = viz_generate(image_bytes=image_bytes, matches=scan.matches)
        notice_text: str = notice_generate(matches=scan.matches)

        # append authenticity summary if available (non-blocking)
        auth = await authenticity_repo.get_by_media_id(media_id)
        if auth:
            notice_text += (
                f"\n\nAuthenticity Analysis: {auth.fusion_label.upper()} | "
                f"AI confidence: {auth.ai_confidence:.0%} | "
                f"Tamper confidence: {auth.tamper_confidence:.0%}"
            )

        viz_key = await storage_client.upload(
            bucket="reports", path=f"{media_id}/comparison.jpg",
            data=viz_bytes, content_type="image/jpeg",
        )

        report = await report_repo.create(
            media_id=media_id, scan_id=str(scan.id),
            viz_storage_key=viz_key, notice_text=notice_text,
            evidence_urls=[m.url for m in scan.matches],
        )

        viz_url = storage_client.get_signed_url(bucket="reports", path=viz_key)
        return report, viz_url


report_service = ReportService()
```

---

## PHASE 7 — API ROUTES

### `app/api/routes/assets.py` *(fixed — correct status code on duplicate)*

```python
# app/api/routes/assets.py

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from app.services.asset_service import asset_service

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("/upload")
async def upload(file: UploadFile = File(...), user_id: str = Form(...)):
    try:
        data = await file.read()
        result = await asset_service.upload_asset(
            user_id=user_id, file_bytes=data,
            filename=file.filename, mime_type=file.content_type,
        )
        # FIX: return correct HTTP status code for duplicates
        code = 409 if result.is_duplicate else 201
        return JSONResponse(status_code=code, content=result.model_dump(mode="json"))
    except ValueError as e:
        code = 413 if "exceeds" in str(e) else 400
        raise HTTPException(status_code=code, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Upload failed")
```

---

### `app/api/routes/scans.py`

```python
# app/api/routes/scans.py

from fastapi import APIRouter, HTTPException
from app.services.scan_service import scan_service

router = APIRouter(prefix="/scans", tags=["scans"])


@router.post("/{media_id}", status_code=202)
async def initiate_scan(media_id: str):
    try:
        return await scan_service.initiate_scan(media_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Scan initiation failed")


@router.get("/status/{scan_id}")
async def scan_status(scan_id: str):
    try:
        return await scan_service.get_status(scan_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
```

---

### `app/api/routes/reports.py`

```python
# app/api/routes/reports.py

from fastapi import APIRouter, HTTPException
from app.services.report_service import report_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/{media_id}", status_code=201)
async def generate_report(media_id: str):
    try:
        report, viz_url = await report_service.generate_report(media_id)
        return {"report": report, "viz_url": viz_url}
    except ValueError as e:
        code = 409 if "scan" in str(e).lower() else 404
        raise HTTPException(status_code=code, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Report generation failed")
```

---

### `app/api/routes/authenticity.py` *(NEW)*

```python
# app/api/routes/authenticity.py

from fastapi import APIRouter, HTTPException
from app.services.authenticity_service import authenticity_service
from app.core.config import settings

router = APIRouter(prefix="/authenticity", tags=["authenticity"])


@router.post("/{media_id}", status_code=201)
async def run_authenticity_check(media_id: str):
    if not settings.VERIDEX_ENABLED:
        raise HTTPException(status_code=503, detail="Veridex not enabled")
    try:
        result = await authenticity_service.analyze(media_id)
        heatmap_url = await authenticity_service.get_heatmap_url(media_id)
        return {"result": result, "heatmap_url": heatmap_url}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Authenticity analysis failed")


@router.get("/{media_id}")
async def get_authenticity_result(media_id: str):
    try:
        result = await authenticity_service.get_result(media_id)
        heatmap_url = await authenticity_service.get_heatmap_url(media_id)
        return {"result": result, "heatmap_url": heatmap_url}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
```

---

## PHASE 8 — WORKERS

### `app/workers/tasks.py` *(fixed + Veridex task added)*

```python
# app/workers/tasks.py

import asyncio
from celery import Celery
from app.core.config import settings

# FIX: nest_asyncio needed when asyncio.run() called inside existing event loop (e.g. some Celery setups)
try:
    import nest_asyncio
    nest_asyncio.apply()
except ImportError:
    pass  # not installed — fine if no loop conflict

celery_app = Celery("dapp", broker=settings.REDIS_URL, backend=settings.REDIS_BACKEND)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def scan_task(self, scan_id: str, media_id: str, storage_key: str, phash: str):
    from app.services.scan_service import scan_service
    try:
        asyncio.run(scan_service.execute_scan(scan_id, media_id, storage_key, phash))
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def authenticity_task(self, media_id: str):
    from app.services.authenticity_service import authenticity_service
    try:
        asyncio.run(authenticity_service.analyze(media_id))
    except Exception as exc:
        raise self.retry(exc=exc)
```

---

## PHASE 9 — ENTRY POINT

### `main.py` *(fixed — error handler wired, Veridex router added)*

```python
# main.py

from fastapi import FastAPI
from app.api.routes import assets, scans, reports, authenticity
from app.core.errors import global_exception_handler

app = FastAPI(title="Digital Asset Protection Platform", version="2.0.0")

# FIX: global_exception_handler was mentioned in comments but never registered
app.add_exception_handler(Exception, global_exception_handler)

app.include_router(assets.router)
app.include_router(scans.router)
app.include_router(reports.router)
app.include_router(authenticity.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## PHASE 10 — CONFIG FILES

### `.env.example`

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

REDIS_URL=redis://localhost:6379/0
REDIS_BACKEND=redis://localhost:6379/1

SYNC_MODE=false
SIMILARITY_THRESHOLD=0.40
MAX_FILE_SIZE_MB=20

VERIDEX_ENABLED=true
VERIDEX_AI_THRESHOLD=0.75
VERIDEX_TAMPER_THRESHOLD=0.60
VERIDEX_AS_SIDECAR=false
VERIDEX_SIDECAR_URL=http://localhost:8001
```

---

### `requirements.txt`

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
pydantic>=2.7.0
pydantic-settings>=2.3.0
supabase>=2.4.0
celery[redis]>=5.4.0
redis>=5.0.0
httpx>=0.27.0
tenacity>=8.3.0
python-multipart>=0.0.9
pgvector>=0.2.5
nest-asyncio>=1.6.0
```

---

### `Makefile`

```makefile
.PHONY: run worker lint-pipeline migrate

run:
	uvicorn main:app --reload --host 0.0.0.0 --port 8000

veridex-sidecar:
	cd veridex && uvicorn app.main:app --host 0.0.0.0 --port 8001

worker:
	celery -A app.workers.tasks.celery_app worker --loglevel=info --concurrency=2

lint-pipeline:
	bash scripts/lint_pipeline_purity.sh

migrate:
	psql $$DATABASE_URL -f migrations/001_init.sql
	psql $$DATABASE_URL -f migrations/002_field_rename.sql
	psql $$DATABASE_URL -f migrations/003_authenticity.sql
```

---

### `scripts/lint_pipeline_purity.sh` *(updated)*

```bash
#!/usr/bin/env bash
set -e

FAIL=0
echo "Checking pipeline purity..."

for RUNNER in "app/pipeline/runner.py" "app/pipeline/veridex_runner.py"; do
    if grep -q "from app.repositories" "$RUNNER" 2>/dev/null; then
        echo "FAIL: $RUNNER imports repositories"
        FAIL=1
    fi
    if grep -q "supabase" "$RUNNER" 2>/dev/null; then
        echo "FAIL: $RUNNER imports supabase"
        FAIL=1
    fi
    if grep -qE "\.insert\(|\.update\(|\.delete\(" "$RUNNER" 2>/dev/null; then
        echo "FAIL: $RUNNER contains DB write calls"
        FAIL=1
    fi
done

if grep -r "from app.repositories" "app/pipeline/" 2>/dev/null | grep -v "__pycache__"; then
    echo "FAIL: pipeline/ folder has repo imports"
    FAIL=1
fi

BANNED=("file_url" "image_path" "visual_dna" "clip_vector" "asset_id" "image_id" "match_score")
for name in "${BANNED[@]}"; do
    if grep -rn "\"$name\"\|'$name'" app/ 2>/dev/null | grep -v "__pycache__" | grep -v "migrations/" | grep -v "lint_"; then
        echo "WARN: banned field '$name' found"
    fi
done

[ $FAIL -eq 0 ] && echo "Pipeline purity check PASSED." || exit 1
```

---

## ENDPOINT REFERENCE

| Method | Route | What it does | Returns |
|--------|-------|--------------|---------|
| POST | `/assets/upload` | Upload image, dedupe check | `UploadResponse` (201/409) |
| POST | `/scans/{media_id}` | Start copyright scan | `{ scan_id, status, poll_url }` (202) |
| GET | `/scans/status/{scan_id}` | Poll scan progress | `ScanResult` |
| POST | `/reports/{media_id}` | Generate evidence + legal notice | `{ report, viz_url }` (201) |
| POST | `/authenticity/{media_id}` | Run Veridex AI/tamper check | `{ result, heatmap_url }` (201) |
| GET | `/authenticity/{media_id}` | Fetch existing result | `{ result, heatmap_url }` |
| GET | `/health` | Liveness probe | `{ status: ok }` |

---

## DEPLOY ORDER

Run these in exact order. Do not skip.

```
1.  cp .env.example .env  →  fill all values
2.  psql $DATABASE_URL -f migrations/001_init.sql
3.  psql $DATABASE_URL -f migrations/002_field_rename.sql   # only if migrating old schema
4.  psql $DATABASE_URL -f migrations/003_authenticity.sql
5.  pip install -r requirements.txt
6.  make run              # API on :8000
7.  make worker           # Celery in separate terminal
8.  make veridex-sidecar  # only if VERIDEX_AS_SIDECAR=true
9.  make lint-pipeline    # run in CI
```

---

## PYTHON VERSION DECISION TREE

```
Same Python version for dapp + Veridex?
│
├── YES → VERIDEX_AS_SIDECAR=false
│         Direct import in veridex_runner.py
│         One process, one port
│
└── NO  → VERIDEX_AS_SIDECAR=true
          Run `make veridex-sidecar` separately
          dapp calls Veridex via HTTP on :8001
          veridex_runner_http.py handles it
          Two processes, two ports, no conflict
```

Veridex currently uses cpython-314 (Python 3.14 alpha). Unless you've downgraded it, assume **SIDECAR MODE** is required. 🐍
