import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../workspace/command-runner.js";
import { CommandExecutionError } from "../workspace/command-runner.js";
import { TrustedGitWriter } from "./git-writer.js";

const target = "a".repeat(40);

describe("TrustedGitWriter", () => {
  it("imports before credentials and pushes one ref with an explicit CAS lease", async () => {
    const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const runner: CommandRunner = {
      async run(_executable, args, options) {
        calls.push({ args, env: options?.env });
        return args.includes("rev-parse")
          ? { stdout: `${target}\n`, stderr: "" }
          : { stdout: "ok", stderr: "" };
      },
    };
    const prepared = await new TrustedGitWriter(runner).prepare(
      "/var/lib/rad/artifacts/sha256/example/artifact.bundle",
      target,
    );
    try {
      await prepared.push({
        remoteUrl: "https://github.com/example/repo.git",
        branchName: "agent/test",
        expectedRemoteHead: "b".repeat(40),
        credential: { token: "secret-token", expiresAt: new Date(Date.now() + 60_000) },
      });
    } finally {
      await prepared.dispose();
    }

    const push = calls.find((call) => call.args.includes("push"))!;
    expect(push.args).toContain(
      `--force-with-lease=refs/heads/agent/test:${"b".repeat(40)}`,
    );
    expect(push.args).toContain("refs/rad/target:refs/heads/agent/test");
    expect(push.args.join(" ")).not.toContain("secret-token");
    expect(push.env?.GIT_CONFIG_VALUE_0).toMatch(/^AUTHORIZATION: basic /);
    for (const preCredentialCall of calls.slice(0, -1)) {
      expect(preCredentialCall.env).not.toHaveProperty("GIT_CONFIG_VALUE_0");
    }
  });

  it("requires a nonexistent remote ref when the observed head was absent", async () => {
    const calls: readonly string[][] = [];
    const mutableCalls = calls as string[][];
    const runner: CommandRunner = {
      async run(_executable, args) {
        mutableCalls.push([...args]);
        return args.includes("rev-parse")
          ? { stdout: `${target}\n`, stderr: "" }
          : { stdout: "", stderr: "" };
      },
    };
    const prepared = await new TrustedGitWriter(runner).prepare("/artifact.bundle", target);
    try {
      await prepared.push({
        remoteUrl: "https://github.com/example/repo.git",
        branchName: "agent/new",
        expectedRemoteHead: null,
        credential: { token: "token", expiresAt: new Date(Date.now() + 60_000) },
      });
    } finally {
      await prepared.dispose();
    }
    expect(mutableCalls.at(-1)).toContain("--force-with-lease=refs/heads/agent/new:");
  });

  it("distinguishes a definitive stale-info rejection from an ambiguous push", async () => {
    let rejectPush = true;
    const runner: CommandRunner = {
      async run(_executable, args) {
        if (args.includes("rev-parse")) return { stdout: `${target}\n`, stderr: "" };
        if (args.includes("push") && rejectPush) {
          throw new CommandExecutionError("failed", "", "! [rejected] agent/x -> agent/x (stale info)");
        }
        return { stdout: "", stderr: "" };
      },
    };
    const prepared = await new TrustedGitWriter(runner).prepare("/artifact.bundle", target);
    const input = {
      remoteUrl: "https://github.com/example/repo.git",
      branchName: "agent/x",
      expectedRemoteHead: "b".repeat(40),
      credential: { token: "token", expiresAt: new Date(Date.now() + 60_000) },
    };
    try {
      await expect(prepared.push(input)).rejects.toThrow("Remote branch changed");
      rejectPush = false;
    } finally {
      await prepared.dispose();
    }
  });
});
