import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { reviewSnapshots, sha256DigestSchema, type Sha256Digest } from "@rad/git-artifacts";
import { RadError } from "@rad/shared";
import { instanceMetadata, workspaces } from "@rad/workspace-state";

import {
  approvalOperationTypeSchema,
  approvalStaleReasonSchema,
  approvalStatusSchema,
  type ApprovalRequest,
  type ApprovalStaleReason,
} from "./approval.js";

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    reviewSnapshotId: uuid("review_snapshot_id")
      .notNull()
      .references(() => reviewSnapshots.id, { onDelete: "restrict" }),
    operationType: text("operation_type").notNull(),
    reviewDigest: text("review_digest").notNull(),
    validatorProfileDigest: text("validator_profile_digest").notNull(),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull(),
    deploymentTier: bigint("deployment_tier", { mode: "number" }).notNull(),
    securityPostureHash: text("security_posture_hash").notNull(),
    status: text("status").notNull(),
    staleReason: text("stale_reason"),
    requestedBy: uuid("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("approval_requests_active_review_idx")
      .on(table.reviewSnapshotId)
      .where(inArray(table.status, ["PENDING", "APPROVED"])),
    index("approval_requests_workspace_idx").on(table.workspaceId, table.requestedAt),
    check("approval_requests_operation_check", sql`${table.operationType} = 'CREATE_PULL_REQUEST'`),
    check(
      "approval_requests_status_check",
      sql`${table.status} IN ('PENDING', 'APPROVED', 'DENIED', 'STALE')`,
    ),
    check("approval_requests_epoch_check", sql`${table.securityEpoch} > 0`),
    check("approval_requests_tier_check", sql`${table.deploymentTier} BETWEEN 1 AND 3`),
    check("approval_requests_expiry_check", sql`${table.expiresAt} > ${table.requestedAt}`),
  ],
);

export interface NewApprovalRequest {
  id: string;
  workspaceId: string;
  reviewSnapshotId: string;
  operationType: "CREATE_PULL_REQUEST";
  reviewDigest: Sha256Digest;
  validatorProfileDigest: Sha256Digest;
  securityEpoch: number;
  deploymentTier: number;
  securityPostureHash: Sha256Digest;
  requestedBy: string;
  requestedAt: Date;
  expiresAt: Date;
}

export interface ApprovalRepository {
  createBound(input: NewApprovalRequest): Promise<ApprovalRequest>;
  get(id: string): Promise<ApprovalRequest | undefined>;
  findActiveByReview(reviewSnapshotId: string): Promise<ApprovalRequest | undefined>;
  approve(id: string, decidedBy: string, decidedAt: Date): Promise<ApprovalRequest>;
  deny(id: string, decidedBy: string, decidedAt: Date): Promise<ApprovalRequest>;
}

