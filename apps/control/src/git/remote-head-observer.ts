import { RadError } from "@rad/shared";

import type { CommandRunner } from "../workspace/command-runner.js";

const objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface RemoteHeadObserver {
  observe(remoteUrl: string, branchName: string): Promise<string | null>;
}

export class GitRemoteHeadObserver implements RemoteHeadObserver {
  public constructor(private readonly runner: CommandRunner) {}

  public async observe(remoteUrl: string, branchName: string): Promise<string | null> {
    const ref = `refs/heads/${branchName}`;
    const result = await this.runner.run(
      "/usr/bin/git",
      ["ls-remote", "--heads", remoteUrl, ref],
      {
        timeoutMs: 30_000,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: "/tmp/rad-no-home",
          LANG: "C",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    if (lines.length !== 1) {
      throw new RadError("REMOTE_HEAD_AMBIGUOUS", "Remote returned multiple exact branch heads");
    }
    const [objectId, observedRef, ...extra] = lines[0]!.trim().split(/\s+/);
    if (!objectId || !objectIdPattern.test(objectId) || observedRef !== ref || extra.length > 0) {
      throw new RadError("REMOTE_HEAD_INVALID", "Remote returned a malformed branch head");
    }
    return objectId;
  }
}
