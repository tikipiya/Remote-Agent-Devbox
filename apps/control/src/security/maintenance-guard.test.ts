import { describe, expect, it } from "vitest";

import { MaintenanceModeGuard } from "./maintenance-guard.js";

const metadata = {
  deploymentTier: 1,
  securityEpoch: 7,
  securityPostureHash: `sha256:${"a".repeat(64)}`,
  maintenanceMode: false,
  maintenanceReason: null,
  maintenanceStartedAt: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("MaintenanceModeGuard", () => {
  it("allows operations only when security metadata is present and operational", async () => {
    const guard = new MaintenanceModeGuard({ getSecurityMetadata: async () => metadata });
    await expect(guard.assertAvailable("Workspace creation")).resolves.toBe(metadata);
  });

  it("fails closed while maintenance is active or metadata is absent", async () => {
    const active = new MaintenanceModeGuard({
      getSecurityMetadata: async () => ({
        ...metadata,
        maintenanceMode: true,
        maintenanceReason: "security migration",
        maintenanceStartedAt: new Date(),
      }),
    });
    await expect(active.assertAvailable("Git operation start")).rejects.toThrow(
      "security maintenance",
    );
    const missing = new MaintenanceModeGuard({ getSecurityMetadata: async () => undefined });
    await expect(missing.assertAvailable("Agent task")).rejects.toThrow("metadata is missing");
  });
});
