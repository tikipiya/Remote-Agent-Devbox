import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  loadRuntimeConfig,
  type Repository,
  type Workspace,
} from "@rad/shared";

import type { CommandResult, CommandRunner } from "./command-runner.js";
import { DockerSandboxSupervisor } from "./docker-supervisor.js";

class RecordingRunner implements CommandRunner {
  public calls: Array<{ executable: string; args: readonly string[] }> = [];

  public async run(
    executable: string,
    args: readonly string[],
  ): Promise<CommandResult> {
    this.calls.push({ executable, args });
    return { stdout: "", stderr: "" };
  }
}

class HealthyWorkspaceRunner extends RecordingRunner {
  public override async run(
    executable: string,
    args: readonly string[],
  ): Promise<CommandResult> {
    this.calls.push({ executable, args });
    if (args[0] === "container" && args[1] === "inspect") {
      return {
        stdout: JSON.stringify({ Running: true, Health: { Status: "healthy" } }),
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  }
}

class AgentTaskRunner extends HealthyWorkspaceRunner {
  public agentEnvironment: NodeJS.ProcessEnv | undefined;

  public override async run(
    executable: string,
    args: readonly string[],
    options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> {
    if (args[0] === "container" && args[1] === "inspect") {
      return super.run(executable, args);
    }
    this.calls.push({ executable, args });
    this.agentEnvironment = options?.env;
    return {
      stdout: `${JSON.stringify({
        event: "task_completed",
        threadId: "thread-1",
        turnId: "turn-1",
        message: "done",
      })}\n`,
      stderr: "",
    };
  }
}

class GitBundleRunner extends RecordingRunner {
  public override async run(
    executable: string,
    args: readonly string[],
  ): Promise<CommandResult> {
    this.calls.push({ executable, args });
    if (args[0] === "container" && args[1] === "inspect") {
      return {
        stdout: JSON.stringify({ Running: true, Health: { Status: "healthy" } }),
        stderr: "",
      };
    }
    if (args.includes("symbolic-ref")) {
      return { stdout: `${workspace.branchName}\n`, stderr: "" };
    }
    if (args.includes("--format=%s")) {
      return { stdout: "4096\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  }
}

const workspace: Workspace = {
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

const repository: Repository = {
  id: workspace.repositoryId,
  remoteUrl: "https://github.com/example/project.git",
  defaultBranch: "main",
  createdAt: new Date(),
};

describe("DockerSandboxSupervisor", () => {
  it("creates a resource-limited container without privileged mounts or credentials", () => {
    const runner = new RecordingRunner();
    const supervisor = new DockerSandboxSupervisor(
      loadRuntimeConfig({
        RAD_DATABASE_URL: "postgresql://rad:rad@db/rad",
        RAD_WORKSPACE_IMAGE: "rad/workspace:local",
      }),
      runner,
      async () => repository,
    );

    const args = supervisor.createArguments(workspace, repository);
    const serialized = args.join(" ");

    expect(args).toContain("--read-only");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("--cap-drop");
    expect(serialized).toContain("no-new-privileges=true");
    expect(args).not.toContain("--publish");
    expect(serialized).not.toMatch(/docker\.sock/i);
    expect(serialized).not.toMatch(/github.*token/i);
    expect(serialized).not.toContain("rad-control");
    expect(serialized).toContain(`type=volume,source=rad-data-${workspace.id}`);
  });

  it("rejects a non-UUID workspace identifier before invoking Docker", async () => {
    const runner = new RecordingRunner();
    const supervisor = new DockerSandboxSupervisor(
      loadRuntimeConfig({
        RAD_DATABASE_URL: "postgresql://rad:rad@db/rad",
        RAD_WORKSPACE_IMAGE: "rad/workspace:local",
      }),
      runner,
      async () => repository,
    );

    await expect(
      supervisor.inspect({ ...workspace, id: "$(unsafe)" }),
    ).rejects.toThrow(/UUID/);
    expect(runner.calls).toEqual([]);
  });

  it("runs Codex in a separate hardened container without putting the key in arguments", () => {
    const supervisor = new DockerSandboxSupervisor(
      loadRuntimeConfig({
        RAD_DATABASE_URL: "postgresql://rad:rad@db/rad",
        RAD_WORKSPACE_IMAGE: "rad/workspace:local",
        RAD_CODEX_API_KEY: "super-secret",
      }),
      new RecordingRunner(),
      async () => repository,
    );

    const args = supervisor.createAgentRunnerArguments(workspace, "payload");
    const serialized = args.join(" ");

    expect(serialized).toContain(`--network container:rad-ws-${workspace.id}`);
    expect(args).toContain("--rm");
    expect(args).toContain("--read-only");
    expect(args).toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain(`source=rad-data-${workspace.id}`);
    expect(serialized).not.toMatch(/docker\.sock/i);
  });

  it("fails closed before starting an agent runner when identity is absent", async () => {
    const runner = new HealthyWorkspaceRunner();
    const supervisor = new DockerSandboxSupervisor(
      loadRuntimeConfig({
        RAD_DATABASE_URL: "postgresql://rad:rad@db/rad",
        RAD_WORKSPACE_IMAGE: "rad/workspace:local",
      }),
      runner,
      async () => repository,
    );

    await expect(supervisor.runTask(workspace, "test task")).rejects.toThrow(
      /RAD_CODEX_API_KEY/,
    );
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args.slice(0, 2)).toEqual(["container", "inspect"]);
  });

  it("passes identity only through the Agent Runner environment", async () => {
    const runner = new AgentTaskRunner();
    const supervisor = new DockerSandboxSupervisor(
      loadRuntimeConfig({
        RAD_DATABASE_URL: "postgresql://rad:rad@db/rad",
        RAD_WORKSPACE_IMAGE: "rad/workspace:local",
        RAD_CODEX_API_KEY: "super-secret",
      }),
      runner,
      async () => repository,
    );

    await expect(supervisor.runTask(workspace, "test task")).resolves.toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
      message: "done",
    });
    const agentCall = runner.calls[1];
    expect(agentCall?.args.slice(0, 2)).toEqual(["container", "run"]);
    expect(agentCall?.args.join(" ")).not.toContain("super-secret");
    expect(runner.agentEnvironment?.OPENAI_API_KEY).toBe("super-secret");

    const encodedPayload = agentCall?.args.at(-1);
    expect(encodedPayload).toBeDefined();
    const payload = JSON.parse(
      Buffer.from(encodedPayload ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      task: "test task",
      cwd: "/workspace/repository",
      environmentId: workspace.id,
      execServerUrl: "ws://127.0.0.1:4500",
    });
  });

  it("exports a committed Git bundle without trusting Workspace metadata", async () => {
    const runner = new GitBundleRunner();
    const supervisor = new DockerSandboxSupervisor(
      loadRuntimeConfig({
        RAD_DATABASE_URL: "postgresql://rad:rad@db/rad",
        RAD_WORKSPACE_IMAGE: "rad/workspace:local",
      }),
      runner,
      async () => repository,
    );

    await supervisor.exportGitBundle(workspace, repository, "/trusted/staging.bundle");

    expect(runner.calls.some((call) => call.args.includes("symbolic-ref"))).toBe(true);
    expect(runner.calls.some((call) => call.args.includes("--porcelain=v1"))).toBe(true);
    const bundleCall = runner.calls.find((call) => call.args.includes("bundle"));
    expect(bundleCall?.args).toContain("HEAD");
    expect(bundleCall?.args).toContain("refs/remotes/origin/main");
    const copyCall = runner.calls.find(
      (call) => call.args[0] === "container" && call.args[1] === "cp",
    );
    expect(copyCall?.args.at(-1)).toBe("/trusted/staging.bundle");
    expect(runner.calls.at(-1)?.args).toContain("/bin/rm");
  });
});
