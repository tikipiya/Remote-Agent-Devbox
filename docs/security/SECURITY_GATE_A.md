# Security Gate A — Workspace Isolation

[日本語版](../ja/security/SECURITY_GATE_A.md)

## Enforced properties

- Workspace processes run as UID/GID `10001`.
- Docker drops all Linux capabilities and sets `no-new-privileges`.
- The root filesystem is read-only; bounded tmpfs mounts cover runtime state.
- CPU, memory, PID, and wall-clock limits are mandatory configuration.
- Workspace data uses a dedicated, per-workspace Docker volume.
- Workspace code-server ports are not published. Only the dedicated IDE Proxy
  is published on host loopback.
- Workspace containers join only the workspace network.
- PostgreSQL joins only the internal control network.
- `rad-control` never forwards its process environment to a Workspace.
- The only Workspace environment values are repository URL/ref, agent branch,
  and workspace ID.
- No Docker socket, GitHub token, SSH agent, credential helper, or proxy
  credential is present in a Workspace.
- OpenAI model identity exists only in a short-lived, read-only Agent Runner
  with no Workspace volume. Commands execute through the credential-free Codex
  Exec Server in the Workspace.
- The IDE Proxy has no Docker socket, database/model/GitHub credential, or
  Workspace volume. It strips its authority cookie before upstream forwarding.

## Automated negative tests

`security/gate-a/security-gate-a.test.ts` and the Docker Supervisor tests fail
if isolation-sensitive configuration regresses. They check network membership,
non-root execution, resource flags, read-only root configuration, loopback IDE
publication, the absence of Docker/GitHub credential mounts, and separation of
the Codex App Server identity from the Workspace Exec Server. The one-time IDE
tests additionally enforce digest-only authority storage, direct-port removal,
Proxy hardening, and security-migration invalidation.

## Trusted boundary

The Docker socket is mounted only into `rad-control`. This gives the Tier 1
trusted control process authority over the container runtime. It is explicitly
not a Workspace mount and is not claimed as a boundary against compromise of
`rad-control` itself.

The dedicated IDE Proxy is also trusted in Tier 1 because it bridges only IDE
traffic between the control and Workspace networks. It is separately hardened
and receives none of the Control Plane's high-value credentials.

## Manual deployment checks

Run these checks before claiming Security Gate A in a deployment:

```bash
docker inspect rad-ws-<workspace-id>
docker inspect remote-agent-devbox-ide-proxy-1
docker exec rad-ws-<workspace-id> test ! -S /var/run/docker.sock
docker exec rad-ws-<workspace-id> env
docker network inspect rad-control
docker network inspect rad-workspace
```

Confirm that the Workspace cannot resolve or connect to the database or
control container, has no published host port, and that the limits match the
configured values. Confirm that only the IDE Proxy has a loopback publication.
