import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "@rad/shared";

import { createControlServer, type ControlServices } from "./server.js";

function testServices(): ControlServices {
  const unavailable = async (): Promise<never> => {
    throw new Error("not used by this test");
  };
  return {
    config: loadRuntimeConfig({
      NODE_ENV: "test",
      RAD_DATABASE_URL: "postgresql://rad:rad@db/rad",
      RAD_WORKSPACE_IMAGE: "rad/workspace:local",
    }),
    repository: {
      createRepository: unavailable,
      getRepository: unavailable,
      findRepositoryByRemoteUrl: unavailable,
      createWorkspace: unavailable,
      getWorkspace: unavailable,
      listForReconciliation: unavailable,
      setDesiredState: unavailable,
      setObservedState: unavailable,
    },
    coordinator: { requestState: unavailable },
    reconciler: {
      reconcile: unavailable,
      reconcileAll: unavailable,
    },
    supervisor: {
      getIdeUrl: unavailable,
    },
    taskService: {
      run: unavailable,
      get: unavailable,
    },
    artifactService: {
      capture: unavailable,
      get: unavailable,
    },
    reviewService: {
      validateArtifact: unavailable,
      get: unavailable,
    },
    approvalService: {
      request: unavailable,
      get: unavailable,
      approve: unavailable,
      deny: unavailable,
    },
    gitOperationService: {
      start: unavailable,
      get: unavailable,
    },
    operationalGuard: {
      assertAvailable: async () => ({
        deploymentTier: 1,
        securityEpoch: 1,
        securityPostureHash: `sha256:${"a".repeat(64)}`,
        maintenanceMode: false,
        maintenanceReason: null,
        maintenanceStartedAt: null,
        updatedAt: new Date(),
      }),
    },
  };
}

describe("control server", () => {
  it("exposes a Tier 1 health endpoint", async () => {
    const server = createControlServer(testServices());
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", tier: 1 });
    await server.close();
  });

  it("rejects non-HTTPS repository URLs before persistence", async () => {
    const server = createControlServer(testServices());
    const response = await server.inject({
      method: "POST",
      url: "/api/repositories",
      payload: { remoteUrl: "ssh://git@example.test/project", defaultBranch: "main" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_REQUEST");
    await server.close();
  });

  it("rejects unsafe Git reference names", async () => {
    const server = createControlServer(testServices());
    const response = await server.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        remoteUrl: "https://example.test/project.git",
        defaultBranch: "main; touch /tmp/pwned",
      },
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("validates artifact identifiers before repository lookup", async () => {
    const server = createControlServer(testServices());
    const response = await server.inject({
      method: "GET",
      url: "/api/artifacts/not-a-uuid",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_REQUEST");
    await server.close();
  });
});
