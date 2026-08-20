import { describe, expect, it } from "vitest";

import type {
  ApprovalRepository,
  ApprovalRequest,
  NewApprovalRequest,
} from "@rad/approvals";
import type { ReviewSnapshot } from "@rad/git-artifacts";

import { ApprovalService } from "./approval-service.js";

const now = new Date("2026-01-01T12:00:00Z");
const review = {
  id: "30000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  reviewDigest: `sha256:${"a".repeat(64)}`,
  validatorProfileDigest: `sha256:${"b".repeat(64)}`,
  securityEpoch: 3,
  deploymentTier: 1,
  securityPostureHash: `sha256:${"c".repeat(64)}`,
} as ReviewSnapshot;

class MemoryApprovals implements ApprovalRepository {
  public record: ApprovalRequest | undefined;

  public async createBound(input: NewApprovalRequest): Promise<ApprovalRequest> {
    this.record = {
      ...input,
      status: "PENDING",
      staleReason: null,
      decidedBy: null,
      decidedAt: null,
    };
    return this.record;
  }

  public async get(id: string): Promise<ApprovalRequest | undefined> {
    return this.record?.id === id ? this.record : undefined;
  }

  public async findActiveByReview(reviewSnapshotId: string): Promise<ApprovalRequest | undefined> {
    return this.record?.reviewSnapshotId === reviewSnapshotId ? this.record : undefined;
  }

  public async approve(id: string, decidedBy: string, decidedAt: Date): Promise<ApprovalRequest> {
    return this.decide(id, "APPROVED", decidedBy, decidedAt);
  }

  public async deny(id: string, decidedBy: string, decidedAt: Date): Promise<ApprovalRequest> {
    return this.decide(id, "DENIED", decidedBy, decidedAt);
  }

  private decide(
    id: string,
    status: "APPROVED" | "DENIED",
    decidedBy: string,
    decidedAt: Date,
  ): ApprovalRequest {
    if (!this.record || this.record.id !== id) throw new Error("missing approval");
    this.record = { ...this.record, status, decidedBy, decidedAt };
    return this.record;
  }
}

describe("ApprovalService", () => {
  it("creates one expiry-bounded request tied to the current security context", async () => {
    const approvals = new MemoryApprovals();
    const service = createService(approvals, review);

    const first = await service.request(review.id, "10000000-0000-4000-8000-000000000001");
    const second = await service.request(review.id, "10000000-0000-4000-8000-000000000001");

    expect(second).toBe(first);
    expect(first.status).toBe("PENDING");
    expect(first.reviewDigest).toBe(review.reviewDigest);
    expect(first.validatorProfileDigest).toBe(review.validatorProfileDigest);
    expect(first.expiresAt.toISOString()).toBe("2026-01-01T13:00:00.000Z");
  });

  it("rejects a review from an older security epoch", async () => {
    const service = createService(new MemoryApprovals(), review, 4);
    await expect(
      service.request(review.id, "10000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("does not match");
  });

  it("records the explicit human decision", async () => {
    const service = createService(new MemoryApprovals(), review);
    const pending = await service.request(
      review.id,
      "10000000-0000-4000-8000-000000000001",
    );
    const approved = await service.approve(
      pending.id,
      "10000000-0000-4000-8000-000000000002",
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedBy).toBe("10000000-0000-4000-8000-000000000002");
  });
});

function createService(
  approvals: ApprovalRepository,
  snapshot: ReviewSnapshot,
  securityEpoch = snapshot.securityEpoch,
): ApprovalService {
  return new ApprovalService(
    approvals,
    { get: async () => snapshot },
    {
      getSecurityMetadata: async () => ({
        deploymentTier: snapshot.deploymentTier,
        securityEpoch,
        securityPostureHash: snapshot.securityPostureHash,
        updatedAt: now,
      }),
      synchronizeSecurityMetadata: async () => {
        throw new Error("not used");
      },
    },
    3_600,
    () => now,
  );
}
