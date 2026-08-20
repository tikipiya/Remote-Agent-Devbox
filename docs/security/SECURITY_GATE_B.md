# Security Gate B - Artifact Integrity

[日本語版](../ja/security/SECURITY_GATE_B.md)

## Enforced properties

- Artifact SHA-256 is computed by trusted server code, never accepted from a
  Workspace.
- Artifact storage is content-addressed, no-overwrite, and read-only after
  commit.
- Each artifact has a dedicated digest directory. The validator receives only
  that directory through a read-only Docker volume subpath.
- The validator image ID must match an operator-configured SHA-256 exactly and
  the container is launched by that ID.
- Validator containers have no network, a read-only root, no Linux
  capabilities, `no-new-privileges`, a non-root UID, and CPU, memory, PID,
  file-descriptor, output, and wall-clock limits.
- Artifact bytes are re-hashed inside the isolated validator before Git parses
  them.
- Raw Git path bytes survive as canonical base64. CRF-1 ordering and hashing
  are deterministic.
- Review digests bind the exact validator profile and current security epoch,
  tier, posture, artifact, policy, commits, tree, and changed-file structure.
- Review Snapshots have create/read repository methods only. Snapshot creation
  and artifact validation state transition are atomic.
- Snapshot reads fail closed if stored identity fields or recomputed digests do
  not agree.

## Automated checks

`npm run check` covers content-addressed storage, unsafe storage/ref rejection,
raw non-UTF-8 path preservation, CRF determinism, profile pinning, Docker
isolation arguments, security-epoch races, and Review Snapshot idempotence.

CI also builds the real validator image and runs `npm run verify:validator`.
That check creates an actual Git Bundle and validates its base, target, tree,
path, and artifact digest in a networkless, read-only container using the same
digest-subdirectory mount used by the control plane.

## Deployment activation

Docker Engine 26 or newer is required for `volume-subpath`. After building the
validator image, record its exact local ID:

```bash
docker image inspect --format '{{.Id}}' remote-agent-devbox-validator:local
```

Set the result as `RAD_VALIDATOR_IMAGE_DIGEST` and restart `rad-control`.
Validation remains disabled rather than falling back to a mutable image tag
when the value is absent or mismatched.

## Trust statement

Gate B protects the artifact parser from network access and limits the data it
can read and mutate. Tier 1 still treats compromise of `rad-control`, the
Docker daemon, the database administrator, or the host administrator as
compromise of the trusted boundary.
