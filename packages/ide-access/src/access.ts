import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import type { IdeAccessRepository } from "./repository.js";

export const opaqueIdeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const ideTokenDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export interface IssuedIdeAccessCode {
  code: string;
  expiresAt: Date;
  workspaceId: string;
}

export interface RedeemedIdeAccessSession {
  sessionToken: string;
  expiresAt: Date;
  workspaceId: string;
}

export interface ResolvedIdeAccessSession {
  expiresAt: Date;
  workspaceId: string;
}

export class IdeAccessService {
  public constructor(
    private readonly repository: IdeAccessRepository,
    private readonly codeTtlSeconds: number,
    private readonly sessionTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly createToken: () => string = generateOpaqueIdeToken,
  ) {}

  public async issue(workspaceId: string): Promise<IssuedIdeAccessCode> {
    const code = opaqueIdeTokenSchema.parse(this.createToken());
    const createdAt = this.now();
    const record = await this.repository.issueCode({
      id: randomUUID(),
      workspaceId,
      codeDigest: digestIdeToken(code),
      expiresAt: new Date(createdAt.getTime() + this.codeTtlSeconds * 1_000),
      createdAt,
    });
    return { code, expiresAt: record.expiresAt, workspaceId: record.workspaceId };
  }

  public async redeem(code: string): Promise<RedeemedIdeAccessSession> {
    const parsedCode = opaqueIdeTokenSchema.parse(code);
    const sessionToken = opaqueIdeTokenSchema.parse(this.createToken());
    const redeemedAt = this.now();
    const record = await this.repository.redeemCode({
      codeDigest: digestIdeToken(parsedCode),
      sessionId: randomUUID(),
      sessionDigest: digestIdeToken(sessionToken),
      sessionTtlSeconds: this.sessionTtlSeconds,
      redeemedAt,
    });
    return {
      sessionToken,
      expiresAt: record.expiresAt,
      workspaceId: record.workspaceId,
    };
  }

  public async resolve(sessionToken: string): Promise<ResolvedIdeAccessSession> {
    const parsedToken = opaqueIdeTokenSchema.parse(sessionToken);
    const record = await this.repository.resolveSession(
      digestIdeToken(parsedToken),
      this.now(),
    );
    return { expiresAt: record.expiresAt, workspaceId: record.workspaceId };
  }
}

export function generateOpaqueIdeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestIdeToken(token: string): string {
  opaqueIdeTokenSchema.parse(token);
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}
