# Milestone 4 — One-time IDE Access

[日本語版](../ja/architecture/MILESTONE_4_IDE_ACCESS.md)

## Status

The one-time IDE access hardening item from Milestone 4 is implemented for
Tier 1. Other P3 hardening items remain separate work.

## Access flow

```text
READY Workspace
  -> Control issues 256-bit one-time code
  -> PostgreSQL stores only SHA-256(code)
  -> browser receives IDE Proxy URL with code in URL fragment
  -> fragment is removed before a bounded POST exchange
  -> Control atomically consumes code and creates a short-lived session
  -> IDE Proxy sets an HttpOnly, SameSite=Strict cookie
  -> every HTTP/WebSocket connection revalidates the session with Control
  -> IDE Proxy forwards to code-server on the Workspace network
```

The code is bound to the deployment tier, security epoch, Workspace ID, exact
Workspace `state_version`, and expiry. Issuing a replacement invalidates any
unused code for that Workspace. Redeeming a code revokes the previous active
session, and a consumed code cannot be used again.

The raw code is carried in the URL fragment, which is not sent in an HTTP
request or Referer. The bootstrap removes it from browser history before the
exchange. PostgreSQL, audit events, and logs retain no code or session-token
bytes.

## Proxy boundary

Workspace containers no longer publish the code-server port to the host. A
dedicated `ide-proxy` is the only loopback-published IDE endpoint. It joins the
control and Workspace networks but has no Docker socket, database credential,
model identity, GitHub credential, or Workspace volume. It runs as non-root
with a read-only root, all Linux capabilities dropped, and
`no-new-privileges`.

The Proxy authenticates to an internal Control endpoint with a dedicated
shared secret. It strips the IDE authority cookie and authorization headers
before forwarding. Non-authority upstream cookies are restricted to that
Workspace's path.

## Invalidation

Session resolution fails closed during maintenance, after expiry, after a
security epoch change, or whenever the Workspace state/version changes. An
explicit security posture migration invalidates every unused IDE code and
revokes every active IDE session in the same transaction that advances the
epoch.

## Tier 1 limitations

- The IDE Proxy is part of the Tier 1 trusted computing base.
- The public Proxy URL defaults to host loopback. Remote exposure requires an
  operator-managed HTTPS endpoint and corresponding `RAD_IDE_PROXY_PUBLIC_URL`.
- The local UI records a UUID actor but does not provide strong multi-user
  authentication.
- This work does not claim completion of the remaining P3 hardening items.
