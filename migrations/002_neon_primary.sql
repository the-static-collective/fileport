-- FILEPORT-002 · additive, non-destructive migration.
-- Existing Fileport project was confirmed empty before migration.
-- New writes default to private Neon Object Storage. R2 can remain as an optional backend.
ALTER TABLE public.fileport_files
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'neon'
  CHECK (storage_provider IN ('neon', 'r2'));

COMMENT ON COLUMN public.fileport_files.storage_provider IS
  'Physical provider holding storage_key: neon is default, r2 is optional. Never infer location from bucket config.';
