# Security Gate C - Controlled Git Write

[日本語版](../ja/security/SECURITY_GATE_C.md)

## Enforced properties

- Approval is bound to an immutable review digest, exact validator profile,
  security epoch, tier, and posture, and has a bounded lifetime.
- Approval decisions and Git Operation creation repeat their binding checks in
  database transactions using row locks.
- Final revalidation uses the original immutable artifact, no network, and the
  exact approved validator profile.
- Only `agent/<workspace UUID>` can be pushed. Direct default-branch writes are
  rejected before remote access.
- Remote writes use one explicit refspec and an explicit expected-value
  `--force-with-lease`; no unqualified force push is used.
- GitHub App tokens are scoped to one repository and minimum write
  permissions. Token bytes are not persisted or placed in command arguments.
- Security epoch is checked before lease reservation, by the token issuer, and
  again immediately before credential use.
- Credential results are `CONSUMED`, `FAILED`, or `UNCERTAIN`; ambiguous
  results are not automatically retried.

## Automated checks

`npm run check` covers approval expiry and context binding, protected branch
blocking, exact review reproduction, token request scope, JWT lifetime,
credential non-exposure in Git arguments, PR idempotence, CAS conflicts, and
lease outcomes.

`npm run verify:git-cas` creates a real bare Git remote and proves all three
CAS cases: create only if absent, update only at the observed head, and reject
a stale expected head while leaving the remote unchanged.

## Deployment gate

An operator must configure and install a GitHub App, then run one approved
end-to-end Git write before claiming Gate C for that deployment. Until all
three App credential values are present, Git Operation creation fails before
remote observation or database mutation.

Gate C does not claim protection from compromise of `rad-control`, the host,
the Docker daemon, PostgreSQL administration, or GitHub App private-key
storage. Those remain inside the Tier 1 trusted boundary.
