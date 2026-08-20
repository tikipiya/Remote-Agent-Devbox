import { randomUUID } from "node:crypto";

import type { ApprovalRepository, ApprovalRequest } from "@rad/approvals";
import type { ReviewSnapshotRepository } from "@rad/git-artifacts";
import { RadError } from "@rad/shared";
import type { InstanceMetadataRepository } from "@rad/workspace-state";
import type { OperationalGuard } from "../security/maintenance-guard.js";

export class ApprovalService {
  public constructor(
    private readonly approvals: ApprovalRepository,
    private readonly reviews: Pick<ReviewSnapshotRepository, "get">,
    private readonly metadata: Pick<InstanceMetadataRepository, "getSecurityMetadata">,
    private readonly ttlSeconds: number,
    private readonly operationalGuard: OperationalGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async request(reviewSnapshotId: string, requestedBy: string): Promise<ApprovalRequest> {
    await this.operationalGuard.assertAvailable("Approval request");
    const existing = await this.approvals.findActiveByReview(reviewSnapshotId);
    if (existing) return existing;

    const review = await this.reviews.get(reviewSnapshotId);
    if (!review) {
      throw new RadError("REVIEW_NOT_FOUND", `Review ${reviewSnapshotId} not found`);
    }
    const metadata = await this.metadata.getSecurityMetadata();
    if (!metadata) {
      throw new RadError("SECURITY_CONTEXT_MISSING", "Instance security metadata is missing");
    }
    if (
      metadata.securityEpoch !== review.securityEpoch ||
      metadata.deploymentTier !== review.deploymentTier ||
      metadata.securityPostureHash !== review.securityPostureHash
    ) {
      throw new RadError(
        "REVIEW_SECURITY_CONTEXT_STALE",
        "Review Snapshot does not match the current security context",
      );
    }

    const requestedAt = this.now();
    return await this.approvals.createBound({
      id: randomUUID(),
      workspaceId: review.workspaceId,
      reviewSnapshotId: review.id,
      operationType: "CREATE_PULL_REQUEST",
      reviewDigest: review.reviewDigest,
      validatorProfileDigest: review.validatorProfileDigest,
      securityEpoch: review.securityEpoch,
      deploymentTier: review.deploymentTier,
      securityPostureHash: review.securityPostureHash,
      requestedBy,
      requestedAt,
      expiresAt: new Date(requestedAt.getTime() + this.ttlSeconds * 1_000),
    });
  }

  public get(id: string): Promise<ApprovalRequest | undefined> {
    return this.approvals.get(id);
  }

  public async approve(id: string, decidedBy: string): Promise<ApprovalRequest> {
    await this.operationalGuard.assertAvailable("Approval decision");
    return this.approvals.approve(id, decidedBy, this.now());
  }

  public deny(id: string, decidedBy: string): Promise<ApprovalRequest> {
    return this.approvals.deny(id, decidedBy, this.now());
  }
}
