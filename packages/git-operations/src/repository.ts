import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { approvalRequests } from "@rad/approvals";
import { reviewSnapshots, sha256DigestSchema, type Sha256Digest } from "@rad/git-artifacts";
import { RadError, gitRefNameSchema } from "@rad/shared";
import { instanceMetadata, repositories, workspaces } from "@rad/workspace-state";

import {
  canTransitionGitOperation,
  credentialLeaseStateSchema,
  gitOperationStateSchema,
  type CredentialLease,
  type GitOperation,
  type GitOperationState,
} from "./operation.js";

const objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export const gitOperations = pgTable(
  "git_operations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id),
    reviewSnapshotId: uuid("review_snapshot_id").notNull().references(() => reviewSnapshots.id),
    approvalId: uuid("approval_id").notNull().unique().references(() => approvalRequests.id),
    branchName: text("branch_name").notNull(),
    targetCommit: text("target_commit").notNull(),
    expectedRemoteHead: text("expected_remote_head"),
    reviewDigest: text("review_digest").notNull(),
    validatorProfileDigest: text("validator_profile_digest").notNull(),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    staleReason: text("stale_reason"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    pullRequestNumber: bigint("pull_request_number", { mode: "number" }),
    pullRequestUrl: text("pull_request_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("git_operations_workspace_idx").on(table.workspaceId, table.createdAt),
    index("git_operations_state_idx").on(table.state, table.createdAt),
    check("git_operations_epoch_check", sql`${table.securityEpoch} > 0`),
  ],
);

export const credentialLeases = pgTable(
  "credential_leases",
  {
    id: uuid("id").primaryKey(),
    operationId: uuid("operation_id").notNull().unique().references(() => gitOperations.id),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("credential_leases_state_idx").on(table.state, table.createdAt),
    check("credential_leases_epoch_check", sql`${table.securityEpoch} > 0`),
  ],
);

export interface NewGitOperation {
  id: string;
  workspaceId: string;
  repositoryId: string;
  reviewSnapshotId: string;
  approvalId: string;
  branchName: string;
  targetCommit: string;
  expectedRemoteHead: string | null;
  reviewDigest: Sha256Digest;
  validatorProfileDigest: Sha256Digest;
  securityEpoch: number;
  createdAt: Date;
}

export interface GitOperationRepository {
  createBound(input: NewGitOperation): Promise<GitOperation>;
  get(id: string): Promise<GitOperation | undefined>;
  findByApproval(approvalId: string): Promise<GitOperation | undefined>;
  transition(
    id: string,
    expectedState: GitOperationState,
    nextState: GitOperationState,
    values?: Partial<Pick<GitOperation, "staleReason" | "errorCode" | "errorMessage" | "pullRequestNumber" | "pullRequestUrl" | "startedAt" | "completedAt">>,
  ): Promise<GitOperation>;
}

export interface CredentialLeaseRepository {
  reserve(input: {
    id: string;
    operationId: string;
    repositoryId: string;
    securityEpoch: number;
    createdAt: Date;
  }): Promise<CredentialLease>;
  markIssued(id: string, issuedAt: Date, expiresAt: Date): Promise<CredentialLease>;
  markConsumed(id: string, consumedAt: Date): Promise<CredentialLease>;
  markFailed(id: string, failedAt: Date, reason: string): Promise<CredentialLease>;
  markUncertain(id: string, observedAt: Date, reason: string): Promise<CredentialLease>;
}

export class PostgresGitOperationRepository implements GitOperationRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async createBound(input: NewGitOperation): Promise<GitOperation> {
    gitRefNameSchema.parse(input.branchName);
    if (!objectIdPattern.test(input.targetCommit)) {
      throw new RadError("GIT_TARGET_INVALID", "Target commit object ID is invalid");
    }
    if (input.expectedRemoteHead && !objectIdPattern.test(input.expectedRemoteHead)) {
      throw new RadError("REMOTE_HEAD_INVALID", "Expected remote head object ID is invalid");
    }

    return await this.db.transaction(async (transaction) => {
      const [approval] = await transaction
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, input.approvalId))
        .for("update");
      if (
        !approval ||
        approval.status !== "APPROVED" ||
        approval.expiresAt <= input.createdAt ||
        approval.reviewSnapshotId !== input.reviewSnapshotId ||
        approval.workspaceId !== input.workspaceId ||
        approval.reviewDigest !== input.reviewDigest ||
        approval.validatorProfileDigest !== input.validatorProfileDigest ||
        approval.securityEpoch !== input.securityEpoch
      ) {
        throw new RadError(
          "APPROVAL_BINDING_INVALID",
          "Approval is expired, unapproved, or does not match the Git operation",
        );
      }

      const [review] = await transaction
        .select({
          repositoryId: reviewSnapshots.repositoryId,
          workspaceId: reviewSnapshots.workspaceId,
          targetCommit: reviewSnapshots.targetCommit,
          reviewDigest: reviewSnapshots.reviewDigest,
          validatorProfileDigest: reviewSnapshots.validatorProfileDigest,
          securityEpoch: reviewSnapshots.securityEpoch,
        })
        .from(reviewSnapshots)
        .where(eq(reviewSnapshots.id, input.reviewSnapshotId))
        .for("share");
      if (
        !review ||
        review.repositoryId !== input.repositoryId ||
        review.workspaceId !== input.workspaceId ||
        review.targetCommit !== input.targetCommit ||
        review.reviewDigest !== input.reviewDigest ||
        review.validatorProfileDigest !== input.validatorProfileDigest ||
        review.securityEpoch !== input.securityEpoch
      ) {
        throw new RadError("GIT_REVIEW_MISMATCH", "Git operation does not match its review");
      }

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
        throw new RadError(
          "GIT_SECURITY_CONTEXT_STALE",
          "Approval security context is no longer current",
        );
      }

      const [record] = await transaction
        .insert(gitOperations)
        .values({ ...input, state: "PENDING" })
        .returning();
      if (!record) throw new RadError("GIT_OPERATION_CREATE_FAILED", "Git operation was not created");
      return asGitOperation(record);
    });
  }

  public async get(id: string): Promise<GitOperation | undefined> {
    const [record] = await this.db.select().from(gitOperations).where(eq(gitOperations.id, id)).limit(1);
    return record ? asGitOperation(record) : undefined;
  }

  public async findByApproval(approvalId: string): Promise<GitOperation | undefined> {
    const [record] = await this.db
      .select()
      .from(gitOperations)
      .where(eq(gitOperations.approvalId, approvalId))
      .limit(1);
    return record ? asGitOperation(record) : undefined;
  }

  public async transition(
    id: string,
    expectedState: GitOperationState,
    nextState: GitOperationState,
    values: Partial<Pick<GitOperation, "staleReason" | "errorCode" | "errorMessage" | "pullRequestNumber" | "pullRequestUrl" | "startedAt" | "completedAt">> = {},
  ): Promise<GitOperation> {
    if (!canTransitionGitOperation(expectedState, nextState)) {
      throw new RadError(
        "GIT_OPERATION_TRANSITION_INVALID",
        `Git operation cannot transition from ${expectedState} to ${nextState}`,
      );
    }
    const [record] = await this.db
      .update(gitOperations)
      .set({ ...values, state: nextState })
      .where(and(eq(gitOperations.id, id), eq(gitOperations.state, expectedState)))
      .returning();
    if (!record) {
      throw new RadError("GIT_OPERATION_STATE_CONFLICT", `Git operation ${id} changed concurrently`);
    }
    return asGitOperation(record);
  }
}