export class PostgresApprovalRepository implements ApprovalRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async createBound(input: NewApprovalRequest): Promise<ApprovalRequest> {
    return await this.db.transaction(async (transaction) => {
      const [metadata] = await transaction
        .select()
        .from(instanceMetadata)
        .where(eq(instanceMetadata.singletonKey, "instance"))
        .for("update");
      if (
        !metadata ||
        metadata.securityEpoch !== input.securityEpoch ||
        metadata.deploymentTier !== input.deploymentTier ||
        metadata.securityPostureHash !== input.securityPostureHash
      ) {
        throw new RadError(
          "SECURITY_CONTEXT_CHANGED",
          "Security context changed before approval creation",
        );
      }

      const [review] = await transaction
        .select({
          id: reviewSnapshots.id,
          workspaceId: reviewSnapshots.workspaceId,
          reviewDigest: reviewSnapshots.reviewDigest,
          validatorProfileDigest: reviewSnapshots.validatorProfileDigest,
          securityEpoch: reviewSnapshots.securityEpoch,
          deploymentTier: reviewSnapshots.deploymentTier,
          securityPostureHash: reviewSnapshots.securityPostureHash,
        })
        .from(reviewSnapshots)
        .where(eq(reviewSnapshots.id, input.reviewSnapshotId))
        .for("share");
      if (!review || !approvalMatchesReview(input, review)) {
        throw new RadError(
          "APPROVAL_REVIEW_MISMATCH",
          "Approval binding does not match the immutable Review Snapshot",
        );
      }

      const [record] = await transaction
        .insert(approvalRequests)
        .values({ ...input, status: "PENDING", staleReason: null })
        .returning();
      if (!record) {
        throw new RadError("APPROVAL_CREATE_FAILED", "Approval request was not created");
      }
      return asApproval(record);
    });
  }

  public async get(id: string): Promise<ApprovalRequest | undefined> {
    const [record] = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    return record ? asApproval(record) : undefined;
  }

  public async findActiveByReview(reviewSnapshotId: string): Promise<ApprovalRequest | undefined> {
    const [record] = await this.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.reviewSnapshotId, reviewSnapshotId),
          inArray(approvalRequests.status, ["PENDING", "APPROVED"]),
        ),
      )
      .limit(1);
    return record ? asApproval(record) : undefined;
  }

  public approve(id: string, decidedBy: string, decidedAt: Date): Promise<ApprovalRequest> {
    return this.decide(id, "APPROVED", decidedBy, decidedAt);
  }

  public deny(id: string, decidedBy: string, decidedAt: Date): Promise<ApprovalRequest> {
    return this.decide(id, "DENIED", decidedBy, decidedAt);
  }

  private async decide(
    id: string,
    decision: "APPROVED" | "DENIED",
    decidedBy: string,
    decidedAt: Date,
  ): Promise<ApprovalRequest> {
    return await this.db.transaction(async (transaction) => {
      const [record] = await transaction
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, id))
        .for("update");
      if (!record) throw new RadError("APPROVAL_NOT_FOUND", `Approval ${id} not found`);
      if (record.status !== "PENDING") {
        throw new RadError(
          "APPROVAL_STATE_CONFLICT",
          `Approval ${id} cannot be decided from ${record.status}`,
        );
      }

      const staleReason =
        decidedAt >= record.expiresAt
          ? "APPROVAL_EXPIRED"
          : await this.findStaleReason(transaction, record);
      const [updated] = await transaction
        .update(approvalRequests)
        .set(
          staleReason
            ? { status: "STALE", staleReason, decidedAt, decidedBy: null }
            : { status: decision, staleReason: null, decidedAt, decidedBy },
        )
        .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, "PENDING")))
        .returning();
      if (!updated) {
        throw new RadError("APPROVAL_STATE_CONFLICT", `Approval ${id} changed concurrently`);
      }
      return asApproval(updated);
    });
  }

  private async findStaleReason(
    transaction: Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0],
    approval: typeof approvalRequests.$inferSelect,
  ): Promise<ApprovalStaleReason | undefined> {
    const [metadata] = await transaction
      .select()
      .from(instanceMetadata)
      .where(eq(instanceMetadata.singletonKey, "instance"))
      .for("update");
    if (
      !metadata ||
      metadata.securityEpoch !== approval.securityEpoch ||
      metadata.deploymentTier !== approval.deploymentTier ||
      metadata.securityPostureHash !== approval.securityPostureHash
    ) {
      return "STALE_APPROVAL_SECURITY_POSTURE_CHANGED";
    }

    const [review] = await transaction
      .select({
        reviewDigest: reviewSnapshots.reviewDigest,
        validatorProfileDigest: reviewSnapshots.validatorProfileDigest,
        securityEpoch: reviewSnapshots.securityEpoch,
        deploymentTier: reviewSnapshots.deploymentTier,
        securityPostureHash: reviewSnapshots.securityPostureHash,
      })
      .from(reviewSnapshots)
      .where(eq(reviewSnapshots.id, approval.reviewSnapshotId))
      .for("share");
    if (!review || review.reviewDigest !== approval.reviewDigest) {
      return "STALE_APPROVAL_ARTIFACT_CHANGED";
    }
    if (review.validatorProfileDigest !== approval.validatorProfileDigest) {
      return "STALE_APPROVAL_VALIDATOR_CHANGED";
    }
    if (
      review.securityEpoch !== approval.securityEpoch ||
      review.deploymentTier !== approval.deploymentTier ||
      review.securityPostureHash !== approval.securityPostureHash
    ) {
      return "STALE_APPROVAL_SECURITY_POSTURE_CHANGED";
    }
    return undefined;
  }
}

function approvalMatchesReview(
  input: NewApprovalRequest,
  review: {
    workspaceId: string;
    reviewDigest: string;
    validatorProfileDigest: string;
    securityEpoch: number;
    deploymentTier: number;
    securityPostureHash: string;
  },
): boolean {
  return (
    review.workspaceId === input.workspaceId &&
    review.reviewDigest === input.reviewDigest &&
    review.validatorProfileDigest === input.validatorProfileDigest &&
    review.securityEpoch === input.securityEpoch &&
    review.deploymentTier === input.deploymentTier &&
    review.securityPostureHash === input.securityPostureHash
  );
}

function asApproval(record: typeof approvalRequests.$inferSelect): ApprovalRequest {
  return {
    ...record,
    operationType: approvalOperationTypeSchema.parse(record.operationType),
    reviewDigest: sha256DigestSchema.parse(record.reviewDigest),
    validatorProfileDigest: sha256DigestSchema.parse(record.validatorProfileDigest),
    securityPostureHash: sha256DigestSchema.parse(record.securityPostureHash),
    status: approvalStatusSchema.parse(record.status),
    staleReason: record.staleReason
      ? approvalStaleReasonSchema.parse(record.staleReason)
      : null,
  };
}
