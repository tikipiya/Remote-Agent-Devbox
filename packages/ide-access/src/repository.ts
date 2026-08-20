import { and, eq, gt, isNull } from "drizzle-orm";
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
import { sql } from "drizzle-orm";

import { RadError } from "@rad/shared";
import { instanceMetadata, workspaces } from "@rad/workspace-state";

import { ideTokenDigestSchema } from "./access.js";

export const ideAccessCodes = pgTable(
  "ide_access_codes",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    codeDigest: text("code_digest").notNull().unique(),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull(),
    workspaceStateVersion: bigint("workspace_state_version", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  },
  (table) => [
    index("ide_access_codes_workspace_idx").on(table.workspaceId, table.expiresAt),
    check("ide_access_codes_epoch_check", sql`${table.securityEpoch} > 0`),
    check("ide_access_codes_state_version_check", sql`${table.workspaceStateVersion} >= 0`),
    check("ide_access_codes_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "ide_access_codes_terminal_check",
      sql`NOT (${table.consumedAt} IS NOT NULL AND ${table.invalidatedAt} IS NOT NULL)`,
    ),
  ],
);

export const ideAccessSessions = pgTable(
  "ide_access_sessions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionDigest: text("session_digest").notNull().unique(),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull(),
    workspaceStateVersion: bigint("workspace_state_version", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("ide_access_sessions_workspace_idx").on(table.workspaceId, table.expiresAt),
    check("ide_access_sessions_epoch_check", sql`${table.securityEpoch} > 0`),
    check("ide_access_sessions_state_version_check", sql`${table.workspaceStateVersion} >= 0`),
    check("ide_access_sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export interface IdeAccessCodeRecord {
  id: string;
  workspaceId: string;
  codeDigest: string;
  securityEpoch: number;
  workspaceStateVersion: number;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
}

export interface IdeAccessSessionRecord {
  id: string;
  workspaceId: string;
  sessionDigest: string;
  securityEpoch: number;
  workspaceStateVersion: number;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface IssueIdeAccessCodeInput {
  id: string;
  workspaceId: string;
  codeDigest: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface RedeemIdeAccessCodeInput {
  codeDigest: string;
  sessionId: string;
  sessionDigest: string;
  sessionTtlSeconds: number;
  redeemedAt: Date;
}

export interface IdeAccessRepository {
  issueCode(input: IssueIdeAccessCodeInput): Promise<IdeAccessCodeRecord>;
  redeemCode(input: RedeemIdeAccessCodeInput): Promise<IdeAccessSessionRecord>;
  resolveSession(sessionDigest: string, now: Date): Promise<IdeAccessSessionRecord>;
}

export class PostgresIdeAccessRepository implements IdeAccessRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async issueCode(input: IssueIdeAccessCodeInput): Promise<IdeAccessCodeRecord> {
    ideTokenDigestSchema.parse(input.codeDigest);
    return this.db.transaction(async (transaction) => {
      const [metadata] = await transaction
        .select()
        .from(instanceMetadata)
        .where(eq(instanceMetadata.singletonKey, "instance"))
        .for("share");
      const [workspace] = await transaction
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId))
        .for("update");
      const context = requireIssuableContext(metadata, workspace, input.createdAt);

      await transaction
        .update(ideAccessCodes)
        .set({ invalidatedAt: input.createdAt })
        .where(
          and(
            eq(ideAccessCodes.workspaceId, input.workspaceId),
            isNull(ideAccessCodes.consumedAt),
            isNull(ideAccessCodes.invalidatedAt),
          ),
        );

      const [record] = await transaction
        .insert(ideAccessCodes)
        .values({
          ...input,
          securityEpoch: context.metadata.securityEpoch,
          workspaceStateVersion: context.workspace.stateVersion,
        })
        .returning();
      if (!record) {
        throw new RadError("IDE_ACCESS_ISSUE_FAILED", "Database did not create an IDE access code");
      }
      return record;
    });
  }

  public async redeemCode(input: RedeemIdeAccessCodeInput): Promise<IdeAccessSessionRecord> {
    ideTokenDigestSchema.parse(input.codeDigest);
    ideTokenDigestSchema.parse(input.sessionDigest);
    return this.db.transaction(async (transaction) => {
      const [code] = await transaction
        .select()
        .from(ideAccessCodes)
        .where(eq(ideAccessCodes.codeDigest, input.codeDigest))
        .for("update");
      if (!code) invalidCode();

      const [metadata] = await transaction
        .select()
        .from(instanceMetadata)
        .where(eq(instanceMetadata.singletonKey, "instance"))
        .for("share");
      const [workspace] = await transaction
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, code.workspaceId))
        .for("update");
      assertRedeemableContext(code, metadata, workspace, input.redeemedAt);

      const expiresAt = new Date(
        Math.min(
          input.redeemedAt.getTime() + input.sessionTtlSeconds * 1_000,
          workspace.expiresAt.getTime(),
        ),
      );
      if (expiresAt <= input.redeemedAt) invalidCode();

      const [consumed] = await transaction
        .update(ideAccessCodes)
        .set({ consumedAt: input.redeemedAt })
        .where(
          and(
            eq(ideAccessCodes.id, code.id),
            isNull(ideAccessCodes.consumedAt),
            isNull(ideAccessCodes.invalidatedAt),
          ),
        )
        .returning({ id: ideAccessCodes.id });
      if (!consumed) invalidCode();

      await transaction
        .update(ideAccessSessions)
        .set({ revokedAt: input.redeemedAt })
        .where(
          and(
            eq(ideAccessSessions.workspaceId, code.workspaceId),
            isNull(ideAccessSessions.revokedAt),
          ),
        );

      const [session] = await transaction
        .insert(ideAccessSessions)
        .values({
          id: input.sessionId,
          workspaceId: code.workspaceId,
          sessionDigest: input.sessionDigest,
          securityEpoch: code.securityEpoch,
          workspaceStateVersion: code.workspaceStateVersion,
          createdAt: input.redeemedAt,
          expiresAt,
        })
        .returning();
      if (!session) {
        throw new RadError("IDE_SESSION_CREATE_FAILED", "Database did not create an IDE session");
      }
      return session;
    });
  }

  public async resolveSession(
    sessionDigest: string,
    now: Date,
  ): Promise<IdeAccessSessionRecord> {
    ideTokenDigestSchema.parse(sessionDigest);
    const [session] = await this.db
      .select()
      .from(ideAccessSessions)
      .where(eq(ideAccessSessions.sessionDigest, sessionDigest))
      .limit(1);
    if (!session) invalidSession();

    const [metadata] = await this.db
      .select()
      .from(instanceMetadata)
      .where(eq(instanceMetadata.singletonKey, "instance"))
      .limit(1);
    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .limit(1);
    if (
      session.revokedAt ||
      session.expiresAt <= now ||
      !metadata ||
      metadata.maintenanceMode ||
      metadata.securityEpoch !== session.securityEpoch ||
      !workspace ||
      workspace.desiredState !== "RUNNING" ||
      workspace.observedState !== "READY" ||
      workspace.stateVersion !== session.workspaceStateVersion ||
      workspace.expiresAt <= now
    ) {
      invalidSession();
    }
    return session;
  }
}

