import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  AgentTask,
  AgentTaskRepository,
  NewAgentTask,
} from "@rad/agents";
import type {
  DesiredWorkspaceState,
  ObservedWorkspaceState,
  Repository,
  Workspace,
} from "@rad/shared";
import type {
  NewRepository,
  NewWorkspace,
  WorkspaceRepository,
} from "@rad/workspace-state";

import { TaskService } from "./task-service.js";

class MemoryTasks implements AgentTaskRepository {
  public task?: AgentTask;

  public async create(input: NewAgentTask): Promise<AgentTask> {
    this.task = {
      ...input,
      status: "PENDING",
      result: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    return this.task;
  }

  public async get(): Promise<AgentTask | undefined> {
    return this.task;
  }

  public async markRunning(): Promise<AgentTask> {
    return this.update({ status: "RUNNING", startedAt: new Date() });
  }

  public async markCompleted(_id: string, result: string): Promise<AgentTask> {
    return this.update({ status: "COMPLETED", result, completedAt: new Date() });
  }

  public async markFailed(_id: string, error: string): Promise<AgentTask> {
    return this.update({ status: "FAILED", error, completedAt: new Date() });
  }

  private update(values: Partial<AgentTask>): AgentTask {
    if (!this.task) throw new Error("task missing");
    this.task = { ...this.task, ...values };
    return this.task;
  }
}

class MemoryWorkspaces implements WorkspaceRepository {
  public workspace = makeWorkspace();

  public async createRepository(_input: NewRepository): Promise<Repository> {
    throw new Error("not used");
  }
  public async getRepository(): Promise<Repository | undefined> {
    return undefined;
  }
  public async findRepositoryByRemoteUrl(): Promise<Repository | undefined> {
    return undefined;
  }
  public async createWorkspace(_input: NewWorkspace): Promise<Workspace> {
    throw new Error("not used");
  }
  public async getWorkspace(id: string): Promise<Workspace | undefined> {
    return id === this.workspace.id ? this.workspace : undefined;
  }
  public async listForReconciliation(): Promise<Workspace[]> {
    return [this.workspace];
  }
  public async setDesiredState(
    _id: string,
    desiredState: DesiredWorkspaceState,
    expectedVersion: number,
  ): Promise<Workspace> {
    return this.update({ desiredState }, expectedVersion);
  }
  public async setObservedState(
    _id: string,
    observedState: ObservedWorkspaceState,
    expectedVersion: number,
    lastError: string | null = null,
  ): Promise<Workspace> {
    return this.update({ observedState, lastError }, expectedVersion);
  }
  private update(values: Partial<Workspace>, expectedVersion: number): Workspace {
    if (this.workspace.stateVersion !== expectedVersion) throw new Error("conflict");
    this.workspace = { ...this.workspace, ...values, stateVersion: expectedVersion + 1 };
    return this.workspace;
  }
}

describe("TaskService", () => {
  it("marks the workspace BUSY and restores READY after success", async () => {
    const tasks = new MemoryTasks();
    const workspaces = new MemoryWorkspaces();
    const service = new TaskService(tasks, workspaces, {
      runTask: async () => ({ threadId: "thread", turnId: "turn", message: "done" }),
    });

    const task = await service.run(workspaces.workspace.id, "fix it", "test:user");

    expect(task.status).toBe("COMPLETED");
    expect(task.result).toBe("done");
    expect(workspaces.workspace.observedState).toBe("READY");
  });

  it("records a failed task and still restores the usable workspace", async () => {
    const tasks = new MemoryTasks();
    const workspaces = new MemoryWorkspaces();
    const service = new TaskService(tasks, workspaces, {
      runTask: async () => {
        throw new Error("agent unavailable");
      },
    });

    await expect(
      service.run(workspaces.workspace.id, "fix it", "test:user"),
    ).rejects.toThrow(/agent unavailable/);
    expect(tasks.task?.status).toBe("FAILED");
    expect(workspaces.workspace.observedState).toBe("READY");
  });
});

function makeWorkspace(): Workspace {
  const id = randomUUID();
  return {
    id,
    ownerUserId: randomUUID(),
    repositoryId: randomUUID(),
    desiredState: "RUNNING",
    observedState: "READY",
    stateVersion: 1,
    sandboxBackend: "docker",
    branchName: `agent/${id}`,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    lastError: null,
  };
}

