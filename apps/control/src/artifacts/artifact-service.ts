import { randomUUID } from "node:crypto";

import type {
  GitArtifact,
  GitArtifactRepository,
} from "@rad/git-artifacts";
import { RadError, type Repository, type Workspace } from "@rad/shared";
import type { WorkspaceRepository } from "@rad/workspace-state";

import { ArtifactStore } from "./artifact-store.js";

export interface GitBundleExporter {
  exportGitBundle(
    workspace: Workspace,
    repository: Repository,
    destinationPath: string,
  ): Promise<void>;
}

export class ArtifactService {
  public constructor(
    private readonly artifacts: GitArtifactRepository,
    private readonly workspaces: Pick<
      WorkspaceRepository,
      "getWorkspace" | "getRepository"
    >,
    private readonly exporter: GitBundleExporter,
    private readonly store: ArtifactStore,
  ) {}

  public async capture(workspaceId: string): Promise<GitArtifact> {
    const workspace = await this.workspaces.getWorkspace(workspaceId);
    if (!workspace) {
      throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${workspaceId} not found`);
    }
    if (workspace.desiredState !== "RUNNING" || workspace.observedState !== "READY") {
      throw new RadError("WORKSPACE_NOT_READY", `Workspace ${workspaceId} is not ready`);
    }
    const repository = await this.workspaces.getRepository(workspace.repositoryId);
    if (!repository) {
      throw new RadError(
        "REPOSITORY_NOT_FOUND",
        `Repository ${workspace.repositoryId} not found`,
      );
    }

    const id = randomUUID();
    const stagingPath = this.store.stagingPath(id);
    try {
      await this.exporter.exportGitBundle(workspace, repository, stagingPath);
      const stored = await this.store.commit(stagingPath);
      return await this.artifacts.create({
        id,
        workspaceId: workspace.id,
        repositoryId: repository.id,
        ...stored,
      });
    } finally {
      await this.store.discardStaging(stagingPath);
    }
  }

  public get(id: string): Promise<GitArtifact | undefined> {
    return this.artifacts.get(id);
  }
}
