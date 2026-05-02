-- One-time recovery for protected assets created before /register stored account email.
-- This claims legacy registry rows that do not already have metadata.user_email.

UPDATE public.image_features
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('user_email', 'ronit9786@gmail.com')
WHERE COALESCE(metadata->>'user_email', '') = '';