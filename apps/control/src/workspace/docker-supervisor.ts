import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  RadError,
  type Repository,
  type RuntimeConfig,
  type Workspace,
} from "@rad/shared";
import type {
  ActualSandboxState,
  SandboxSupervisor,
} from "@rad/workspace-state";

import type { CommandRunner } from "./command-runner.js";

type RepositoryResolver = (id: string) => Promise<Repository | undefined>;

export class DockerSandboxSupervisor implements SandboxSupervisor {
  public constructor(
    private readonly config: RuntimeConfig,
    private readonly commandRunner: CommandRunner,
    private readonly resolveRepository: RepositoryResolver,
  ) {}

  public async inspect(workspace: Workspace): Promise<ActualSandboxState> {
    try {
      const result = await this.docker([
        "container",
        "inspect",
        "--format",
        "{{json .State}}",
        containerName(workspace.id),
      ]);
      const state = JSON.parse(result.stdout) as { Running?: boolean };
      return state.Running === true ? "RUNNING" : "STOPPED";
    } catch (error) {
      if (isMissingContainer(error)) return "ABSENT";
      throw error;
    }
  }

  public async ensureCreated(workspace: Workspace): Promise<void> {
    if ((await this.inspect(workspace)) !== "ABSENT") return;

    const repository = await this.resolveRepository(workspace.repositoryId);
    if (!repository) {
      throw new RadError(
        "REPOSITORY_NOT_FOUND",
        `Repository ${workspace.repositoryId} not found`,
      );
    }

    const workspacePath = join(this.config.RAD_WORKSPACE_ROOT, workspace.id);
    await mkdir(workspacePath, { recursive: true, mode: 0o700 });
    await this.docker(this.createArguments(workspace, repository, workspacePath));
  }

  public async ensureRunning(workspace: Workspace): Promise<void> {
    const actual = await this.inspect(workspace);
    if (actual === "RUNNING") return;
    if (actual === "ABSENT") await this.ensureCreated(workspace);
    await this.docker(["container", "start", containerName(workspace.id)]);
  }

  public async ensureStopped(workspace: Workspace): Promise<void> {
    const actual = await this.inspect(workspace);
    if (actual !== "RUNNING") return;
    await this.docker([
      "container",
      "stop",
      "--time",
      "10",
      containerName(workspace.id),
    ]);
  }

  public async ensureDestroyed(workspace: Workspace): Promise<void> {
    if ((await this.inspect(workspace)) === "ABSENT") return;
    await this.docker(["container", "rm", "--force", containerName(workspace.id)]);
  }

  public async getIdeUrl(workspace: Workspace): Promise<string | undefined> {
    if ((await this.inspect(workspace)) !== "RUNNING") return undefined;
    const result = await this.docker([
      "container",
      "port",
      containerName(workspace.id),
      "3000/tcp",
    ]);
    const match = /127\.0\.0\.1:(\d+)/.exec(result.stdout);
    return match?.[1] ? `http://127.0.0.1:${match[1]}` : undefined;
  }

  public createArguments(
    workspace: Workspace,
    repository: Repository,
    workspacePath: string,
  ): string[] {
    return [
      "container",
      "create",
      "--name",
      containerName(workspace.id),
      "--hostname",
      "rad-workspace",
      "--label",
      `dev.rad.workspace-id=${workspace.id}`,
      "--network",
      this.config.RAD_WORKSPACE_NETWORK,
      "--memory",
      `${this.config.RAD_WORKSPACE_MEMORY_MB}m`,
      "--cpus",
      String(this.config.RAD_WORKSPACE_CPUS),
      "--pids-limit",
      String(this.config.RAD_WORKSPACE_PIDS),
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges=true",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=256m",
      "--tmpfs",
      "/home/codex/.local:rw,nosuid,nodev,size=512m,uid=10001,gid=10001",
      "--tmpfs",
      "/home/codex/.config:rw,nosuid,nodev,size=64m,uid=10001,gid=10001",
      "--tmpfs",
      "/home/codex/.codex:rw,nosuid,nodev,size=64m,uid=10001,gid=10001",
      "--mount",
      `type=bind,source=${workspacePath},target=/workspace`,
      "--publish",
      "127.0.0.1::3000",
      "--env",
      `RAD_REPOSITORY_URL=${repository.remoteUrl}`,
      "--env",
      `RAD_REPOSITORY_BRANCH=${repository.defaultBranch}`,
      "--env",
      `RAD_AGENT_BRANCH=${workspace.branchName}`,
      "--env",
      `RAD_WORKSPACE_ID=${workspace.id}`,
      this.config.RAD_WORKSPACE_IMAGE,
    ];
  }

  private docker(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
    return this.commandRunner.run("docker", args);
  }
}

function containerName(workspaceId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      workspaceId,
    )
  ) {
    throw new RadError("INVALID_WORKSPACE_ID", "Workspace ID is not a UUID");
  }
  return `rad-ws-${workspaceId}`;
}

function isMissingContainer(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const stderr = "stderr" in error ? String(error.stderr) : "";
  return /No such (object|container)/i.test(`${error.message}\n${stderr}`);
}
