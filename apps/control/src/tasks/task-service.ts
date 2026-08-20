import { randomUUID } from "node:crypto";

import { RadError, type Workspace } from "@rad/shared";
import type { AgentTask, AgentTaskRepository } from "@rad/agents";
import type { WorkspaceRepository } from "@rad/workspace-state";

import type { DockerSandboxSupervisor } from "../workspace/docker-supervisor.js";

export class TaskService {
  public constructor(
    private readonly tasks: AgentTaskRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly supervisor: Pick<DockerSandboxSupervisor, "runTask">,
  ) {}

  public async run(
    workspaceId: string,
    prompt: string,
    requestedBy: string,
  ): Promise<AgentTask> {
    let workspace = await this.requireReadyWorkspace(workspaceId);
    let task = await this.tasks.create({
      id: randomUUID(),
      workspaceId,
      prompt,
      requestedBy,
    });
    workspace = await this.workspaces.setObservedState(
      workspace.id,
      "BUSY",
      workspace.stateVersion,
    );
    task = await this.tasks.markRunning(task.id);

    try {
      const result = await this.supervisor.runTask(workspace, prompt);
      task = await this.tasks.markCompleted(task.id, result.message);
      return task;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown agent error";
      await this.tasks.markFailed(task.id, message.slice(0, 2_000));
      throw new RadError("AGENT_TASK_FAILED", message, error);
    } finally {
      const current = await this.workspaces.getWorkspace(workspace.id);
      if (current?.desiredState === "RUNNING") {
        await this.workspaces.setObservedState(
          current.id,
          "READY",
          current.stateVersion,
        );
      }
    }
  }

  public get(id: string): Promise<AgentTask | undefined> {
    return this.tasks.get(id);
  }

  private async requireReadyWorkspace(id: string): Promise<Workspace> {
    const workspace = await this.workspaces.getWorkspace(id);
    if (!workspace) throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${id} not found`);
    if (workspace.observedState !== "READY" || workspace.desiredState !== "RUNNING") {
      throw new RadError("WORKSPACE_NOT_READY", `Workspace ${id} is not ready`);
    }
    return workspace;
  }
}

