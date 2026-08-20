import { describe, expect, it } from "vitest";

import { assertStartupSecurityMetadata } from "./security-posture.js";

const stored = {
  deploymentTier: 1,
  securityEpoch: 42,
  securityPostureHash: `sha256:${"a".repeat(64)}`,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("startup security posture", () => {
  it("accepts the exact stored security posture without changing its epoch", () => {
    expect(
      assertStartupSecurityMetadata(stored, {
        deploymentTier: 1,
        securityPostureHash: stored.securityPostureHash,
      }),
    ).toBe(stored);
  });

  it("blocks a silent tier downgrade", () => {
    expect(() =>
      assertStartupSecurityMetadata(
        { ...stored, deploymentTier: 2 },
        { deploymentTier: 1, securityPostureHash: stored.securityPostureHash },
      ),
    ).toThrow("explicit security migration");
  });

  it("requires an explicit migration for upgrades and posture changes", () => {
    expect(() =>
      assertStartupSecurityMetadata(
        stored,
        { deploymentTier: 2, securityPostureHash: stored.securityPostureHash },
      ),
    ).toThrow("validate controls");
    expect(() =>
      assertStartupSecurityMetadata(stored, {
        deploymentTier: 1,
        securityPostureHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow("Security-sensitive configuration changed");
  });
});
