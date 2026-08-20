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
    expect(serialized).toContain("127.0.0.1::3000");
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
});
