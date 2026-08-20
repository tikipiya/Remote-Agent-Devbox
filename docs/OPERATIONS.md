# Operations

## Local Tier 1 startup

1. Install Node.js 22.15+, Rootless Docker, and Docker Compose.
2. Copy `.env.example` to `.env`, replace the PostgreSQL password, and set a
   dedicated OpenAI project key as `RAD_CODEX_API_KEY`.
3. Keep Discord variables empty unless a bot application is ready.
4. Build and start:

```bash
npm ci --ignore-scripts
npm run check
docker compose --profile build build
docker compose up -d
```

Open `http://127.0.0.1:3000`.

## Codex identity

The key remains in the Tier 1 control process and is forwarded only to a
short-lived trusted Agent Runner. It is not placed in the Workspace environment
or mounted filesystem. Do not use a personal shell's `CODEX_HOME` or a broadly
privileged organization key.

Verify the real App Server to Exec Server protocol without making a model call:

```bash
npm run verify:codex-boundary
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
