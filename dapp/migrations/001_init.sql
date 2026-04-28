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
CREATE INDEX ON media_files
    USING ivfflat (clip_embedding vector_cosine_ops)
    WITH (lists = 100);

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
    id UUID,
    user_id UUID,
    storage_key TEXT,
    phash TEXT,
    clip_embedding vector(512),
    filename TEXT,
    mime_type TEXT,
    created_at TIMESTAMPTZ,
    similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        id, user_id, storage_key, phash, clip_embedding,
        filename, mime_type, created_at,
        1 - (clip_embedding <=> query_embedding) AS similarity
    FROM media_files
    WHERE 1 - (clip_embedding <=> query_embedding) > match_threshold
    ORDER BY clip_embedding <=> query_embedding
    LIMIT match_count;
$$;