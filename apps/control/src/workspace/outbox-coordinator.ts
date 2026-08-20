import type { DesiredWorkspaceState, Workspace } from "@rad/shared";
import type {
  OutboxCommand,
  OutboxCommandHandler,
  OutboxDispatcher,
  OutboxRepository,
} from "@rad/outbox";
import type { WorkspaceReconciler, WorkspaceRepository } from "@rad/workspace-state";

export class WorkspaceOutboxHandler implements OutboxCommandHandler {
  public constructor(
    private readonly reconciler: Pick<WorkspaceReconciler, "reconcile">,
  ) {}

  public async handle(command: OutboxCommand): Promise<void> {
    await this.reconciler.reconcile(command.aggregateId);
  }
}

export class OutboxWorkspaceCoordinator {
  public constructor(
    private readonly commands: Pick<OutboxRepository, "requestWorkspaceState">,
    private readonly dispatcher: Pick<OutboxDispatcher, "dispatchAvailable">,
    private readonly workspaces: Pick<WorkspaceRepository, "getWorkspace">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async requestState(
    workspaceId: string,
    desiredState: DesiredWorkspaceState,
  ): Promise<Workspace> {
    const requested = await this.commands.requestWorkspaceState(
      workspaceId,
      desiredState,
      this.now(),
    );
    await this.dispatcher.dispatchAvailable();
    return (await this.workspaces.getWorkspace(workspaceId)) ?? requested.workspace;
  }
}
