import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../workspace/command-runner.js";
import { GitRemoteHeadObserver } from "./remote-head-observer.js";

describe("GitRemoteHeadObserver", () => {
  it("observes one exact branch without credentials or shell interpolation", async () => {
    const calls: Array<{ executable: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const runner: CommandRunner = {
      async run(executable, args, options) {
        calls.push({ executable, args, env: options?.env });
        return {
          stdout: `${"a".repeat(40)}\trefs/heads/agent/test\n`,
          stderr: "",
        };
      },
    };
    const head = await new GitRemoteHeadObserver(runner).observe(
      "https://github.com/example/repo.git",
      "agent/test",
    );
    expect(head).toBe("a".repeat(40));
    expect(calls[0]!.executable).toBe("/usr/bin/git");
    expect(calls[0]!.args).toEqual([
      "ls-remote",
      "--heads",
      "https://github.com/example/repo.git",
      "refs/heads/agent/test",
    ]);
    expect(calls[0]!.env).not.toHaveProperty("RAD_CODEX_API_KEY");
  });

  it("represents an absent branch as null and rejects unexpected refs", async () => {
    const empty: CommandRunner = { run: async () => ({ stdout: "", stderr: "" }) };
    await expect(new GitRemoteHeadObserver(empty).observe("https://example.test/repo", "agent/x"))
      .resolves.toBeNull();

    const wrong: CommandRunner = {
      run: async () => ({ stdout: `${"a".repeat(40)} refs/heads/main\n`, stderr: "" }),
    };
    await expect(
      new GitRemoteHeadObserver(wrong).observe("https://example.test/repo", "agent/x"),
    ).rejects.toThrow("malformed");
  });
});
