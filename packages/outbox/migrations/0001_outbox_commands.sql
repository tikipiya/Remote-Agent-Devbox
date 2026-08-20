CREATE TABLE IF NOT EXISTS outbox_commands (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type = 'workspace'),
  aggregate_id UUID NOT NULL,
  command_type TEXT NOT NULL CHECK (
    command_type IN ('PROVISION', 'START', 'SUSPEND', 'STOP', 'DESTROY')
  ),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_commands_dispatch_idx
  ON outbox_commands (state, available_at, created_at);
