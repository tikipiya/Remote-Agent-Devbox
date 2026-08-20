import { describe, expect, it } from "vitest";

import { GitHubPullRequestCreator } from "./github-pull-request.js";

describe("GitHubPullRequestCreator", () => {
  it("reuses an existing open pull request", async () => {
    let calls = 0;
    const creator = new GitHubPullRequestCreator("https://api.github.com", async () => {
      calls += 1;
      return Response.json([{ number: 12, html_url: "https://github.com/o/r/pull/12" }]);
    });
    const result = await creator.create(input());
    expect(result).toEqual({ number: 12, url: "https://github.com/o/r/pull/12" });
    expect(calls).toBe(1);
  });

  it("creates a PR against the configured default branch without exposing token in URL", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const creator = new GitHubPullRequestCreator("https://api.github.com", async (url, init) => {
      requests.push({ url: String(url), init });
      return requests.length === 1
        ? Response.json([])
        : Response.json(
            { number: 13, html_url: "https://github.com/o/r/pull/13" },
            { status: 201 },
          );
    });
    const result = await creator.create(input());
    expect(result.number).toBe(13);
    expect(requests.every((request) => !request.url.includes("secret"))).toBe(true);
    expect(JSON.parse(String(requests[1]!.init?.body))).toMatchObject({
      head: "agent/test",
      base: "main",
      maintainer_can_modify: false,
    });
  });
});

function input() {
  return {
    remoteUrl: "https://github.com/o/r.git",
    branchName: "agent/test",
    baseBranch: "main",
    targetCommit: "a".repeat(40),
    reviewDigest: `sha256:${"b".repeat(64)}`,
    token: "secret",
  };
}
