import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const composePath = new URL("../../docker-compose.yml", import.meta.url);
const supervisorPath = new URL(
  "../../apps/control/src/workspace/docker-supervisor.ts",
  import.meta.url,
);
const proxyPath = new URL("../../apps/ide-proxy/src/server.ts", import.meta.url);
const migrationPath = new URL(
  "../../packages/ide-access/migrations/0001_ide_access.sql",
  import.meta.url,
);
const securityMigrationPath = new URL(
  "../../apps/control/src/security/security-migration.ts",
  import.meta.url,
);

describe("one-time IDE access boundary", () => {
  it("removes direct Workspace port publication and hardens the dedicated proxy", async () => {
    const compose = await readFile(composePath, "utf8");
    const supervisor = await readFile(supervisorPath, "utf8");
    const proxyBlock = compose.slice(compose.indexOf("  ide-proxy:"), compose.indexOf("\nnetworks:"));

    expect(supervisor).not.toContain('"--publish"');
    expect(proxyBlock).toContain('"127.0.0.1:${RAD_IDE_PROXY_PORT:-3001}:3001"');
    expect(proxyBlock).toContain("read_only: true");
    expect(proxyBlock).toContain("- ALL");
    expect(proxyBlock).toContain("- control");
    expect(proxyBlock).toContain("- workspace");
    expect(proxyBlock).not.toMatch(/docker\.sock|RAD_DATABASE_URL|OPENAI_API_KEY|GITHUB_TOKEN/);
  });

  it("keeps authority bytes out of storage, logs, and the untrusted upstream", async () => {
    const proxy = await readFile(proxyPath, "utf8");
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("code_digest TEXT NOT NULL UNIQUE");
    expect(migration).toContain("session_digest TEXT NOT NULL UNIQUE");
    expect(migration).not.toMatch(/\n\s+(code|session_token)\s+TEXT/i);
    expect(proxy).toContain("history.replaceState");
    expect(proxy).toContain('proxyRequest.removeHeader("authorization")');
    expect(proxy).toContain("forwardNonAuthorityCookies");
    expect(proxy).toContain('"HttpOnly"');
    expect(proxy).toContain("control.resolve(sessionToken)");
  });

  it("invalidates codes and sessions during explicit security migration", async () => {
    const migration = await readFile(securityMigrationPath, "utf8");

    expect(migration).toContain(".update(ideAccessCodes)");
    expect(migration).toContain(".update(ideAccessSessions)");
    expect(migration).toContain("invalidatedIdeCodes");
    expect(migration).toContain("revokedIdeSessions");
  });
});
