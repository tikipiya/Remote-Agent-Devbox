CREATE TABLE repositories (
    id UUID PRIMARY KEY,
    remote_url TEXT NOT NULL UNIQUE,
    default_branch TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
    desired_state TEXT NOT NULL,
    observed_state TEXT NOT NULL,
    state_version BIGINT NOT NULL DEFAULT 0,
    sandbox_backend TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_error TEXT,
    CONSTRAINT workspaces_desired_state_check
      CHECK (desired_state IN ('RUNNING', 'SUSPENDED', 'STOPPED', 'DESTROYED')),
    CONSTRAINT workspaces_observed_state_check
      CHECK (observed_state IN ('MISSING', 'PROVISIONING', 'STARTING', 'READY', 'BUSY', 'SUSPENDING', 'SUSPENDED', 'STOPPING', 'STOPPED', 'DESTROYING', 'DESTROYED', 'FAILED')),
    CONSTRAINT workspaces_state_version_check CHECK (state_version >= 0),
    CONSTRAINT workspaces_sandbox_backend_check CHECK (sandbox_backend = 'docker'),
    CONSTRAINT workspaces_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX workspaces_reconcile_idx
    ON workspaces (desired_state, observed_state, expires_at);

CREATE TABLE instance_metadata (
    singleton_key TEXT PRIMARY KEY DEFAULT 'instance',
    deployment_tier BIGINT NOT NULL,
    security_epoch BIGINT NOT NULL DEFAULT 1,
    security_posture_hash TEXT NOT NULL,
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    maintenance_reason TEXT,
    maintenance_started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT instance_metadata_singleton_check CHECK (singleton_key = 'instance'),
    CONSTRAINT instance_metadata_tier_check CHECK (deployment_tier BETWEEN 1 AND 3),
    CONSTRAINT instance_metadata_epoch_check CHECK (security_epoch > 0),
    CONSTRAINT instance_metadata_maintenance_check CHECK (
      (maintenance_mode AND maintenance_reason IS NOT NULL AND maintenance_started_at IS NOT NULL)
      OR (NOT maintenance_mode AND maintenance_reason IS NULL AND maintenance_started_at IS NULL)
    )
);
