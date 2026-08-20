# Milestone 2 - Approved Git Write Pipeline

## Status

Milestone 2 implements the Tier 1 human approval, exact final revalidation,
remote compare-and-swap, short-lived GitHub App credential, agent-branch push,
and pull-request creation pipeline. An authenticated deployment check still
requires an operator-provided GitHub App installation.

## Integrity chain

```text
Immutable Review Snapshot
  -> expiry-bounded Human Approval
  -> current security epoch/posture check
  -> exact networkless revalidation
  -> approved Review Digest reproduction
  -> observed remote agent-branch head
  -> credential lease reservation
  -> repository-scoped GitHub App installation token
  -> current epoch check
  -> explicit force-with-lease CAS push
  -> pull request to the configured default branch
```

Approval creation and decision transactions lock and compare the Review
Snapshot and singleton security metadata. They bind review and validator
profile digests, security epoch, deployment tier, and posture hash. Expired or
mismatched decisions become `STALE` rather than being approved.

One approval can create at most one Git Operation. Operation creation again
checks approval status and expiry, immutable review bindings, and current
security metadata in one transaction.

## Final revalidation

Before credential issuance, the original content-addressed artifact is parsed
again by the exact digest-pinned validator profile. The control plane rebuilds
CRF-1 and requires the approved Review Digest to reproduce exactly. Profile,
artifact, policy, epoch, posture, or manifest drift moves the operation to
`STALE`.

## Remote CAS

Only the exact workspace branch `agent/<workspace UUID>` is writable. The
configured default branch and every other ref are rejected before remote
access. The push contains one refspec and uses:

```text
--force-with-lease=refs/heads/<agent-branch>:<observed-head>
```

An empty expected value requires the remote branch not to exist. A changed
head becomes `CONFLICT`; the target is never blindly force-pushed.

## Credential lease

The GitHub App token request is scoped to one repository and only
`contents:write` plus `pull_requests:write`. Token bytes are never written to
PostgreSQL, the artifact store, Workspace storage, command arguments, or logs.
The database retains only lease state and timestamps.

A definitive CAS rejection consumes the one-use credential. An ambiguous
external result marks the lease `UNCERTAIN`, fails closed, and is never
automatically retried or reissued.

## HTTP surface

- `POST /api/reviews/:id/approvals`
- `GET /api/approvals/:id`
- `POST /api/approvals/:id/decision`
- `POST /api/approvals/:id/git-operations`
- `GET /api/git-operations/:id`

## Current limitations

- The Tier 1 local UI records a UUID actor but does not yet provide strong
  multi-user authentication. Keep the control API bound to host loopback.
- The explicit branch policy permits only `agent/<workspace UUID>` and blocks
  the default branch. Repository-specific protected-branch discovery is not
  requested because that would broaden GitHub App permissions.
- `PUSHING` and `UNCERTAIN` states require manual inspection after a control
  process crash; automatic external-side-effect recovery is intentionally
  disabled.
- Existing PostgreSQL volumes require migrations 005 and 006 to be applied by
  an operator.
