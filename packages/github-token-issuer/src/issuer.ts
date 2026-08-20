import { createPrivateKey, sign } from "node:crypto";

import { z } from "zod";

import { RadError, type RuntimeConfig } from "@rad/shared";
import type { InstanceMetadataRepository } from "@rad/workspace-state";

const tokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime(),
});

type GitHubIssuerConfig = Pick<
  RuntimeConfig,
  | "RAD_GITHUB_API_URL"
  | "RAD_GITHUB_APP_ID"
  | "RAD_GITHUB_INSTALLATION_ID"
  | "RAD_GITHUB_PRIVATE_KEY_BASE64"
>;

export interface EphemeralCredential {
  token: string;
  expiresAt: Date;
}

export interface TokenIssuer {
  issueForOperation(input: {
    operationId: string;
    repositoryId: string;
    repositoryRemoteUrl: string;
    securityEpoch: number;
  }): Promise<EphemeralCredential>;
}

type Fetch = typeof fetch;

export class GitHubAppTokenIssuer implements TokenIssuer {
  public constructor(
    private readonly config: GitHubIssuerConfig,
    private readonly metadata: Pick<InstanceMetadataRepository, "getSecurityMetadata">,
    private readonly request: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async issueForOperation(input: {
    operationId: string;
    repositoryId: string;
    repositoryRemoteUrl: string;
    securityEpoch: number;
  }): Promise<EphemeralCredential> {
    const appId = this.config.RAD_GITHUB_APP_ID;
    const installationId = this.config.RAD_GITHUB_INSTALLATION_ID;
    const privateKeyBase64 = this.config.RAD_GITHUB_PRIVATE_KEY_BASE64;
    if (!appId || !installationId || !privateKeyBase64) {
      throw new RadError(
        "GITHUB_APP_NOT_CONFIGURED",
        "GitHub App credentials are required for approved Git writes",
      );
    }
    const metadata = await this.metadata.getSecurityMetadata();
    if (
      !metadata ||
      metadata.maintenanceMode ||
      metadata.securityEpoch !== input.securityEpoch
    ) {
      throw new RadError(
        "TOKEN_SECURITY_EPOCH_MISMATCH",
        "Security epoch changed or maintenance started before credential issuance",
      );
    }
    const repository = parseGitHubRepository(input.repositoryRemoteUrl);
    const jwt = createAppJwt(appId, privateKeyBase64, this.now());
    const response = await this.request(
      `${this.config.RAD_GITHUB_API_URL.replace(/\/$/, "")}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "x-github-api-version": "2026-03-10",
          "user-agent": "remote-agent-devbox",
        },
        body: JSON.stringify({
          repositories: [repository.name],
          permissions: { contents: "write", pull_requests: "write" },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status !== 201) {
      throw new RadError(
        "GITHUB_TOKEN_ISSUANCE_FAILED",
        `GitHub installation token request failed with HTTP ${response.status}`,
      );
    }
    const decoded = tokenResponseSchema.parse(await response.json());
    const expiresAt = new Date(decoded.expires_at);
    if (expiresAt.getTime() <= this.now().getTime() + 30_000) {
      throw new RadError("GITHUB_TOKEN_ALREADY_EXPIRED", "GitHub returned an unusable token");
    }
    return { token: decoded.token, expiresAt };
  }
}

export function parseGitHubRepository(remoteUrl: string): { owner: string; name: string } {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    throw new RadError("GITHUB_REMOTE_INVALID", "Repository remote URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new RadError("GITHUB_REMOTE_UNSUPPORTED", "Git writes require a canonical github.com HTTPS URL");
  }
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
  if (!match) {
    throw new RadError("GITHUB_REMOTE_INVALID", "GitHub repository path is invalid");
  }
  return { owner: match[1]!, name: match[2]! };
}

function createAppJwt(appId: string, privateKeyBase64: string, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1_000) - 60;
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({ iat: issuedAt, exp: issuedAt + 600, iss: appId });
  const signingInput = `${header}.${payload}`;
  let privateKey;
  try {
    privateKey = createPrivateKey(Buffer.from(privateKeyBase64, "base64").toString("utf8"));
  } catch {
    throw new RadError("GITHUB_PRIVATE_KEY_INVALID", "GitHub App private key is invalid");
  }
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
