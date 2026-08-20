CREATE TABLE IF NOT EXISTS ide_access_codes (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_digest TEXT NOT NULL UNIQUE,
  security_epoch BIGINT NOT NULL,
  workspace_state_version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  CONSTRAINT ide_access_codes_epoch_check CHECK (security_epoch > 0),
  CONSTRAINT ide_access_codes_state_version_check CHECK (workspace_state_version >= 0),
  CONSTRAINT ide_access_codes_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT ide_access_codes_terminal_check
    CHECK (NOT (consumed_at IS NOT NULL AND invalidated_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ide_access_codes_workspace_idx
  ON ide_access_codes (workspace_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS ide_access_sessions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_digest TEXT NOT NULL UNIQUE,
  security_epoch BIGINT NOT NULL,
  workspace_state_version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT ide_access_sessions_epoch_check CHECK (security_epoch > 0),
  CONSTRAINT ide_access_sessions_state_version_check CHECK (workspace_state_version >= 0),
  CONSTRAINT ide_access_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS ide_access_sessions_workspace_idx
  ON ide_access_sessions (workspace_id, expires_at DESC);
