import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";

const validEnvironment = {
  RAD_DATABASE_URL: "postgresql://rad:rad@localhost:5432/rad",
  RAD_WORKSPACE_IMAGE: "rad/workspace:local",
};

describe("loadRuntimeConfig", () => {
  it("loads conservative Tier 1 defaults", () => {
    const config = loadRuntimeConfig(validEnvironment);

    expect(config.RAD_DEPLOYMENT_TIER).toBe(1);
    expect(config.RAD_WORKSPACE_NETWORK).not.toBe(config.RAD_CONTROL_NETWORK);
    expect(config.RAD_WORKSPACE_PIDS).toBeGreaterThan(0);
    expect(config.RAD_ARTIFACT_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(config.RAD_ARTIFACT_VOLUME).toBe("rad-artifacts");
    expect(config.RAD_VALIDATOR_IMAGE_DIGEST).toBeUndefined();
    expect(config.RAD_APPROVAL_TTL_SECONDS).toBe(3_600);
    expect(config.RAD_IDE_ACCESS_CODE_TTL_SECONDS).toBe(60);
    expect(config.RAD_IDE_SESSION_TTL_SECONDS).toBe(3_600);
    expect(config.RAD_IDE_PROXY_PUBLIC_URL).toBe("http://127.0.0.1:3001");
  });

  it("rejects non-canonical validator image digests", () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnvironment, RAD_VALIDATOR_IMAGE_DIGEST: "latest" })
    ).toThrow();
  });

  it("fails closed when workspace and control networks are shared", () => {
    expect(() =>
      loadRuntimeConfig({
        ...validEnvironment,
        RAD_WORKSPACE_NETWORK: "shared",
        RAD_CONTROL_NETWORK: "shared",
      }),
    ).toThrow(/must be different/);
  });

  it("rejects a silent deployment tier downgrade", () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnvironment, RAD_DEPLOYMENT_TIER: "0" }),
    ).toThrow();
  });

  it("requires Discord credentials as a pair", () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnvironment, RAD_DISCORD_TOKEN: "secret" }),
    ).toThrow(/configured together/);
  });

  it("requires GitHub App credentials as one complete set", () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnvironment, RAD_GITHUB_APP_ID: "123" }),
    ).toThrow(/configured together/);
    expect(
      loadRuntimeConfig({
        ...validEnvironment,
        RAD_GITHUB_APP_ID: "123",
        RAD_GITHUB_INSTALLATION_ID: "456",
        RAD_GITHUB_PRIVATE_KEY_BASE64: "cGVt",
      }).RAD_GITHUB_INSTALLATION_ID,
    ).toBe(456);
  });

  it("allows startup without Codex identity but retains one when configured", () => {
    expect(loadRuntimeConfig(validEnvironment).RAD_CODEX_API_KEY).toBeUndefined();
    expect(
      loadRuntimeConfig({ ...validEnvironment, RAD_CODEX_API_KEY: "secret" })
        .RAD_CODEX_API_KEY,
    ).toBe("secret");
  });

  it("accepts only a high-entropy IDE proxy shared secret", () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnvironment, RAD_IDE_PROXY_SHARED_SECRET: "short" }),
    ).toThrow();
    expect(
      loadRuntimeConfig({
        ...validEnvironment,
        RAD_IDE_PROXY_SHARED_SECRET: "x".repeat(32),
      }).RAD_IDE_PROXY_SHARED_SECRET,
    ).toHaveLength(32);
  });
});
