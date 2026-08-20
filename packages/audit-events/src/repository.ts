import { desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  auditDetailsSchema,
  auditEventTypeSchema,
  auditSeveritySchema,
  type AuditDetails,
  type AuditEvent,
  type NewAuditEvent,
} from "./event.js";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    sequence: bigserial("sequence", { mode: "number" }).notNull().unique(),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull(),
    actorId: uuid("actor_id"),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull(),
    deploymentTier: bigint("deployment_tier", { mode: "number" }).notNull(),
    details: jsonb("details").$type<AuditDetails>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("audit_events_occurred_idx").on(table.occurredAt),
    index("audit_events_type_idx").on(table.eventType, table.occurredAt),
    check("audit_events_epoch_check", sql`${table.securityEpoch} > 0`),
    check("audit_events_tier_check", sql`${table.deploymentTier} BETWEEN 1 AND 3`),
    check(
      "audit_events_severity_check",
      sql`${table.severity} IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')`,
    ),
  ],
);

export interface AuditEventRepository {
  append(input: NewAuditEvent): Promise<AuditEvent>;
  listRecent(limit: number): Promise<AuditEvent[]>;
}

export class PostgresAuditEventRepository implements AuditEventRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async append(input: NewAuditEvent): Promise<AuditEvent> {
    const [record] = await this.db
      .insert(auditEvents)
      .values({
        ...input,
        eventType: auditEventTypeSchema.parse(input.eventType),
        severity: auditSeveritySchema.parse(input.severity),
        details: auditDetailsSchema.parse(input.details),
      })
      .returning();
    if (!record) throw new Error("Database did not return the appended audit event");
    return asAuditEvent(record);
  }

  public async listRecent(limit: number): Promise<AuditEvent[]> {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const records = await this.db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.sequence))
      .limit(boundedLimit);
    return records.map(asAuditEvent);
  }
}

function asAuditEvent(record: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    ...record,
    eventType: auditEventTypeSchema.parse(record.eventType),
    severity: auditSeveritySchema.parse(record.severity),
    details: auditDetailsSchema.parse(record.details),
  };
}
