import { z } from "zod";

export const taskStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const agentTaskSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  requestedBy: z.string().min(1).max(255),
  prompt: z.string().min(1).max(64 * 1024),
  status: taskStatusSchema,
  result: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});

export type AgentTask = z.infer<typeof agentTaskSchema>;

