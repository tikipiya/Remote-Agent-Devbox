# Operations

[日本語版](./ja/OPERATIONS.md)

## Local Tier 1 startup

1. Install Node.js 22.15+, Rootless Docker Engine 26+, and Docker Compose.
2. Copy `.env.example` to `.env`, replace the PostgreSQL password, and set a
   dedicated OpenAI project key as `RAD_CODEX_API_KEY`. Generate an independent
   IDE Proxy secret with `openssl rand -hex 32` and set it as
   `RAD_IDE_PROXY_SHARED_SECRET`.
3. Keep Discord variables empty unless a bot application is ready.
4. Build the images:

```bash
npm ci --ignore-scripts
npm run check
docker compose --profile build build
```

5. Resolve the validator image ID and copy the complete `sha256:...` value to
   `RAD_VALIDATOR_IMAGE_DIGEST` in `.env`:

```bash
docker image inspect --format '{{.Id}}' remote-agent-devbox-validator:local
```

6. Start the services:

```bash
docker compose up -d
```

Open `http://127.0.0.1:3000`.

Validation fails closed if the configured ID is absent or no longer matches
the local image. Re-resolve and explicitly update it after rebuilding the
validator. Run the standalone boundary check with a built image tagged
`remote-agent-devbox-validator:ci`:

```bash
npm run verify:validator
```

## One-time IDE access

`POST /api/workspaces/:id/ide-access` issues a one-time URL only for a `READY`
Workspace. The default code lifetime is 60 seconds and the resulting session
lifetime is 3,600 seconds, bounded by the Workspace expiry. Configure them with
`RAD_IDE_ACCESS_CODE_TTL_SECONDS` and `RAD_IDE_SESSION_TTL_SECONDS`.

The IDE Proxy is published separately at `RAD_IDE_PROXY_PORT` (default `3001`).
For a local Tier 1 deployment, keep `RAD_IDE_PROXY_PUBLIC_URL` at
`http://127.0.0.1:3001`. Remote access requires an operator-managed HTTPS
endpoint and the matching public URL; do not expose the Workspace code-server
port directly.

Control and `ide-proxy` must receive the same
`RAD_IDE_PROXY_SHARED_SECRET`. Rotating it changes the security posture and
requires the explicit migration workflow below. A missing secret disables IDE
access rather than falling back to the old unauthenticated direct URL.

Run the container boundary check against the CI-tagged image with:

```bash
RAD_IDE_PROXY_IMAGE=remote-agent-devbox-ide-proxy:local npm run verify:ide-proxy
```

## GitHub App for approved Git writes

Create and install a GitHub App on each target repository. Grant only these
repository permissions:

- Contents: Read and write
- Pull requests: Read and write

The App does not need webhook subscriptions. Record its numeric App ID and the
installation ID, generate a private key, and encode the complete PEM file as
base64 without changing its bytes. Set:

```text
RAD_GITHUB_API_URL=https://api.github.com
RAD_GITHUB_APP_ID=<numeric-app-id>
RAD_GITHUB_INSTALLATION_ID=<numeric-installation-id>
RAD_GITHUB_PRIVATE_KEY_BASE64=<base64-encoded-pem>
```

Restart `rad-control` after changing credentials. Installation tokens are
requested only after an approval and exact final revalidation; they are scoped
to the target repository and are never stored by Remote Agent Devbox.

Fresh PostgreSQL volumes load all schemas automatically. For an existing
volume, apply `005_approval_requests.sql` and then `006_git_operations.sql`
from the Compose init mapping before enabling Git writes. Back up the database
and apply them using the same database owner used by `rad-control`.

Run the credential-free remote compare-and-swap boundary test locally:

```bash
npm run verify:git-cas
```

Before claiming Security Gate C for a deployment, create an immutable Review
Snapshot, approve it, and complete one real pull request using that deployment's
GitHub App installation. Do not reuse production credentials for CI.

## Existing database migrations

PostgreSQL init files run automatically only for an empty data directory. Back
up an existing database and apply these files in order before starting the new
control image:

```text
007_operational_posture.sql
008_audit_events.sql
009_outbox_commands.sql
010_ide_access.sql
```

The source files and Compose mappings are:

