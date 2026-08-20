# Security Gate A — Workspace Isolation

## Enforced properties

- Workspace processes run as UID/GID `10001`.
- Docker drops all Linux capabilities and sets `no-new-privileges`.
- The root filesystem is read-only; bounded tmpfs mounts cover runtime state.
- CPU, memory, PID, and wall-clock limits are mandatory configuration.
- Workspace data uses a dedicated, per-workspace Docker volume.
- The IDE port is published on host loopback only.
- Workspace containers join only the workspace network.
- PostgreSQL joins only the internal control network.
- `rad-control` never forwards its process environment to a Workspace.
- The only Workspace environment values are repository URL/ref, agent branch,
  and workspace ID.
- No Docker socket, GitHub token, SSH agent, credential helper, or proxy
  credential is present in a Workspace.

## Automated negative tests

`security/gate-a/security-gate-a.test.ts` and the Docker Supervisor tests fail
if isolation-sensitive configuration regresses. They check network membership,
non-root execution, resource flags, read-only root configuration, loopback IDE
publication, and the absence of Docker/GitHub credential mounts.

## Trusted boundary

The Docker socket is mounted only into `rad-control`. This gives the Tier 1
trusted control process authority over the container runtime. It is explicitly
not a Workspace mount and is not claimed as a boundary against compromise of
`rad-control` itself.

## Manual deployment checks

Run these checks before claiming Security Gate A in a deployment:

```bash
docker inspect rad-ws-<workspace-id>
docker exec rad-ws-<workspace-id> test ! -S /var/run/docker.sock
docker exec rad-ws-<workspace-id> env
docker network inspect rad-control
docker network inspect rad-workspace
```

Confirm that the Workspace cannot resolve or connect to the database or
control container and that the limits match the configured values.

