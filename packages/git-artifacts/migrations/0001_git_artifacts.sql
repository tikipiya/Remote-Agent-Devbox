CREATE TABLE IF NOT EXISTS git_artifacts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  artifact_digest TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  status TEXT NOT NULL CHECK (status IN ('STAGED', 'VALIDATED', 'REJECTED')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS git_artifacts_workspace_idx
  ON git_artifacts (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS git_artifacts_digest_idx
  ON git_artifacts (artifact_digest);
