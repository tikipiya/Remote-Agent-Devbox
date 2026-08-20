ALTER TABLE instance_metadata
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS maintenance_reason TEXT,
  ADD COLUMN IF NOT EXISTS maintenance_started_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instance_metadata_maintenance_check'
  ) THEN
    ALTER TABLE instance_metadata
      ADD CONSTRAINT instance_metadata_maintenance_check CHECK (
        (maintenance_mode AND maintenance_reason IS NOT NULL AND maintenance_started_at IS NOT NULL)
        OR (NOT maintenance_mode AND maintenance_reason IS NULL AND maintenance_started_at IS NULL)
      );
  END IF;
END $$;
