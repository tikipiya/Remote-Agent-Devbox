import { describe, expect, it } from "vitest";

import {
  IdeAccessService,
  digestIdeToken,
  type IdeAccessCodeRecord,
  type IdeAccessRepository,
  type IdeAccessSessionRecord,
  type IssueIdeAccessCodeInput,
  type RedeemIdeAccessCodeInput,
} from "./index.js";

const code = "a".repeat(43);
const session = "b".repeat(43);
const now = new Date("2026-01-01T00:00:00.000Z");

class RecordingRepository implements IdeAccessRepository {
  public issued?: IssueIdeAccessCodeInput;
  public redeemed?: RedeemIdeAccessCodeInput;
  public resolved?: { digest: string; now: Date };

  public async issueCode(input: IssueIdeAccessCodeInput): Promise<IdeAccessCodeRecord> {
    this.issued = input;
    return {
      ...input,
      deploymentTier: 1,
      securityEpoch: 7,
      workspaceStateVersion: 3,
      consumedAt: null,
      invalidatedAt: null,
    };
  }

  public async redeemCode(input: RedeemIdeAccessCodeInput): Promise<IdeAccessSessionRecord> {
    this.redeemed = input;
    return {
      id: input.sessionId,
      workspaceId: "10000000-0000-4000-8000-000000000001",
      sessionDigest: input.sessionDigest,
      deploymentTier: 1,
      securityEpoch: 7,
      workspaceStateVersion: 3,
      createdAt: input.redeemedAt,
      expiresAt: new Date(input.redeemedAt.getTime() + 3_600_000),
      revokedAt: null,
    };
  }

  public async resolveSession(
    digest: string,
    resolvedAt: Date,
  ): Promise<IdeAccessSessionRecord> {
    this.resolved = { digest, now: resolvedAt };
    return {
      id: "20000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000001",
      sessionDigest: digest,
      deploymentTier: 1,
      securityEpoch: 7,
      workspaceStateVersion: 3,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      revokedAt: null,
    };
  }
}

describe("IDE access service", () => {
  it("stores only a digest for a bounded one-time code", async () => {
    const repository = new RecordingRepository();
    const service = new IdeAccessService(repository, 60, 3_600, () => now, () => code);

    const issued = await service.issue("10000000-0000-4000-8000-000000000001");

    expect(issued.code).toBe(code);
    expect(issued.expiresAt).toEqual(new Date("2026-01-01T00:01:00.000Z"));
    expect(repository.issued?.codeDigest).toBe(digestIdeToken(code));
    expect(JSON.stringify(repository.issued)).not.toContain(code);
  });

  it("exchanges a code for a different opaque session token", async () => {
    const repository = new RecordingRepository();
    const tokens = [session];
    const service = new IdeAccessService(
      repository,
      60,
      3_600,
      () => now,
      () => tokens.shift() ?? code,
    );

    const redeemed = await service.redeem(code);

    expect(redeemed.sessionToken).toBe(session);
    expect(repository.redeemed?.codeDigest).toBe(digestIdeToken(code));
    expect(repository.redeemed?.sessionDigest).toBe(digestIdeToken(session));
    expect(repository.redeemed?.sessionTtlSeconds).toBe(3_600);
  });

  it("resolves only canonical opaque session tokens by digest", async () => {
    const repository = new RecordingRepository();
    const service = new IdeAccessService(repository, 60, 3_600, () => now);

    await service.resolve(session);

    expect(repository.resolved).toEqual({ digest: digestIdeToken(session), now });
    await expect(service.resolve("short")).rejects.toThrow();
  });
});
