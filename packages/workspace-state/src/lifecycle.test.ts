import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  DesiredWorkspaceState,
  ObservedWorkspaceState,
  Repository,
  Workspace,
} from "@rad/shared";

import {
  type ActualSandboxState,
  type SandboxSupervisor,
  WorkspaceCoordinator,
  WorkspaceReconciler,
} from "./lifecycle.js";
import type {
  NewRepository,
  NewWorkspace,
  WorkspaceRepository,
} from "./repository.js";

class MemoryRepository implements WorkspaceRepository {
  public workspace = makeWorkspace();

  public async createRepository(input: NewRepository): Promise<Repository> {
    return { ...input, createdAt: new Date() };
  }

  public async getRepository(): Promise<Repository | undefined> {
    return undefined;
  }

  public async createWorkspace(input: NewWorkspace): Promise<Workspace> {
    this.workspace = {
      ...makeWorkspace(),
      ...input,
    };
    return this.workspace;
  }

  public async getWorkspace(id: string): Promise<Workspace | undefined> {
    return id === this.workspace.id ? this.workspace : undefined;
  }

  public async listForReconciliation(): Promise<Workspace[]> {
    return [this.workspace];
  }

  public async setDesiredState(
    id: string,
    desiredState: DesiredWorkspaceState,
    expectedVersion: number,
  ): Promise<Workspace> {
    this.checkVersion(id, expectedVersion);
    this.workspace = {
      ...this.workspace,
      desiredState,
      stateVersion: expectedVersion + 1,
    };
    return this.workspace;
  }

  public async setObservedState(
    id: string,
    observedState: ObservedWorkspaceState,
    expectedVersion: number,
    lastError: string | null = null,
  ): Promise<Workspace> {
    this.checkVersion(id, expectedVersion);
    this.workspace = {
      ...this.workspace,
      observedState,
      stateVersion: expectedVersion + 1,
      lastError,
    };
    return this.workspace;
  }

  private checkVersion(id: string, expectedVersion: number): void {
    if (id !== this.workspace.id || this.workspace.stateVersion !== expectedVersion) {
      throw new Error("state conflict");
    }
  }
}

class FakeSupervisor implements SandboxSupervisor {
  public actual: ActualSandboxState = "ABSENT";
  public calls: string[] = [];
  public failStart = false;

  public async inspect(): Promise<ActualSandboxState> {
    return this.actual;
  }

  public async ensureCreated(): Promise<void> {
    this.calls.push("create");
    this.actual = "STOPPED";
  }

  public async ensureRunning(): Promise<void> {
    this.calls.push("start");
    if (this.failStart) throw new Error("runtime unavailable");
    this.actual = "RUNNING";
  }

  public async ensureStopped(): Promise<void> {
    this.calls.push("stop");
    if (this.actual !== "ABSENT") this.actual = "STOPPED";
  }

  public async ensureDestroyed(): Promise<void> {
    this.calls.push("destroy");
    this.actual = "ABSENT";
  }
}

describe("WorkspaceReconciler", () => {
  it("converges a missing workspace to READY", async () => {
    const repository = new MemoryRepository();
    const supervisor = new FakeSupervisor();
    const reconciler = new WorkspaceReconciler(repository, supervisor);

    const workspace = await reconciler.reconcile(repository.workspace.id);

    expect(workspace.observedState).toBe("READY");
    expect(supervisor.calls).toEqual(["create", "start"]);
  });

  it("treats repeated destruction as success", async () => {
    const repository = new MemoryRepository();
    const supervisor = new FakeSupervisor();
    const reconciler = new WorkspaceReconciler(repository, supervisor);
    const coordinator = new WorkspaceCoordinator(repository, reconciler);

    await coordinator.requestState(repository.workspace.id, "DESTROYED");
    repository.workspace = {
      ...repository.workspace,
      observedState: "FAILED",
    };
    const workspace = await reconciler.reconcile(repository.workspace.id);

    expect(workspace.observedState).toBe("DESTROYED");
    expect(supervisor.calls).toEqual([]);
  });

  it("records FAILED without changing desired state", async () => {
    const repository = new MemoryRepository();
    const supervisor = new FakeSupervisor();
    supervisor.failStart = true;
    const reconciler = new WorkspaceReconciler(repository, supervisor);

    await expect(reconciler.reconcile(repository.workspace.id)).rejects.toThrow(
      /runtime unavailable/,
    );

    expect(repository.workspace.desiredState).toBe("RUNNING");
    expect(repository.workspace.observedState).toBe("FAILED");
  });

  it("stops a running workspace idempotently", async () => {
    const repository = new MemoryRepository();
    const supervisor = new FakeSupervisor();
    supervisor.actual = "RUNNING";
    repository.workspace = {
      ...repository.workspace,
      observedState: "READY",
    };
    const coordinator = new WorkspaceCoordinator(
      repository,
      new WorkspaceReconciler(repository, supervisor),
    );

    const workspace = await coordinator.requestState(
      repository.workspace.id,
      "STOPPED",
    );

    expect(workspace.observedState).toBe("STOPPED");
    expect(supervisor.calls).toEqual(["stop"]);
  });
});

function makeWorkspace(): Workspace {
  return {
    id: randomUUID(),
    ownerUserId: randomUUID(),
    repositoryId: randomUUID(),
    desiredState: "RUNNING",
    observedState: "MISSING",
    stateVersion: 0,
    sandboxBackend: "docker",
    branchName: `agent/${randomUUID()}`,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    lastError: null,
  };
}

