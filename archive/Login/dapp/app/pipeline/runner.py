# app/pipeline/runner.py
# ─────────────────────────────────────────────
# PURE FUNCTION. NO DB. NO STORAGE. NO SIDE EFFECTS.
# Input:  PipelineInput
# Output: PipelineOutput
# ─────────────────────────────────────────────

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
            error=None,
        )

    except Exception as e:
        return PipelineOutput(
            matches=[],
            clip_embedding=[],
            viz_bytes=None,
            notice_text=None,
            error=str(e),
        )