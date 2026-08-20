CREATE TABLE IF NOT EXISTS review_snapshots (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL UNIQUE REFERENCES git_artifacts(id) ON DELETE RESTRICT,
  crf_version TEXT NOT NULL CHECK (crf_version = 'CRF-1'),
  base_commit TEXT NOT NULL,
  target_commit TEXT NOT NULL,
  target_tree TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  validator_profile_digest TEXT NOT NULL,
  validator_profile JSONB NOT NULL,
  security_epoch BIGINT NOT NULL CHECK (security_epoch > 0),
  deployment_tier INTEGER NOT NULL CHECK (deployment_tier BETWEEN 1 AND 3),
  security_posture_hash TEXT NOT NULL,
  review_digest TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  structural_manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_snapshots_review_digest_idx
  ON review_snapshots (review_digest);

CREATE INDEX IF NOT EXISTS review_snapshots_workspace_idx
  ON review_snapshots (workspace_id, created_at);
