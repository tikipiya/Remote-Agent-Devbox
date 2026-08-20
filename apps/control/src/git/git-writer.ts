import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EphemeralCredential } from "@rad/github-token-issuer";
import { RadError } from "@rad/shared";

import {
  CommandExecutionError,
  type CommandRunner,
} from "../workspace/command-runner.js";

const objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface PreparedGitPush {
  push(input: {
    remoteUrl: string;
    branchName: string;
    expectedRemoteHead: string | null;
    credential: EphemeralCredential;
  }): Promise<void>;
  dispose(): Promise<void>;
}

export interface GitPushPreparer {
  prepare(bundlePath: string, targetCommit: string): Promise<PreparedGitPush>;
}

export class TrustedGitWriter implements GitPushPreparer {
  public constructor(private readonly runner: CommandRunner) {}

  public async prepare(bundlePath: string, targetCommit: string): Promise<PreparedGitPush> {
    if (!objectIdPattern.test(targetCommit)) {
      throw new RadError("GIT_TARGET_INVALID", "Target commit object ID is invalid");
    }
    const root = await mkdtemp(join(tmpdir(), "rad-git-write-"));
    const repositoryPath = join(root, "repository.git");
    try {
      await this.localGit(["init", "--bare", repositoryPath]);
      await this.localGit(["-C", repositoryPath, "bundle", "verify", bundlePath]);
      await this.localGit([
        "-C",
        repositoryPath,
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        bundlePath,
        "HEAD:refs/rad/target",
      ]);
      const observedTarget = (
        await this.localGit(["-C", repositoryPath, "rev-parse", "--verify", "refs/rad/target"])
      ).stdout.trim();
      if (observedTarget !== targetCommit) {
        throw new RadError(
          "GIT_WRITER_TARGET_MISMATCH",
          "Bundle target does not match the approved Git operation",
        );
      }
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }

    return {
      push: async (input) => {
        const remoteRef = `refs/heads/${input.branchName}`;
        const expected = input.expectedRemoteHead ?? "";
        const authorization = Buffer.from(
          `x-access-token:${input.credential.token}`,
          "utf8",
        ).toString("base64");
        try {
          await this.runner.run(
            "/usr/bin/git",
            [
              "-C",
              repositoryPath,
              "-c",
              "core.hooksPath=/dev/null",
              "push",
              "--porcelain",
              `--force-with-lease=${remoteRef}:${expected}`,
              input.remoteUrl,
              `refs/rad/target:${remoteRef}`,
            ],
            {
              timeoutMs: 120_000,
              maxBufferBytes: 1024 * 1024,
              env: gitEnvironment({
                GIT_CONFIG_COUNT: "2",
                GIT_CONFIG_KEY_0: "http.extraHeader",
                GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
                GIT_CONFIG_KEY_1: "credential.helper",
                GIT_CONFIG_VALUE_1: "",
              }),
            },
          );
        } catch (error) {
          if (
            error instanceof CommandExecutionError &&
            /\[rejected\].*\(stale info\)/s.test(`${error.stdout}\n${error.stderr}`)
          ) {
            throw new RadError(
              "REMOTE_CAS_CONFLICT",
              "Remote branch changed after the expected head was recorded",
            );
          }
          throw new RadError(
            "GIT_PUSH_RESULT_UNCERTAIN",
            "Git push did not return a definitive success result",
          );
        }
      },
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  }

  private localGit(args: readonly string[]) {
    return this.runner.run("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...args], {
      timeoutMs: 60_000,
      maxBufferBytes: 16 * 1024 * 1024,
      env: gitEnvironment(),
    });
  }
}

function gitEnvironment(additional: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin",
    HOME: "/tmp/rad-no-home",
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    ...additional,
  };
}
