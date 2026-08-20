# Remote Agent Devbox

Remote Agent Devbox is a self-hosted runtime for running AI coding agents in
isolated, disposable workspaces. The v0.9 architecture in [PLAN.md](./PLAN.md)
is the source of truth.

The current implementation targets **Tier 1 — Secure Personal / Small Team**
and the Milestone 1 immutable review pipeline.

## Security model

- Workspaces are untrusted.
- No Docker socket or GitHub write credential is mounted into a workspace.
- Codex model identity is held by a separate short-lived Agent Runner.
- Workspace and control-plane networks are separate.
- Resource limits are mandatory and configuration fails closed.
- Desired and observed workspace states are stored independently.
- Git artifacts receive a trusted server digest and are parsed by a
  digest-pinned, networkless validator.
- CRF-1 Review Snapshots bind exact validator and security context.

See [SECURITY.md](./SECURITY.md) for the trust boundary and deployment claims.

## Development

Requirements: Node.js 22+, Docker Engine 26+ with Compose, and PostgreSQL 16+.

Set `RAD_CODEX_API_KEY` in `.env` to run agent tasks. The key should belong to a
dedicated OpenAI project; it is never forwarded to a Workspace.

```bash
cp .env.example .env
npm ci
npm run check
docker compose --profile build build
# Copy the exact validator image ID into RAD_VALIDATOR_IMAGE_DIGEST in .env:
docker image inspect --format '{{.Id}}' remote-agent-devbox-validator:local
docker compose up
```

The HTTP service listens on `127.0.0.1:3000` by default. Discord support is
disabled unless both Discord environment variables are supplied.

## Documentation

- [Milestone 0 architecture](./docs/architecture/MILESTONE_0.md)
- [Milestone 1 immutable review pipeline](./docs/architecture/MILESTONE_1.md)
- [Codex identity boundary](./docs/architecture/CODEX_IDENTITY_BOUNDARY.md)
- [Security Gate A](./docs/security/SECURITY_GATE_A.md)
- [Security Gate B](./docs/security/SECURITY_GATE_B.md)
- [Operations](./docs/OPERATIONS.md)
