import asyncio
import io
import sys
print("DEBUG extraction.py: START OF FILE", file=sys.stderr)
sys.stderr.flush()

try:
    from app.embedder import (
        get_embedding_from_bytes,
        generate_captions_from_bytes,
    )
    from app.phash import get_phash_from_bytes
    from app.metadata import run_ela_metadata
    print("DEBUG extraction.py: Imports OK", file=sys.stderr)
except Exception as e:
    print(f"DEBUG extraction.py: Import error: {e}", file=sys.stderr)
    raise


print("DEBUG extraction.py: Module loaded")
sys.stdout.flush()

async def extract_all_features(image_data: bytes):
    import sys
    print("DEBUG extraction.py: START", file=sys.stderr)
    sys.stderr.flush()
        
    clip_task = asyncio.to_thread(get_embedding_from_bytes, image_data)
    blip_task = asyncio.to_thread(generate_captions_from_bytes, image_data)
    ela_task  = asyncio.to_thread(run_ela_metadata, image_data)

    print("DEBUG extraction.py: Awaiting gather...")
    sys.stdout.flush()
    clip_emb, blip_captions, ela_metadata = await asyncio.gather(
        clip_task, blip_task, ela_task
    )
    print("DEBUG extraction.py: Gather complete")
    sys.stdout.flush()

    phash = get_phash_from_bytes(image_data)

    return {
        "clip_embedding": clip_emb,
        "blip_captions": blip_captions,
        "ela_metadata": ela_metadata,
        "phash": str(phash),
    }