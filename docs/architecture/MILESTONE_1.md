# Milestone 1 - Immutable Review Pipeline

## Status

Milestone 1 implements the Tier 1 Git Artifact, networkless structural
validation, CRF-1 canonicalization, and immutable Review Snapshot pipeline.
Approval and Git write operations remain Milestone 2 work.

## Pipeline

```text
READY Workspace
  -> clean committed Git Bundle
  -> trusted server-side SHA-256
  -> content-addressed artifact directory
  -> digest-pinned validator container
       network=none, read-only root, bounded tmpfs/resources
       read-only mount of only the artifact digest subdirectory
  -> structural Git manifest (raw paths encoded as canonical base64)
  -> trusted CRF-1 canonicalization
  -> immutable Review Snapshot + review digest
```

The Workspace supplies bytes, not identity. `rad-control` computes the
artifact digest while moving the bundle into trusted storage. Storage keys are
derived only from that digest and existing content-addressed bytes are never
replaced.

## Validator profile

Validation fails closed unless `RAD_VALIDATOR_IMAGE_DIGEST` matches the exact
Docker image ID resolved from `RAD_VALIDATOR_IMAGE`. The container is then
launched by that immutable ID, not by its mutable tag.

Every Review Snapshot stores the complete validator profile and its digest:

- image digest;
- `/usr/bin/git` binary digest;
- CRF version;
- canonicalizer digest;
- structural policy digest;
- runner configuration digest.

The validator recomputes the artifact SHA-256 before invoking Git. It verifies
the bundle in a temporary bare repository and never checks out its worktree.

## CRF-1

CRF-1 uses recursively sorted object keys, safe integer values, canonical
base64 for raw Git paths, and raw-byte path ordering. It rejects duplicate
paths, unsupported statuses, malformed object IDs, non-finite numbers,
`undefined`, and non-plain objects.

The review digest binds repository, workspace, base/target/tree object IDs,
artifact and validator profile digests, policy, deployment tier, security
epoch, security posture hash, and the structural file manifest.

Security metadata is sampled before and after validation. A posture or epoch
change discards the result. Snapshot insertion and the artifact transition to
`VALIDATED` occur in one database transaction. Reads recompute both canonical
digests and cross-check duplicated identity columns before returning data.

## HTTP surface

- `POST /api/workspaces/:id/artifacts` captures a clean committed workspace.
- `GET /api/artifacts/:id` returns artifact identity and state, never bytes.
- `POST /api/artifacts/:id/validate` creates or returns its Review Snapshot.
- `GET /api/reviews/:id` returns an integrity-checked immutable snapshot.

## Current limitations

- Artifact capture rejects dirty workspaces. Partial or uncommitted review is
  intentionally unsupported.
- Existing PostgreSQL volumes require the new migration to be applied by an
  operator; init scripts run automatically only for fresh volumes.
- Validator image build and digest pinning are separate operator steps.
- Approval binding and controlled GitHub write are Milestone 2.
