import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import { auditEvents, type AuditEventRepository } from "@rad/audit-events";
import { approvalRequests } from "@rad/approvals";
import { sha256DigestSchema, type Sha256Digest } from "@rad/git-artifacts";
import { credentialLeases, gitOperations } from "@rad/git-operations";
import { ideAccessCodes, ideAccessSessions } from "@rad/ide-access";
import { RadError } from "@rad/shared";
import {
  instanceMetadata,
  workspaces,
  type InstanceMetadataRepository,
  type InstanceSecurityMetadata,
  type WorkspaceReconciler,
} from "@rad/workspace-state";

export interface SecurityMigrationInput {
  targetTier: number;
  targetPostureHash: Sha256Digest;
  initiatedBy: string;
  reason: string;
  confirmation: string;
  forceEpochRotation?: boolean;
}

export interface SecurityMigrationResult {
  metadata: InstanceSecurityMetadata;
  staleApprovals: number;
  cancelledOperations: number;
  invalidatedLeases: number;
  invalidatedIdeCodes: number;
  revokedIdeSessions: number;
  stoppedWorkspaces: number;
}

interface CommitSecurityMigrationInput extends SecurityMigrationInput {
  expectedTier: number;
  expectedEpoch: number;
  expectedPostureHash: string;
  completedAt: Date;
}

export interface SecurityMigrationRepository {
  commit(input: CommitSecurityMigrationInput): Promise<SecurityMigrationResult>;
}

export class SecurityMigrationService {
  public constructor(
    private readonly metadata: InstanceMetadataRepository,
    private readonly migrations: SecurityMigrationRepository,
    private readonly audit: AuditEventRepository,
    private readonly reconciler: Pick<WorkspaceReconciler, "reconcileAll">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async migrate(input: SecurityMigrationInput): Promise<SecurityMigrationResult> {
    const current = await this.metadata.getSecurityMetadata();
    if (!current) {
      throw new RadError("SECURITY_CONTEXT_MISSING", "Instance security metadata is missing");
    }
    validateMigrationInput(input, current);

    const requestedAt = this.now();
    await this.audit.append(auditRecord(
      "SECURITY_POSTURE_MIGRATION_REQUESTED",
      input,
      current,
      requestedAt,
      "HIGH",
    ));

    const maintenanceReason = `security-migration:${input.reason}`;
    if (current.maintenanceMode && current.maintenanceReason !== maintenanceReason) {
      throw new RadError(
        "MAINTENANCE_MODE_ALREADY_ACTIVE",
        "A different maintenance operation is already active",
      );
    }
    const maintenance = await this.metadata.enterMaintenanceMode(
      maintenanceReason,
      requestedAt,
    );
    if (maintenance.maintenanceReason !== maintenanceReason) {
      throw new RadError(
        "MAINTENANCE_MODE_ALREADY_ACTIVE",
        "A concurrent maintenance operation won the migration lock",
      );
    }
    await this.audit.append(auditRecord(
      "SECURITY_POSTURE_MIGRATION_STARTED",
      input,
      maintenance,
      this.now(),
      "HIGH",
    ));

    try {
      const result = await this.migrations.commit({
        ...input,
        expectedTier: current.deploymentTier,
        expectedEpoch: current.securityEpoch,
        expectedPostureHash: current.securityPostureHash,
        completedAt: this.now(),
      });
      await this.reconciler.reconcileAll();
      return result;
    } catch (error) {
      await this.audit.append({
        ...auditRecord(
          "SECURITY_POSTURE_MIGRATION_FAILED",
          input,
          maintenance,
          this.now(),
          "CRITICAL",
        ),
        details: {
          fromTier: current.deploymentTier,
          toTier: input.targetTier,
          errorCode: error instanceof RadError ? error.code : "SECURITY_MIGRATION_FAILED",
        },
      });
      throw error;
    }
  }
}

export class PostgresSecurityMigrationRepository implements SecurityMigrationRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async commit(input: CommitSecurityMigrationInput): Promise<SecurityMigrationResult> {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(instanceMetadata)
        .where(eq(instanceMetadata.singletonKey, "instance"))
        .for("update");
      if (
        !current ||
        !current.maintenanceMode ||
        current.deploymentTier !== input.expectedTier ||
        current.securityEpoch !== input.expectedEpoch ||
        current.securityPostureHash !== input.expectedPostureHash
      ) {
        throw new RadError(
          "SECURITY_MIGRATION_CONTEXT_CHANGED",
          "Security context changed before migration commit",
        );
      }

