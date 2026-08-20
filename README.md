# Remote Agent Devbox

Remote Agent Devbox is a self-hosted runtime for running AI coding agents in
isolated, disposable workspaces. The v0.9 architecture in [PLAN.md](./PLAN.md)
is the source of truth.

The current implementation targets **Tier 1 — Secure Personal / Small Team**
and the Milestone 0 workspace vertical slice.

## Security model

- Workspaces are untrusted.
- No Docker socket or GitHub write credential is mounted into a workspace.
- Workspace and control-plane networks are separate.
- Resource limits are mandatory and configuration fails closed.
- Desired and observed workspace states are stored independently.

See [SECURITY.md](./SECURITY.md) for the trust boundary and deployment claims.

## Development

Requirements: Node.js 22+, Docker with Compose, and PostgreSQL 16+.

```bash
cp .env.example .env
npm ci
npm run check
docker compose --profile build build
docker compose up
```

The HTTP service listens on `127.0.0.1:3000` by default. Discord support is
disabled unless both Discord environment variables are supplied.

## Documentation

- [Milestone 0 architecture](./docs/architecture/MILESTONE_0.md)
- [Security Gate A](./docs/security/SECURITY_GATE_A.md)
- [Operations](./docs/OPERATIONS.md)
