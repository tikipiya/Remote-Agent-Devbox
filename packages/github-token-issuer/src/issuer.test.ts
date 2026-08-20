import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GitHubAppTokenIssuer, parseGitHubRepository } from "./issuer.js";

const now = new Date("2026-01-01T12:00:00Z");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyBase64 = Buffer.from(
  privateKey.export({ type: "pkcs8", format: "pem" }),
).toString("base64");

describe("GitHubAppTokenIssuer", () => {
  it("requests one-repository minimum-permission installation credentials", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const issuer = new GitHubAppTokenIssuer(
      {
        RAD_GITHUB_API_URL: "https://api.github.com",
        RAD_GITHUB_APP_ID: "123",
        RAD_GITHUB_INSTALLATION_ID: 456,
        RAD_GITHUB_PRIVATE_KEY_BASE64: privateKeyBase64,
      },
      metadata(7),
      async (url, init) => {
        requestUrl = String(url);
        requestInit = init;
        return Response.json(
          { token: "ghs_new_variable_length_token", expires_at: "2026-01-01T13:00:00Z" },
          { status: 201 },
        );
      },
      () => now,
    );

    const credential = await issuer.issueForOperation({
      operationId: "10000000-0000-4000-8000-000000000001",
      repositoryId: "20000000-0000-4000-8000-000000000001",
      repositoryRemoteUrl: "https://github.com/example/project.git",
      securityEpoch: 7,
    });

    expect(credential.token).toBe("ghs_new_variable_length_token");
    expect(requestUrl).toMatch(/\/app\/installations\/456\/access_tokens$/);
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      repositories: ["project"],
      permissions: { contents: "write", pull_requests: "write" },
    });
    const jwt = String((requestInit?.headers as Record<string, string>).authorization).slice(7);
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"));
    expect(payload).toMatchObject({ iss: "123" });
    expect(payload.exp - payload.iat).toBe(600);
  });

  it("checks epoch before network access", async () => {
    let called = false;
    const issuer = new GitHubAppTokenIssuer(
      {
        RAD_GITHUB_API_URL: "https://api.github.com",
        RAD_GITHUB_APP_ID: "123",
        RAD_GITHUB_INSTALLATION_ID: 456,
        RAD_GITHUB_PRIVATE_KEY_BASE64: privateKeyBase64,
      },
      metadata(8),
      async () => {
        called = true;
        return new Response();
      },
      () => now,
    );
    await expect(
      issuer.issueForOperation({
        operationId: "10000000-0000-4000-8000-000000000001",
        repositoryId: "20000000-0000-4000-8000-000000000001",
        repositoryRemoteUrl: "https://github.com/example/project.git",
        securityEpoch: 7,
      }),
    ).rejects.toThrow("epoch changed");
    expect(called).toBe(false);
  });
});

describe("parseGitHubRepository", () => {
  it("accepts only canonical github.com repository URLs", () => {
    expect(parseGitHubRepository("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      name: "repo",
    });
    expect(() => parseGitHubRepository("https://evil.test/owner/repo.git")).toThrow("github.com");
    expect(() => parseGitHubRepository("https://token@github.com/owner/repo.git")).toThrow(
      "canonical",
    );
  });
});

function metadata(securityEpoch: number) {
  return {
    getSecurityMetadata: async () => ({
      securityEpoch,
      deploymentTier: 1,
      securityPostureHash: `sha256:${"a".repeat(64)}`,
      maintenanceMode: false,
      maintenanceReason: null,
      maintenanceStartedAt: null,
      updatedAt: now,
    }),
  };
}
