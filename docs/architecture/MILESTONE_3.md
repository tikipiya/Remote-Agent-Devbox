# Milestone 3 - Operational Security Posture

## Status

Milestone 3 implements the Fourth Vertical Slice and automated Security Gate D
checks for Tier 1: explicit posture migration, maintenance mode, append-only
structured audit, a secret-free transactional outbox prototype, and expanded
review/operational visibility.

## Startup and migration boundary

`rad-control` initializes security metadata only for a new database. It never
silently synchronizes an existing tier or posture. Any difference requires the
standalone admin command, so a normal server startup cannot weaken or silently
replace the stored contract.

Migration uses maintenance plus a locked database transaction. `PUSHING` is a
hard blocker because the remote result may be ambiguous. Otherwise the
transaction invalidates security-sensitive state and increments the epoch
exactly once. Failure retains maintenance mode and records a critical event.

## Audit

Audit events have a database identity sequence, severity, actor, subject,
epoch, tier, bounded flat details, and occurrence time. Application validation
rejects secret-bearing detail keys. A PostgreSQL trigger rejects updates and
deletes so the table is append-only for the application database role.

Read-only status and audit endpoints are available at:

- `GET /api/security/status`
- `GET /api/audit-events?limit=50`

## Transactional outbox

Workspace desired-state mutation and outbox insertion share one transaction.
Commands carry only the Workspace ID and desired-state intent. Workers claim
with `FOR UPDATE SKIP LOCKED`, retry with bounded backoff, recover stale claims
after restart, and deliver to the existing idempotent reconciler. The
reconciler remains responsible for state convergence.

## Review coverage

The Review UI exposes every structurally validated path together with change
status, old/new modes, and old/new blob identities. The operational header
shows current tier, epoch, and maintenance state, and the audit timeline makes
posture transitions visible without enabling browser-side admin mutation.

## Deployment limitations

- Only Tier 1 controls are implemented by this binary.
- The admin command is a host/operator interface; no browser migration endpoint
  is exposed because the Tier 1 UI has no strong administrator authentication.
- Existing databases require migrations 007 through 009 before this binary is
  started.
- Audit append-only enforcement shares the Tier 1 PostgreSQL trust boundary and
  does not protect against a database superuser.
