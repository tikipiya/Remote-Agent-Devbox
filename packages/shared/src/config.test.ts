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

  it("allows startup without Codex identity but retains one when configured", () => {
    expect(loadRuntimeConfig(validEnvironment).RAD_CODEX_API_KEY).toBeUndefined();
    expect(
      loadRuntimeConfig({ ...validEnvironment, RAD_CODEX_API_KEY: "secret" })
        .RAD_CODEX_API_KEY,
    ).toBe("secret");
  });
});
