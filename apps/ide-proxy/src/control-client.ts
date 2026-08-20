import type { IdeProxyConfig } from "./config.js";

export interface RedeemedSession {
  sessionToken: string;
  workspaceId: string;
  expiresAt: string;
}

export interface ResolvedSession {
  workspaceId: string;
  expiresAt: string;
}

export interface IdeAccessControlClient {
  redeem(code: string): Promise<RedeemedSession>;
  resolve(sessionToken: string): Promise<ResolvedSession>;
}

export class HttpIdeAccessControlClient implements IdeAccessControlClient {
  public constructor(private readonly config: IdeProxyConfig) {}

  public redeem(code: string): Promise<RedeemedSession> {
    return this.request("/internal/ide-access/redeem", { code });
  }

  public resolve(sessionToken: string): Promise<ResolvedSession> {
    return this.request("/internal/ide-access/resolve", { sessionToken });
  }

  private async request<T>(path: string, body: Record<string, string>): Promise<T> {
    const response = await fetch(new URL(path, this.config.RAD_CONTROL_INTERNAL_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.RAD_IDE_PROXY_SHARED_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Control rejected IDE access with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
