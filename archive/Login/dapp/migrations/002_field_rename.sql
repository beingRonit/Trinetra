-- migrations/002_field_rename.sql

ALTER TABLE media_files RENAME COLUMN file_url TO storage_key;
ALTER TABLE media_files RENAME COLUMN visual_dna TO clip_embedding;