function requireIssuableContext(
  metadata: typeof instanceMetadata.$inferSelect | undefined,
  workspace: typeof workspaces.$inferSelect | undefined,
  now: Date,
): {
  metadata: typeof instanceMetadata.$inferSelect;
  workspace: typeof workspaces.$inferSelect;
} {
  if (!metadata) {
    throw new RadError("SECURITY_CONTEXT_MISSING", "Instance security metadata is missing");
  }
  if (metadata.maintenanceMode) {
    throw new RadError("MAINTENANCE_MODE_ACTIVE", "IDE access is unavailable during maintenance");
  }
  if (!workspace) {
    throw new RadError("WORKSPACE_NOT_FOUND", "Workspace does not exist");
  }
  if (
    workspace.desiredState !== "RUNNING" ||
    workspace.observedState !== "READY" ||
    workspace.expiresAt <= now
  ) {
    throw new RadError("WORKSPACE_NOT_READY", "Workspace is not ready for IDE access");
  }
  return { metadata, workspace };
}

function assertRedeemableContext(
  code: typeof ideAccessCodes.$inferSelect,
  metadata: typeof instanceMetadata.$inferSelect | undefined,
  workspace: typeof workspaces.$inferSelect | undefined,
  now: Date,
): asserts workspace is typeof workspaces.$inferSelect {
  if (
    code.consumedAt ||
    code.invalidatedAt ||
    code.expiresAt <= now ||
    !metadata ||
    metadata.maintenanceMode ||
    metadata.securityEpoch !== code.securityEpoch ||
    !workspace ||
    workspace.desiredState !== "RUNNING" ||
    workspace.observedState !== "READY" ||
    workspace.stateVersion !== code.workspaceStateVersion ||
    workspace.expiresAt <= now
  ) {
    invalidCode();
  }
}

function invalidCode(): never {
  throw new RadError("IDE_ACCESS_CODE_INVALID", "IDE access code is invalid or expired");
}

function invalidSession(): never {
  throw new RadError("IDE_SESSION_INVALID", "IDE session is invalid or expired");
}
