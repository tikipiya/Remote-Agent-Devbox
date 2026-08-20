CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  actor_id UUID,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  security_epoch BIGINT NOT NULL,
  deployment_tier BIGINT NOT NULL,
  details JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT audit_events_epoch_check CHECK (security_epoch > 0),
  CONSTRAINT audit_events_tier_check CHECK (deployment_tier BETWEEN 1 AND 3),
  CONSTRAINT audit_events_severity_check
    CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
  CONSTRAINT audit_events_details_object_check
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_idx
  ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_type_idx
  ON audit_events (event_type, occurred_at DESC);

CREATE OR REPLACE FUNCTION rad_reject_audit_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION rad_reject_audit_event_mutation();
