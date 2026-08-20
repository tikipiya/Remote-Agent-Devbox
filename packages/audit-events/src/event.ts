import { z } from "zod";

export const auditSeveritySchema = z.enum(["INFO", "WARNING", "HIGH", "CRITICAL"]);
export type AuditSeverity = z.infer<typeof auditSeveritySchema>;

export const auditEventTypeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

const auditDetailValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const forbiddenDetailKey = /(secret|token|password|credential|private[_-]?key)/i;

export const auditDetailsSchema = z
  .record(z.string().min(1).max(100), auditDetailValueSchema)
  .superRefine((details, context) => {
    for (const key of Object.keys(details)) {
      if (forbiddenDetailKey.test(key)) {
        context.addIssue({
          code: "custom",
          message: `Audit detail key ${key} may contain secret material`,
          path: [key],
        });
      }
    }
  });
export type AuditDetails = z.infer<typeof auditDetailsSchema>;

export interface AuditEvent {
  id: string;
  sequence: number;
  eventType: AuditEventType;
  severity: AuditSeverity;
  actorId: string | null;
  subjectType: string;
  subjectId: string | null;
  securityEpoch: number;
  deploymentTier: number;
  details: AuditDetails;
  occurredAt: Date;
}

export interface NewAuditEvent extends Omit<AuditEvent, "sequence"> {}
