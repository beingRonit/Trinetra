# app/schemas/contracts.py
# ─────────────────────────────────────────────
# CANONICAL FIELD NAMES — enforce everywhere
#   storage_key      NOT file_url / image_path / path / url
#   media_id       NOT asset_id / image_id / file_id
#   clip_embedding NOT visual_dna / vector / clip_vector
#   similarity_score NOT confidence / score / match_score
#   phash          NOT hash / img_hash / pHash
# ─────────────────────────────────────────────

from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class AssetObject(BaseModel):
    id: str
    user_id: str
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


class MatchResult(BaseModel):
    url: str
    similarity_score: float
    phash_distance: int = -1
    label: str = "unknown"
    risk_level: str = "low"
    is_fraud: bool = False
    region_matches: list[str] = []
    source_domain: str = ""
    discovered_at: datetime = None

    def model_post_init(self, __context):
        if self.discovered_at is None:
            self.discovered_at = datetime.utcnow()


class ScanResult(BaseModel):
    id: str
    media_id: str
    status: str
    matches: list[MatchResult] = []
    total_matches: int = 0
    max_risk: str = "low"
    scan_duration_ms: int = 0
    error: Optional[str] = None
    created_at: datetime


class ReportObject(BaseModel):
    id: str
    media_id: str
    scan_id: str
    viz_storage_key: str
    notice_text: str
    evidence_urls: list[str]
    generated_at: datetime


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