```text
packages/workspace-state/migrations/0002_operational_posture.sql
packages/audit-events/migrations/0001_audit_events.sql
packages/outbox/migrations/0001_outbox_commands.sql
packages/ide-access/migrations/0001_ide_access.sql
```

Run them using the database owner configured for `rad-control`. Do not edit
`instance_metadata` directly.

## Explicit security posture migration

Changing a security-sensitive `.env` value makes normal startup fail closed
until the stored posture is explicitly migrated. First stop `control`, deploy
the new configuration/image, and inspect the current stored tier and epoch:

```bash
docker compose stop control
docker compose exec database psql -U rad -d rad -c \
  "SELECT deployment_tier, security_epoch, maintenance_mode FROM instance_metadata"
```

Run the admin command with a stable operator UUID, a non-secret reason, and the
exact confirmation derived from the query. This example migrates epoch 42 at
Tier 1 to the configured Tier 1 posture:

```bash
docker compose run --rm control \
  node apps/control/dist/admin.js security-migrate \
  --actor 10000000-0000-4000-8000-000000000001 \
  --reason "validator image rotation" \
  --confirm "MIGRATE EPOCH 42 TIER 1->1"
```

The command enters maintenance before invalidation. If a Git operation is
`PUSHING` or another check is ambiguous, it fails and intentionally leaves
maintenance active. Inspect the remote result and audit log, then retry using
the same reason after resolving the blocker. A different concurrent
maintenance reason is rejected.

After success, start `control` and verify `/health` reports `ok` with the new
epoch. Old approvals must be stale and active Workspaces must converge to
`STOPPED` before an operator restarts them. Unused IDE codes and active IDE
sessions must no longer resolve.

## Backup and restore

Back up PostgreSQL plus the artifact volume as one recovery point. GitHub token
bytes are not stored and therefore are not part of a backup.

After restoring PostgreSQL, do not expose the control service. Run the explicit
migration command with `--rotate-epoch`, even when tier and posture hash are
unchanged:

```bash
docker compose run --rm control \
  node apps/control/dist/admin.js security-migrate \
  --actor 10000000-0000-4000-8000-000000000001 \
  --reason "post-restore epoch rotation" \
  --confirm "MIGRATE EPOCH 42 TIER 1->1" \
  --rotate-epoch
```

Then reconcile Workspaces, inspect `GET /api/audit-events`, and only resume
service after the new epoch is visible. This prevents restored approvals from
being replayed under the old security context.

## Codex identity

The key remains in the Tier 1 control process and is forwarded only to a
short-lived trusted Agent Runner. It is not placed in the Workspace environment
or mounted filesystem. Do not use a personal shell's `CODEX_HOME` or a broadly
privileged organization key.

Verify the real App Server to Exec Server protocol without making a model call:

```bash
npm run verify:codex-boundary
```

After exporting `RAD_CODEX_API_KEY`, run the opt-in authenticated check. It
makes a real model request and verifies that Codex edits a temporary repository
through the Exec Server:

```bash
npm run verify:codex-task
```

## Rootless Docker socket

The default socket is `/run/user/1000/docker.sock`. Set
`RAD_DOCKER_SOCKET` in `.env` when the rootless daemon uses another UID or
location. Do not use a remote unauthenticated Docker TCP endpoint.

## Discord

Set `RAD_DISCORD_TOKEN` and `RAD_DISCORD_APPLICATION_ID` together. Set
`RAD_DISCORD_GUILD_ID` during development for immediate guild-scoped command
updates; omit it for a global `/rad-task` command.

The token remains in `rad-control`. It is not forwarded to a Workspace.

## Lifecycle recovery

The reconciler runs every `RAD_RECONCILE_INTERVAL_MS`. A failed operation keeps
the requested desired state and records `observed_state = FAILED`, allowing a
later reconciliation attempt to converge after the runtime problem is fixed.

Workspace desired-state changes also create a secret-free outbox command in
the same database transaction. The dispatcher retries boundedly and recovers
stale processing claims after restart; the reconciler remains responsible for
eventual state convergence.

Destroying a Workspace removes both its container and its data volume. This is
intentional and not recoverable unless the repository contains committed work.

## Shutdown

```bash
docker compose down
```

Add `--volumes` only when intentionally deleting PostgreSQL state. Workspace
volumes are removed by the lifecycle destroy operation.
