CREATE TABLE IF NOT EXISTS git_operations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  review_snapshot_id UUID NOT NULL REFERENCES review_snapshots(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL UNIQUE REFERENCES approval_requests(id) ON DELETE RESTRICT,
  branch_name TEXT NOT NULL,
  target_commit TEXT NOT NULL,
  expected_remote_head TEXT,
  review_digest TEXT NOT NULL,
  validator_profile_digest TEXT NOT NULL,
  security_epoch BIGINT NOT NULL CHECK (security_epoch > 0),
  state TEXT NOT NULL CHECK (
    state IN (
      'PENDING', 'VALIDATING', 'WAITING_CREDENTIAL', 'PUSHING',
      'SUCCEEDED', 'FAILED', 'CONFLICT', 'CANCELLED', 'STALE'
    )
  ),
  stale_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  pull_request_number BIGINT,
  pull_request_url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT git_operations_remote_head_check CHECK (
    expected_remote_head IS NULL OR expected_remote_head ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  ),
  CONSTRAINT git_operations_target_check CHECK (
    target_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  )
);

CREATE INDEX IF NOT EXISTS git_operations_workspace_idx
  ON git_operations (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS git_operations_state_idx
  ON git_operations (state, created_at);

CREATE TABLE IF NOT EXISTS credential_leases (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES git_operations(id) ON DELETE RESTRICT,
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  security_epoch BIGINT NOT NULL CHECK (security_epoch > 0),
  state TEXT NOT NULL CHECK (
    state IN ('RESERVED', 'ISSUED', 'CONSUMED', 'EXPIRED', 'FAILED', 'UNCERTAIN')
  ),
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT credential_leases_issue_check CHECK (
    (state IN ('RESERVED', 'FAILED') AND issued_at IS NULL AND expires_at IS NULL)
    OR (state IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'UNCERTAIN') AND issued_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS credential_leases_state_idx
  ON credential_leases (state, created_at);
