import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  RadError,
  type DesiredWorkspaceState,
  type Workspace,
} from "@rad/shared";
import { workspaces } from "@rad/workspace-state";

import {
  outboxCommandStateSchema,
  outboxCommandTypeSchema,
  outboxPayloadSchema,
  type OutboxCommand,
  type OutboxPayload,
} from "./command.js";

export const outboxCommands = pgTable(
  "outbox_commands",
  {
    id: uuid("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    commandType: text("command_type").notNull(),
    payload: jsonb("payload").$type<OutboxPayload>().notNull(),
    state: text("state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("outbox_commands_dispatch_idx").on(table.state, table.availableAt, table.createdAt),
    check("outbox_commands_aggregate_check", sql`${table.aggregateType} = 'workspace'`),
    check("outbox_commands_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "outbox_commands_state_check",
      sql`${table.state} IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')`,
    ),
  ],
);

export interface WorkspaceCommandResult {
  command: OutboxCommand;
  workspace: Workspace;
}

export interface OutboxRepository {
  requestWorkspaceState(
    workspaceId: string,
    desiredState: DesiredWorkspaceState,
    requestedAt: Date,
  ): Promise<WorkspaceCommandResult>;
  claimNext(now: Date): Promise<OutboxCommand | undefined>;
  markSucceeded(id: string, processedAt: Date): Promise<void>;
  markFailed(
    id: string,
    error: string,
    retryAt: Date | null,
    processedAt: Date,
  ): Promise<void>;
  recoverStale(staleBefore: Date, availableAt: Date): Promise<number>;
}

export class PostgresOutboxRepository implements OutboxRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async requestWorkspaceState(
    workspaceId: string,
    desiredState: DesiredWorkspaceState,
    requestedAt: Date,
  ): Promise<WorkspaceCommandResult> {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .for("update");
      if (!current) {
        throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${workspaceId} not found`);
      }
      const [workspace] = await transaction
        .update(workspaces)
        .set({
          desiredState,
          stateVersion: current.stateVersion + 1,
        })
        .where(eq(workspaces.id, workspaceId))
        .returning();
      const [command] = await transaction
        .insert(outboxCommands)
        .values({
          id: randomUUID(),
          aggregateType: "workspace",
          aggregateId: workspaceId,
          commandType: commandForState(current.observedState, desiredState),
          payload: outboxPayloadSchema.parse({ desiredState }),
          state: "PENDING",
          attempts: 0,
          createdAt: requestedAt,
          availableAt: requestedAt,
        })
        .returning();
      if (!workspace || !command) {
        throw new RadError("OUTBOX_ENQUEUE_FAILED", "Workspace intent was not persisted");
      }
      return { workspace: asWorkspace(workspace), command: asCommand(command) };
    });
  }

  public async claimNext(now: Date): Promise<OutboxCommand | undefined> {
    return this.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select({ id: outboxCommands.id })
        .from(outboxCommands)
        .where(and(eq(outboxCommands.state, "PENDING"), lte(outboxCommands.availableAt, now)))
        .orderBy(asc(outboxCommands.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return undefined;
      const [claimed] = await transaction
        .update(outboxCommands)
        .set({ state: "PROCESSING", attempts: sql`${outboxCommands.attempts} + 1` })
        .where(and(eq(outboxCommands.id, candidate.id), eq(outboxCommands.state, "PENDING")))
        .returning();
      return claimed ? asCommand(claimed) : undefined;
    });
  }

  public async markSucceeded(id: string, processedAt: Date): Promise<void> {
    const [updated] = await this.db
      .update(outboxCommands)
      .set({ state: "SUCCEEDED", processedAt, lastError: null })
      .where(and(eq(outboxCommands.id, id), eq(outboxCommands.state, "PROCESSING")))
      .returning({ id: outboxCommands.id });
    if (!updated) throw new RadError("OUTBOX_STATE_CONFLICT", `Command ${id} is not processing`);
  }

  public async markFailed(
    id: string,
    error: string,
    retryAt: Date | null,
    processedAt: Date,
  ): Promise<void> {
    const [updated] = await this.db
      .update(outboxCommands)
      .set({
        state: retryAt ? "PENDING" : "FAILED",
        availableAt: retryAt ?? processedAt,
        processedAt: retryAt ? null : processedAt,
        lastError: error.slice(0, 2_000),
      })
      .where(and(eq(outboxCommands.id, id), eq(outboxCommands.state, "PROCESSING")))
      .returning({ id: outboxCommands.id });
    if (!updated) throw new RadError("OUTBOX_STATE_CONFLICT", `Command ${id} is not processing`);
  }

  public async recoverStale(staleBefore: Date, availableAt: Date): Promise<number> {
    const recovered = await this.db
      .update(outboxCommands)
      .set({ state: "PENDING", availableAt, lastError: "Recovered stale processing claim" })
      .where(
        and(
          eq(outboxCommands.state, "PROCESSING"),
          inArray(outboxCommands.commandType, outboxCommandTypeSchema.options),
          lte(outboxCommands.availableAt, staleBefore),
        ),
      )
      .returning({ id: outboxCommands.id });
    return recovered.length;
  }
}

function commandForState(
  observedState: string,
  desiredState: DesiredWorkspaceState,
): "PROVISION" | "START" | "SUSPEND" | "STOP" | "DESTROY" {
  if (desiredState === "RUNNING") return observedState === "MISSING" ? "PROVISION" : "START";
  if (desiredState === "SUSPENDED") return "SUSPEND";
  if (desiredState === "STOPPED") return "STOP";
  return "DESTROY";
}

function asCommand(record: typeof outboxCommands.$inferSelect): OutboxCommand {
  return {
    ...record,
    aggregateType: "workspace",
    commandType: outboxCommandTypeSchema.parse(record.commandType),
    payload: outboxPayloadSchema.parse(record.payload),
    state: outboxCommandStateSchema.parse(record.state),
  };
}

function asWorkspace(record: typeof workspaces.$inferSelect): Workspace {
  return {
    ...record,
    desiredState: record.desiredState as DesiredWorkspaceState,
    observedState: record.observedState as Workspace["observedState"],
    sandboxBackend: "docker",
  };
}
