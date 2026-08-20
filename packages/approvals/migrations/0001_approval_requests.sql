CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  review_snapshot_id UUID NOT NULL REFERENCES review_snapshots(id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type = 'CREATE_PULL_REQUEST'),
  review_digest TEXT NOT NULL,
  validator_profile_digest TEXT NOT NULL,
  security_epoch BIGINT NOT NULL CHECK (security_epoch > 0),
  deployment_tier INTEGER NOT NULL CHECK (deployment_tier BETWEEN 1 AND 3),
  security_posture_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'STALE')),
  stale_reason TEXT,
  requested_by UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  CONSTRAINT approval_requests_expiry_check CHECK (expires_at > requested_at),
  CONSTRAINT approval_requests_decision_check CHECK (
    (status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('APPROVED', 'DENIED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'STALE' AND decided_by IS NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT approval_requests_stale_reason_check CHECK (
    (status = 'STALE' AND stale_reason IS NOT NULL)
    OR (status <> 'STALE' AND stale_reason IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_active_review_idx
  ON approval_requests (review_snapshot_id)
  WHERE status IN ('PENDING', 'APPROVED');

CREATE INDEX IF NOT EXISTS approval_requests_workspace_idx
  ON approval_requests (workspace_id, requested_at);