      const [pushing] = await transaction
        .select({ id: gitOperations.id })
        .from(gitOperations)
        .where(eq(gitOperations.state, "PUSHING"))
        .limit(1)
        .for("update");
      if (pushing) {
        throw new RadError(
          "SECURITY_MIGRATION_PUSH_IN_FLIGHT",
          "A PUSHING Git operation requires manual inspection before migration",
        );
      }

      const staleApprovals = await transaction
        .update(approvalRequests)
        .set({
          status: "STALE",
          staleReason: "STALE_APPROVAL_SECURITY_POSTURE_CHANGED",
        })
        .where(inArray(approvalRequests.status, ["PENDING", "APPROVED"]))
        .returning({ id: approvalRequests.id });

      const cancelledOperations = await transaction
        .update(gitOperations)
        .set({
          state: "CANCELLED",
          errorCode: "SECURITY_MIGRATION_CANCELLED",
          errorMessage: "Cancelled by explicit security posture migration",
          completedAt: input.completedAt,
        })
        .where(inArray(gitOperations.state, ["PENDING", "VALIDATING", "WAITING_CREDENTIAL"]))
        .returning({ id: gitOperations.id });

      const failedReservations = await transaction
        .update(credentialLeases)
        .set({ state: "FAILED", failureReason: "Invalidated by security posture migration" })
        .where(eq(credentialLeases.state, "RESERVED"))
        .returning({ id: credentialLeases.id });
      const expiredCredentials = await transaction
        .update(credentialLeases)
        .set({
          state: "EXPIRED",
          expiresAt: input.completedAt,
          failureReason: "Invalidated by security posture migration",
        })
        .where(eq(credentialLeases.state, "ISSUED"))
        .returning({ id: credentialLeases.id });

      const invalidatedIdeCodes = await transaction
        .update(ideAccessCodes)
        .set({ invalidatedAt: input.completedAt })
        .where(
          and(
            isNull(ideAccessCodes.consumedAt),
            isNull(ideAccessCodes.invalidatedAt),
          ),
        )
        .returning({ id: ideAccessCodes.id });
      const revokedIdeSessions = await transaction
        .update(ideAccessSessions)
        .set({ revokedAt: input.completedAt })
        .where(isNull(ideAccessSessions.revokedAt))
        .returning({ id: ideAccessSessions.id });

      const stoppedWorkspaces = await transaction
        .update(workspaces)
        .set({
          desiredState: "STOPPED",
          stateVersion: sql`${workspaces.stateVersion} + 1`,
        })
        .where(and(inArray(workspaces.desiredState, ["RUNNING", "SUSPENDED"]), sql`${workspaces.observedState} <> 'DESTROYED'`))
        .returning({ id: workspaces.id });

      if (input.expectedEpoch >= Number.MAX_SAFE_INTEGER) {
        throw new RadError("SECURITY_EPOCH_OVERFLOW", "Security epoch cannot be incremented safely");
      }
      const nextEpoch = input.expectedEpoch + 1;
      const [metadata] = await transaction
        .update(instanceMetadata)
        .set({
          deploymentTier: input.targetTier,
          securityEpoch: nextEpoch,
          securityPostureHash: input.targetPostureHash,
          maintenanceMode: false,
          maintenanceReason: null,
          maintenanceStartedAt: null,
          updatedAt: input.completedAt,
        })
        .where(eq(instanceMetadata.singletonKey, "instance"))
        .returning();
      if (!metadata) {
        throw new RadError("SECURITY_MIGRATION_COMMIT_FAILED", "Security metadata update failed");
      }

