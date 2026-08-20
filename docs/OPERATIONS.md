# Operations

## Local Tier 1 startup

1. Install Node.js 22.15+, Rootless Docker Engine 26+, and Docker Compose.
2. Copy `.env.example` to `.env`, replace the PostgreSQL password, and set a
   dedicated OpenAI project key as `RAD_CODEX_API_KEY`.
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

Destroying a Workspace removes both its container and its data volume. This is
intentional and not recoverable unless the repository contains committed work.

## Shutdown

```bash
docker compose down
```

Add `--volumes` only when intentionally deleting PostgreSQL state. Workspace
volumes are removed by the lifecycle destroy operation.
