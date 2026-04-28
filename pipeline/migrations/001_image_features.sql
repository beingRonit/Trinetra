-- Migration: Add image_features table for storing phash and CLIP embeddings

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.image_features (
    id SERIAL PRIMARY KEY,
    media_id INTEGER REFERENCES public.media_files(id) ON DELETE CASCADE,
    phash VARCHAR(64),
    clip_embedding vector(512),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(media_id)
);

CREATE INDEX IF NOT EXISTS idx_image_features_phash ON public.image_features(phash);
CREATE INDEX IF NOT EXISTS idx_image_features_clip ON public.image_features USING ivfflat(clip_embedding vector_cosine_ops);