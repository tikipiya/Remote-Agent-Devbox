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
});
