import { z } from "zod";

export const desiredWorkspaceStateSchema = z.enum([
  "RUNNING",
  "SUSPENDED",
  "STOPPED",
  "DESTROYED",
]);

export type DesiredWorkspaceState = z.infer<
  typeof desiredWorkspaceStateSchema
>;

export const observedWorkspaceStateSchema = z.enum([
  "MISSING",
  "PROVISIONING",
  "STARTING",
  "READY",
  "BUSY",
  "SUSPENDING",
  "SUSPENDED",
  "STOPPING",
  "STOPPED",
  "DESTROYING",
  "DESTROYED",
  "FAILED",
]);

export type ObservedWorkspaceState = z.infer<
  typeof observedWorkspaceStateSchema
>;

export const workspaceSchema = z.object({
  id: z.uuid(),
  ownerUserId: z.uuid(),
  repositoryId: z.uuid(),
  repositoryUrl: z.url().refine((url) => url.startsWith("https://"), {
    message: "repositoryUrl must use HTTPS",
  }),
  desiredState: desiredWorkspaceStateSchema,
  observedState: observedWorkspaceStateSchema,
  stateVersion: z.number().int().nonnegative(),
  sandboxBackend: z.literal("docker"),
  branchName: z
    .string()
    .min(1)
    .max(255)
    .regex(/^agent\/[A-Za-z0-9._-]+$/),
  createdAt: z.date(),
  expiresAt: z.date(),
  lastError: z.string().nullable(),
});

export type Workspace = z.infer<typeof workspaceSchema>;

