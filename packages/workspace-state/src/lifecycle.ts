import {
  RadError,
  type DesiredWorkspaceState,
  type ObservedWorkspaceState,
  type Workspace,
} from "@rad/shared";

import type { WorkspaceRepository } from "./repository.js";

export type ActualSandboxState = "ABSENT" | "STOPPED" | "STARTING" | "RUNNING";

export interface SandboxSupervisor {
  inspect(workspace: Workspace): Promise<ActualSandboxState>;
  ensureCreated(workspace: Workspace): Promise<void>;
  ensureRunning(workspace: Workspace): Promise<void>;
  ensureStopped(workspace: Workspace): Promise<void>;
  ensureDestroyed(workspace: Workspace): Promise<void>;
}

export class WorkspaceReconciler {
  public constructor(
    private readonly repository: WorkspaceRepository,
    private readonly supervisor: SandboxSupervisor,
  ) {}

  public async reconcileAll(): Promise<void> {
    const candidates = await this.repository.listForReconciliation();
    await Promise.allSettled(
      candidates.map(async (workspace) => this.reconcile(workspace.id)),
    );
  }

  public async reconcile(workspaceId: string): Promise<Workspace> {
    const workspace = await this.requireWorkspace(workspaceId);
    try {
      return await this.converge(workspace);
    } catch (error) {
      const current = await this.requireWorkspace(workspaceId);
      const message = error instanceof Error ? error.message : "Unknown sandbox error";
      await this.repository.setObservedState(
        current.id,
        "FAILED",
        current.stateVersion,
        message.slice(0, 2_000),
      );
      throw new RadError("WORKSPACE_RECONCILE_FAILED", message, error);
    }
  }

  private async converge(workspace: Workspace): Promise<Workspace> {
    const actual = await this.supervisor.inspect(workspace);
    switch (workspace.desiredState) {
      case "RUNNING":
        return this.ensureRunning(workspace, actual);
      case "SUSPENDED":
        return this.ensureStopped(workspace, "SUSPENDED", "SUSPENDING");
      case "STOPPED":
        return this.ensureStopped(workspace, "STOPPED", "STOPPING");
      case "DESTROYED":
        return this.ensureDestroyed(workspace, actual);
    }
  }

  private async ensureRunning(
    initial: Workspace,
    actual: ActualSandboxState,
  ): Promise<Workspace> {
    let workspace = initial;
    if (actual === "RUNNING") {
      return this.observe(workspace, "READY");
    }
    if (actual === "ABSENT") {
      workspace = await this.observe(workspace, "PROVISIONING");
      await this.supervisor.ensureCreated(workspace);
    }
    workspace = await this.observe(workspace, "STARTING");
    await this.supervisor.ensureRunning(workspace);
    return this.observe(workspace, "READY");
  }

  private async ensureStopped(
    workspace: Workspace,
    target: "SUSPENDED" | "STOPPED",
    transition: "SUSPENDING" | "STOPPING",
  ): Promise<Workspace> {
    const transitioning = await this.observe(workspace, transition);
    await this.supervisor.ensureStopped(transitioning);
    return this.observe(transitioning, target);
  }

  private async ensureDestroyed(
    workspace: Workspace,
    actual: ActualSandboxState,
  ): Promise<Workspace> {
    if (actual === "ABSENT") {
      return this.observe(workspace, "DESTROYED");
    }
    const destroying = await this.observe(workspace, "DESTROYING");
    await this.supervisor.ensureDestroyed(destroying);
    return this.observe(destroying, "DESTROYED");
  }

  private observe(
    workspace: Workspace,
    observedState: ObservedWorkspaceState,
  ): Promise<Workspace> {
    return this.repository.setObservedState(
      workspace.id,
      observedState,
      workspace.stateVersion,
    );
  }

  private async requireWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.repository.getWorkspace(workspaceId);
    if (!workspace) {
      throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${workspaceId} not found`);
    }
    return workspace;
  }
}

export class WorkspaceCoordinator {
  public constructor(
    private readonly repository: WorkspaceRepository,
    private readonly reconciler: WorkspaceReconciler,
  ) {}

  public async requestState(
    workspaceId: string,
    desiredState: DesiredWorkspaceState,
  ): Promise<Workspace> {
    const workspace = await this.repository.getWorkspace(workspaceId);
    if (!workspace) {
      throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${workspaceId} not found`);
    }
    await this.repository.setDesiredState(
      workspace.id,
      desiredState,
      workspace.stateVersion,
    );
    return this.reconciler.reconcile(workspace.id);
  }
}