      const counts = {
        staleApprovals: staleApprovals.length,
        cancelledOperations: cancelledOperations.length,
        invalidatedLeases: failedReservations.length + expiredCredentials.length,
        invalidatedIdeCodes: invalidatedIdeCodes.length,
        revokedIdeSessions: revokedIdeSessions.length,
        stoppedWorkspaces: stoppedWorkspaces.length,
      };
      await transaction.insert(auditEvents).values([
        {
          id: randomUUID(),
          eventType: "SECURITY_EPOCH_INCREMENTED",
          severity: "HIGH",
          actorId: input.initiatedBy,
          subjectType: "instance",
          subjectId: "instance",
          securityEpoch: nextEpoch,
          deploymentTier: input.targetTier,
          details: { fromEpoch: input.expectedEpoch, toEpoch: nextEpoch },
          occurredAt: input.completedAt,
        },
        {
          id: randomUUID(),
          eventType: "SECURITY_POSTURE_MIGRATION_COMPLETED",
          severity: input.targetTier < input.expectedTier ? "CRITICAL" : "HIGH",
          actorId: input.initiatedBy,
          subjectType: "instance",
          subjectId: "instance",
          securityEpoch: nextEpoch,
          deploymentTier: input.targetTier,
          details: {
            fromTier: input.expectedTier,
            toTier: input.targetTier,
            ...counts,
          },
          occurredAt: input.completedAt,
        },
      ]);

      return { metadata, ...counts };
    });
  }
}

function validateMigrationInput(
  input: SecurityMigrationInput,
  current: InstanceSecurityMetadata,
): void {
  if (!Number.isInteger(input.targetTier) || input.targetTier < 1 || input.targetTier > 3) {
    throw new RadError("SECURITY_TIER_INVALID", "Target tier must be an integer from 1 to 3");
  }
  sha256DigestSchema.parse(input.targetPostureHash);
  if (!z.uuid().safeParse(input.initiatedBy).success) {
    throw new RadError("SECURITY_MIGRATION_ACTOR_INVALID", "Migration actor must be a UUID");
  }
  if (!input.reason.trim() || input.reason.length > 500) {
    throw new RadError("SECURITY_MIGRATION_REASON_INVALID", "A bounded migration reason is required");
  }
  const expectedConfirmation = `MIGRATE EPOCH ${current.securityEpoch} TIER ${current.deploymentTier}->${input.targetTier}`;
  if (input.confirmation !== expectedConfirmation) {
    throw new RadError(
      "SECURITY_MIGRATION_CONFIRMATION_REQUIRED",
      `Confirmation must exactly match: ${expectedConfirmation}`,
    );
  }
  if (
    !input.forceEpochRotation &&
    input.targetTier === current.deploymentTier &&
    input.targetPostureHash === current.securityPostureHash
  ) {
    throw new RadError("SECURITY_MIGRATION_NO_CHANGE", "Target security posture is unchanged");
  }
}

function auditRecord(
  eventType: string,
  input: SecurityMigrationInput,
  metadata: InstanceSecurityMetadata,
  occurredAt: Date,
  severity: "HIGH" | "CRITICAL",
) {
  return {
    id: randomUUID(),
    eventType,
    severity,
    actorId: input.initiatedBy,
    subjectType: "instance",
    subjectId: "instance",
    securityEpoch: metadata.securityEpoch,
    deploymentTier: metadata.deploymentTier,
    details: {
      fromTier: metadata.deploymentTier,
      toTier: input.targetTier,
      forceEpochRotation: Boolean(input.forceEpochRotation),
    },
    occurredAt,
  } as const;
}
