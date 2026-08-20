import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

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

export interface AgentExecutionResult {
  threadId: string;
  turnId: string;
  message: string;
}

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
      const state = JSON.parse(result.stdout) as {
        Running?: boolean;
        Health?: { Status?: string };
      };
      if (state.Running !== true) return "STOPPED";
      if (state.Health?.Status === "unhealthy") {
        throw new RadError(
          "WORKSPACE_UNHEALTHY",
          `Workspace ${workspace.id} failed its health check`,
        );
      }
      return state.Health?.Status === "starting" ? "STARTING" : "RUNNING";
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

    await this.ensureWorkspaceNetwork();
    await this.docker(["volume", "create", volumeName(workspace.id)]);
    await this.docker(this.createArguments(workspace, repository));
  }

  public async ensureRunning(workspace: Workspace): Promise<void> {
    const actual = await this.inspect(workspace);
    if (actual === "RUNNING") return;
    if (actual === "ABSENT") await this.ensureCreated(workspace);
    if (actual !== "STARTING") {
      await this.docker(["container", "start", containerName(workspace.id)]);
    }
    await this.waitUntilHealthy(workspace);
  }

  public async ensureStopped(workspace: Workspace): Promise<void> {
    const actual = await this.inspect(workspace);
    if (actual === "ABSENT" || actual === "STOPPED") return;
    await this.docker([
      "container",
      "stop",
      "--time",
      "10",
      containerName(workspace.id),
    ]);
  }

  public async ensureDestroyed(workspace: Workspace): Promise<void> {
    if ((await this.inspect(workspace)) !== "ABSENT") {
      await this.docker(["container", "rm", "--force", containerName(workspace.id)]);
    }
    try {
      await this.docker(["volume", "rm", volumeName(workspace.id)]);
    } catch (error) {
      if (!isMissingVolume(error)) throw error;
    }
  }

  public async runTask(workspace: Workspace, task: string): Promise<AgentExecutionResult> {
    if ((await this.inspect(workspace)) !== "RUNNING") {
      throw new RadError("WORKSPACE_NOT_READY", `Workspace ${workspace.id} is not running`);
    }
    if (!this.config.RAD_CODEX_API_KEY) {
      throw new RadError(
        "CODEX_IDENTITY_NOT_CONFIGURED",
        "RAD_CODEX_API_KEY is required to run an agent task",
      );
    }
    const payload = Buffer.from(
      JSON.stringify({
        task,
        cwd: "/workspace/repository",
        environmentId: workspace.id,
        execServerUrl: "ws://127.0.0.1:4500",
      }),
      "utf8",
    ).toString("base64url");
    const result = await this.commandRunner.run(
      "docker",
      this.createAgentRunnerArguments(workspace, payload),
      {
        timeoutMs: 60 * 60 * 1000,
        env: agentRunnerEnvironment(this.config.RAD_CODEX_API_KEY),
      },
    );
    const events = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const completed = events.find((event) => event.event === "task_completed");
    if (
      !completed ||
      typeof completed.threadId !== "string" ||
      typeof completed.turnId !== "string" ||
      typeof completed.message !== "string"
    ) {
      throw new RadError("AGENT_TASK_FAILED", "Agent worker did not return completion");
    }
    return {
      threadId: completed.threadId,
      turnId: completed.turnId,
      message: completed.message,
    };
  }

  public async exportGitBundle(
    workspace: Workspace,
    repository: Repository,
    destinationPath: string,
  ): Promise<void> {
    if ((await this.inspect(workspace)) !== "RUNNING") {
      throw new RadError("WORKSPACE_NOT_READY", `Workspace ${workspace.id} is not running`);
    }
    const workspacePath = `/tmp/rad-artifact-${randomUUID()}.bundle`;
    const git = [
      "container",
      "exec",
      "--user",
      "10001:10001",
      "--workdir",
      "/workspace/repository",
      containerName(workspace.id),
      "git",
      "-c",
      "core.hooksPath=/dev/null",
    ];

    try {
      const branch = await this.docker([...git, "symbolic-ref", "--short", "HEAD"]);
      if (branch.stdout.trim() !== workspace.branchName) {
        throw new RadError(
          "ARTIFACT_BRANCH_MISMATCH",
          `Workspace branch is not ${workspace.branchName}`,
        );
      }
      const status = await this.docker([
        ...git,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]);
      if (status.stdout.trim() !== "") {
        throw new RadError(
          "ARTIFACT_WORKTREE_DIRTY",
          "Commit or discard Workspace changes before creating an artifact",
        );
      }

      await this.docker(
        [
          ...git,
          "bundle",
          "create",
          workspacePath,
          "HEAD",
          `refs/remotes/origin/${repository.defaultBranch}`,
        ],
        { timeoutMs: 120_000 },
      );
      const sizeResult = await this.docker([
        "container",
        "exec",
        "--user",
        "10001:10001",
        containerName(workspace.id),
        "/usr/bin/stat",
        "--format=%s",
        workspacePath,
      ]);
      const size = Number(sizeResult.stdout.trim());
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > this.config.RAD_ARTIFACT_MAX_BYTES
      ) {
        throw new RadError(
          "ARTIFACT_SIZE_INVALID",
          `Workspace artifact size ${sizeResult.stdout.trim()} is outside the configured limit`,
        );
      }
      await this.docker(
        [
          "container",
          "cp",
          `${containerName(workspace.id)}:${workspacePath}`,
          destinationPath,
        ],
        { timeoutMs: 120_000 },
      );
    } finally {
      try {
        await this.docker([
          "container",
          "exec",
          "--user",
          "10001:10001",
          containerName(workspace.id),
          "/bin/rm",
          "--force",
          "--",
          workspacePath,
        ]);
      } catch {
        // The Workspace is untrusted and temporary. Stale tmpfs bytes carry no authority.
      }
    }
  }

  public createAgentRunnerArguments(
    workspace: Workspace,
    payload: string,
  ): string[] {
    return [
      "container",
      "run",
      "--rm",
      "--label",
      `dev.rad.agent-workspace-id=${workspace.id}`,
      "--network",
      `container:${containerName(workspace.id)}`,
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
      "/home/codex/.codex:rw,nosuid,nodev,size=64m,uid=10001,gid=10001",
      "--env",
      "OPENAI_API_KEY",
      "--entrypoint",
      "node",
      this.config.RAD_WORKSPACE_IMAGE,
      "/opt/rad/agent-worker/dist/main.js",
      payload,
    ];
  }

  public createArguments(
    workspace: Workspace,
    repository: Repository,
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
      "/home/codex/.cache:rw,nosuid,nodev,size=256m,uid=10001,gid=10001",
      "--tmpfs",
      "/home/codex/.codex:rw,nosuid,nodev,size=64m,uid=10001,gid=10001",
      "--mount",
      `type=volume,source=${volumeName(workspace.id)},target=/workspace`,
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

  private docker(
    args: readonly string[],
    options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string; stderr: string }> {
    return this.commandRunner.run("docker", args, options);
  }

  private async waitUntilHealthy(workspace: Workspace): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const actual = await this.inspect(workspace);
      if (actual === "RUNNING") return;
      if (actual === "STOPPED" || actual === "ABSENT") {
        throw new RadError(
          "WORKSPACE_START_FAILED",
          `Workspace ${workspace.id} stopped during startup`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new RadError(
      "WORKSPACE_START_TIMEOUT",
      `Workspace ${workspace.id} did not become healthy`,
    );
  }

  private async ensureWorkspaceNetwork(): Promise<void> {
    try {
      await this.docker(["network", "inspect", this.config.RAD_WORKSPACE_NETWORK]);
    } catch (error) {
      if (!isMissingNetwork(error)) throw error;
      try {
        await this.docker([
          "network",
          "create",
          "--driver",
          "bridge",
          "--label",
          "dev.rad.network=workspace",
          this.config.RAD_WORKSPACE_NETWORK,
        ]);
      } catch (createError) {
        if (!/already exists/i.test(String(createError))) throw createError;
      }
    }
  }
}

function agentRunnerEnvironment(apiKey: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: apiKey };
  for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "DOCKER_HOST"] as const) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
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

function volumeName(workspaceId: string): string {
  containerName(workspaceId);
  return `rad-data-${workspaceId}`;
}

function isMissingContainer(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const stderr = "stderr" in error ? String(error.stderr) : "";
  return /No such (object|container)/i.test(`${error.message}\n${stderr}`);
}

function isMissingVolume(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const stderr = "stderr" in error ? String(error.stderr) : "";
  return /no such volume/i.test(`${error.message}\n${stderr}`);
}

function isMissingNetwork(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const stderr = "stderr" in error ? String(error.stderr) : "";
  return /network .* not found|no such network/i.test(`${error.message}\n${stderr}`);
}
