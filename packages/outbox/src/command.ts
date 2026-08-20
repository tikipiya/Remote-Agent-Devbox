import { z } from "zod";

export const outboxCommandTypeSchema = z.enum([
  "PROVISION",
  "START",
  "SUSPEND",
  "STOP",
  "DESTROY",
]);
export type OutboxCommandType = z.infer<typeof outboxCommandTypeSchema>;

export const outboxCommandStateSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
]);
export type OutboxCommandState = z.infer<typeof outboxCommandStateSchema>;

export const outboxPayloadSchema = z
  .object({ desiredState: z.enum(["RUNNING", "SUSPENDED", "STOPPED", "DESTROYED"]) })
  .strict();
export type OutboxPayload = z.infer<typeof outboxPayloadSchema>;

export interface OutboxCommand {
  id: string;
  aggregateType: "workspace";
  aggregateId: string;
  commandType: OutboxCommandType;
  payload: OutboxPayload;
  state: OutboxCommandState;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  availableAt: Date;
  processedAt: Date | null;
}
