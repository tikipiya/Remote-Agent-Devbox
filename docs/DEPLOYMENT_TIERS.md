# Deployment tiers

[日本語版](./ja/DEPLOYMENT_TIERS.md)

## Implemented tier

This release implements Tier 1 (Secure Personal / Small Team). The host,
PostgreSQL administrator, Docker daemon, and `rad-control` process are trusted.
Module boundaries inside `rad-control` improve auditability but are not process
isolation boundaries.

Tier values are minimum security contracts, not feature toggles. The current
binary accepts Tier 1 configuration only. Tier 2 and Tier 3 require controls
that are not implemented by this release and therefore cannot be selected.

## Versioned security posture

PostgreSQL stores the deployment tier, monotonic security epoch, and canonical
security-posture hash. Startup behavior is fail closed:

- exact tier and posture match: normal startup;
- configured tier below stored tier: silent downgrade blocked;
- configured tier above stored tier: upgrade validation required;
- same tier with a different posture hash: explicit migration required.

An explicit migration enters maintenance, blocks new sensitive work, rejects a
transition while any Git operation is `PUSHING`, stales pending/approved
approvals, cancels unfinished Git operations, invalidates active credential
leases, stops active Workspaces, increments the epoch, and writes append-only
audit events.

Old Review Snapshots remain readable, but their epoch and posture bindings
prevent them from authorizing work after migration. Existing Workspaces are
stopped and must be explicitly restarted in the new context.

## Upgrade and downgrade

Before an upgrade, deploy a binary that implements and validates every control
required by the target tier. Do not alter `instance_metadata` manually.

A downgrade requires the explicit admin workflow in
[Operations](./OPERATIONS.md#explicit-security-posture-migration). It is never
performed by editing `.env` and restarting. A failed or ambiguous migration
leaves maintenance mode active for operator inspection.

## Credential handling

GitHub installation-token bytes are never stored in PostgreSQL or the outbox.
An issued lease is locally expired during migration; because provider-side
revocation is not assumed, the deployment must also wait for the short-lived
provider token to expire when incident policy requires it.
