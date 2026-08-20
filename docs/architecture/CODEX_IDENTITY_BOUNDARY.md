# Codex Identity Boundary

[日本語版](../ja/architecture/CODEX_IDENTITY_BOUNDARY.md)

## Decision

Codex model identity belongs to a short-lived trusted Agent Runner, not to the
untrusted Workspace container. Each task uses two processes in separate
containers:

```text
Trusted Agent Runner                         Untrusted Workspace

OPENAI_API_KEY                              no model credential
Codex App Server  -- WebSocket loopback --> Codex Exec Server
model requests                               file and command execution
```

The Runner shares the Workspace network namespace with
`--network container:<workspace>`. The Exec Server listens only on
`127.0.0.1:4500`; it does not expose a host port or join the control network.
The Runner has no Workspace volume mount. Codex selects the remote environment
for the thread and turn, so repository reads, writes, and commands are handled
by the Exec Server in the Workspace.

## Secret handling

- `RAD_CODEX_API_KEY` is held by the Tier 1 control process.
- Docker receives the value through the Docker CLI child environment. The
  value is not placed in command-line arguments.
- Docker forwards it as `OPENAI_API_KEY` only to the short-lived Runner.
- The Runner has a read-only root filesystem and an ephemeral `CODEX_HOME`
  tmpfs, and is removed with `--rm` after the task.
- Workspace startup explicitly removes `OPENAI_API_KEY` and
  `CODEX_ACCESS_TOKEN` from its environment.
- The Workspace has neither the Runner filesystem nor the Docker socket, so
  repository code cannot inspect the Runner environment or container metadata.

The Docker daemon and `rad-control` remain inside the Tier 1 trusted computing
base. An operator should use a dedicated OpenAI project key with appropriate
spend limits and rotate it independently from personal credentials.

## Failure behavior

Task execution is rejected with `CODEX_IDENTITY_NOT_CONFIGURED` when the key is
absent. The App Server requires the pinned experimental remote-environment API,
waits for `environment/status=ready`, and fails closed on disconnected,
unknown, or timeout states. Unexpected App Server requests remain denied.

## Verification

`npm run verify:codex-boundary` launches the pinned Codex App Server and Exec
Server as real processes, connects the remote environment, and performs no
model request. CI repeats the same check inside the production Workspace image.
Supervisor and Security Gate A tests also assert that the key value is absent
from Docker arguments and that the Workspace has no credential or Runner volume
mount.

`npm run verify:codex-task` is the explicit, operator-run completion check. It
requires `RAD_CODEX_API_KEY`, makes a real model request, and verifies an edit in
a disposable repository executed through the credential-free Exec Server.