export class PostgresCredentialLeaseRepository implements CredentialLeaseRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async reserve(input: {
    id: string;
    operationId: string;
    repositoryId: string;
    securityEpoch: number;
    createdAt: Date;
  }): Promise<CredentialLease> {
    return await this.db.transaction(async (transaction) => {
      const [operation] = await transaction
        .select()
        .from(gitOperations)
        .where(eq(gitOperations.id, input.operationId))
        .for("update");
      const [metadata] = await transaction
        .select()
        .from(instanceMetadata)
        .where(eq(instanceMetadata.singletonKey, "instance"))
        .for("update");
      if (
        !operation ||
        operation.state !== "WAITING_CREDENTIAL" ||
        operation.repositoryId !== input.repositoryId ||
        operation.securityEpoch !== input.securityEpoch ||
        !metadata ||
        metadata.securityEpoch !== input.securityEpoch
      ) {
        throw new RadError(
          "CREDENTIAL_LEASE_CONTEXT_INVALID",
          "Credential lease does not match a current waiting Git operation",
        );
      }
      const [record] = await transaction
        .insert(credentialLeases)
        .values({ ...input, state: "RESERVED" })
        .returning();
      if (!record) throw new RadError("CREDENTIAL_LEASE_CREATE_FAILED", "Lease was not reserved");
      return asCredentialLease(record);
    });
  }

  public markIssued(id: string, issuedAt: Date, expiresAt: Date): Promise<CredentialLease> {
    if (expiresAt <= issuedAt) throw new RadError("CREDENTIAL_EXPIRY_INVALID", "Credential already expired");
    return this.transition(id, ["RESERVED"], "ISSUED", { issuedAt, expiresAt });
  }

  public markConsumed(id: string, consumedAt: Date): Promise<CredentialLease> {
    return this.transition(id, ["ISSUED"], "CONSUMED", { consumedAt });
  }

  public markFailed(id: string, failedAt: Date, reason: string): Promise<CredentialLease> {
    void failedAt;
    return this.transition(id, ["RESERVED"], "FAILED", { failureReason: reason });
  }

  public markUncertain(id: string, observedAt: Date, reason: string): Promise<CredentialLease> {
    void observedAt;
    return this.transition(id, ["ISSUED"], "UNCERTAIN", { failureReason: reason });
  }

  private async transition(
    id: string,
    expectedStates: readonly (typeof credentialLeases.$inferSelect.state)[],
    state: typeof credentialLeases.$inferInsert.state,
    values: Partial<typeof credentialLeases.$inferInsert>,
  ): Promise<CredentialLease> {
    const [record] = await this.db
      .update(credentialLeases)
      .set({ ...values, state })
      .where(and(eq(credentialLeases.id, id), inArray(credentialLeases.state, expectedStates)))
      .returning();
    if (!record) {
      throw new RadError("CREDENTIAL_LEASE_STATE_CONFLICT", `Lease ${id} changed concurrently`);
    }
    return asCredentialLease(record);
  }
}

function asGitOperation(record: typeof gitOperations.$inferSelect): GitOperation {
  return {
    ...record,
    reviewDigest: sha256DigestSchema.parse(record.reviewDigest),
    validatorProfileDigest: sha256DigestSchema.parse(record.validatorProfileDigest),
    state: gitOperationStateSchema.parse(record.state),
  };
}

function asCredentialLease(record: typeof credentialLeases.$inferSelect): CredentialLease {
  return { ...record, state: credentialLeaseStateSchema.parse(record.state) };
}
