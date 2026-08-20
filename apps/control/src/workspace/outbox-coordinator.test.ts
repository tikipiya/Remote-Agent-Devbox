import { describe, expect, it } from "vitest";

import type { OutboxCommand } from "@rad/outbox";
import type { Workspace } from "@rad/shared";

import {
  OutboxWorkspaceCoordinator,
  WorkspaceOutboxHandler,
} from "./outbox-coordinator.js";

const workspace = {
  id: "10000000-0000-4000-8000-000000000001",
  ownerUserId: "20000000-0000-4000-8000-000000000001",
  repositoryId: "30000000-0000-4000-8000-000000000001",
  desiredState: "STOPPED",
  observedState: "READY",
  stateVersion: 2,
  sandboxBackend: "docker",
  branchName: "agent/10000000-0000-4000-8000-000000000001",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  lastError: null,
} satisfies Workspace;

describe("workspace outbox integration", () => {
  it("persists intent before requesting delivery", async () => {
    const calls: string[] = [];
    const coordinator = new OutboxWorkspaceCoordinator(
      {
        requestWorkspaceState: async () => {
          calls.push("persist");
          return { workspace, command: {} as OutboxCommand };
        },
      },
      { dispatchAvailable: async () => { calls.push("dispatch"); return 1; } },
      { getWorkspace: async () => workspace },
    );
    await coordinator.requestState(workspace.id, "STOPPED");
    expect(calls).toEqual(["persist", "dispatch"]);
  });

  it("delivers workspace commands through the idempotent reconciler", async () => {
    let reconciled = "";
    const handler = new WorkspaceOutboxHandler({
      reconcile: async (id) => {
        reconciled = id;
        return workspace;
      },
    });
    await handler.handle({ aggregateId: workspace.id } as OutboxCommand);
    expect(reconciled).toBe(workspace.id);
  });
});
