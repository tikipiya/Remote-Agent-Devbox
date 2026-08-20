# Security policy

## Supported security tier

The initial implementation targets Tier 1 (Secure Personal / Small Team). It
does not claim protection from a malicious host administrator or a compromise
of the trusted control process.

Tier 1 uses logical privilege separation inside `rad-control`. These module
boundaries reduce accidental privilege misuse and improve auditability, but do
not protect against compromise of the `rad-control` process itself. Compromise
of `rad-control` is considered compromise of the Tier 1 trusted control
boundary.

Workspace and validation containers are enforced isolation boundaries. A
workspace must never receive a Docker socket, GitHub write credential, control
plane credential, or route to the control network.

The approved Git write path binds an expiry-bounded approval to an immutable
review and the current security epoch, then repeats exact validation before a
single compare-and-swap push to the Workspace's dedicated agent branch. GitHub
App installation tokens are repository-scoped and retained only in memory.
See [Security Gate C](./docs/security/SECURITY_GATE_C.md) for enforced
properties and the deployment verification requirement.

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use GitHub's
private vulnerability reporting feature for this repository.
