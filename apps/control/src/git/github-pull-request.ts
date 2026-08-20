import { z } from "zod";

import { parseGitHubRepository } from "@rad/github-token-issuer";
import { RadError } from "@rad/shared";

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
});

export interface PullRequestResult {
  number: number;
  url: string;
}

export interface PullRequestCreator {
  create(input: {
    remoteUrl: string;
    branchName: string;
    baseBranch: string;
    targetCommit: string;
    reviewDigest: string;
    token: string;
  }): Promise<PullRequestResult>;
}

export class GitHubPullRequestCreator implements PullRequestCreator {
  public constructor(
    private readonly apiUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  public async create(input: {
    remoteUrl: string;
    branchName: string;
    baseBranch: string;
    targetCommit: string;
    reviewDigest: string;
    token: string;
  }): Promise<PullRequestResult> {
    const repository = parseGitHubRepository(input.remoteUrl);
    const endpoint = `${this.apiUrl.replace(/\/$/, "")}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls`;
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "remote-agent-devbox",
    };
    const query = new URLSearchParams({
      state: "open",
      head: `${repository.owner}:${input.branchName}`,
      base: input.baseBranch,
      per_page: "1",
    });
    const existingResponse = await this.request(`${endpoint}?${query}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!existingResponse.ok) {
      throw new RadError(
        "GITHUB_PR_LOOKUP_FAILED",
        `GitHub pull request lookup failed with HTTP ${existingResponse.status}`,
      );
    }
    const existing = z.array(pullRequestSchema).parse(await existingResponse.json());
    if (existing[0]) return asResult(existing[0]);

    const response = await this.request(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `Remote Agent Devbox: ${input.branchName}`,
        head: input.branchName,
        base: input.baseBranch,
        body: [
          "Created from an approved immutable Remote Agent Devbox review.",
          "",
          `Target commit: \`${input.targetCommit}\``,
          `Review digest: \`${input.reviewDigest}\``,
        ].join("\n"),
        maintainer_can_modify: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 201) {
      throw new RadError(
        "GITHUB_PR_CREATE_FAILED",
        `GitHub pull request creation failed with HTTP ${response.status}`,
      );
    }
    return asResult(pullRequestSchema.parse(await response.json()));
  }
}

function asResult(value: z.infer<typeof pullRequestSchema>): PullRequestResult {
  return { number: value.number, url: value.html_url };
}
