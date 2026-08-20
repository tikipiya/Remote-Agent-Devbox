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

export const gitRefNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (value) =>
      !value.includes("..") &&
      !value.includes("//") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.endsWith(".lock"),
    { message: "Invalid Git reference name" },
  );

export const repositorySchema = z.object({
  id: z.uuid(),
  remoteUrl: z.url().refine((url) => url.startsWith("https://"), {
    message: "remoteUrl must use HTTPS",
  }),
  defaultBranch: gitRefNameSchema,
  createdAt: z.date(),
});

export type Repository = z.infer<typeof repositorySchema>;

export const workspaceSchema = z.object({
  id: z.uuid(),
  ownerUserId: z.uuid(),
  repositoryId: z.uuid(),
  desiredState: desiredWorkspaceStateSchema,
  observedState: observedWorkspaceStateSchema,
  stateVersion: z.number().int().nonnegative(),
  sandboxBackend: z.literal("docker"),
  branchName: gitRefNameSchema.regex(/^agent\/[A-Za-z0-9._-]+$/),
  createdAt: z.date(),
  expiresAt: z.date(),
  lastError: z.string().nullable(),
});

export type Workspace = z.infer<typeof workspaceSchema>;
