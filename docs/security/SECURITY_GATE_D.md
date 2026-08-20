# Security Gate D - Operational Posture

[日本語版](../ja/security/SECURITY_GATE_D.md)

## Enforced properties

- Existing security metadata is never silently rewritten during startup.
- Tier downgrade, upgrade, posture replacement, and restore rotation require
  an explicit operator command with an exact current epoch/tier confirmation.
- Maintenance blocks Workspace creation/start, agent tasks, Approval
  request/approval, Git Operation start, credential issuance, and credential
  use. Stop/destroy and read operations remain available.
- Migration locks current metadata and aborts if a Git operation is `PUSHING`.
- Pending/approved approvals become stale; unfinished operations are cancelled;
  reserved/issued leases are invalidated; active Workspaces are stopped.
- Security epoch is increment-only and checked against JavaScript safe-integer
  overflow before commit.
- Structured audit rows are append-only and reject secret-bearing detail keys.
- Outbox payloads accept only desired-state intent and cannot contain secrets.

## Automated checks

`npm run check` covers startup downgrade/posture rejection, maintenance fail
closed behavior, explicit confirmation, migration success/failure state,
secret-free audit/outbox schemas, bounded outbox retry, durable-before-delivery
ordering, and read-only status/audit APIs.

The regular container CI also builds the migration-bearing control image and
re-runs the validator, Codex identity, and Git CAS boundaries.

## Deployment gate

Back up PostgreSQL, apply migrations 007 through 010, and rehearse an epoch-only
rotation with a disposable deployment before claiming Gate D. Verify that old
approvals cannot be approved or used afterward, active Workspaces converge to
`STOPPED`, IDE codes/sessions are invalid, audit events are present, and the
service exits maintenance.

After every database restore, run an epoch-only rotation before resuming. A
restore that simply starts serving old approvals does not satisfy Gate D.
