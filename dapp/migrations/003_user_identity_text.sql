-- Store the canonical application owner key, not only provider UUIDs.
-- This allows OTP/email login and Clerk/Google login for the same email
-- to resolve to the same dashboard assets.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'media_files'
          AND column_name = 'user_id'
    ) THEN
        ALTER TABLE public.media_files
            ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

        CREATE INDEX IF NOT EXISTS media_files_user_id_idx ON public.media_files (user_id);
    END IF;
END $$;
