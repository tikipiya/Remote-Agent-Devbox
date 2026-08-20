import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

export const runtimeConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    RAD_HOST: z.string().min(1).default("127.0.0.1"),
    RAD_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    RAD_DATABASE_URL: z.url().refine(
      (url) => url.startsWith("postgresql://") || url.startsWith("postgres://"),
      "RAD_DATABASE_URL must be a PostgreSQL URL",
    ),
    RAD_DEPLOYMENT_TIER: z.coerce.number().int().min(1).max(1).default(1),
    RAD_SANDBOX_BACKEND: z.literal("docker").default("docker"),
    RAD_WORKSPACE_IMAGE: z.string().min(1),
    RAD_WORKSPACE_NETWORK: z.string().min(1).default("rad-workspace"),
    RAD_CONTROL_NETWORK: z.string().min(1).default("rad-control"),
    RAD_WORKSPACE_MEMORY_MB: positiveInteger.min(256).default(2048),
    RAD_WORKSPACE_CPUS: z.coerce.number().positive().max(32).default(2),
    RAD_WORKSPACE_PIDS: positiveInteger.min(32).default(256),
    RAD_WORKSPACE_TTL_SECONDS: positiveInteger.min(60).default(14_400),
    RAD_RECONCILE_INTERVAL_MS: positiveInteger.min(250).default(5_000),
    RAD_WORKSPACE_ROOT: z.string().min(1).default("/workspaces"),
    RAD_DISCORD_TOKEN: z.string().min(1).optional().or(z.literal("")),
    RAD_DISCORD_APPLICATION_ID: z.string().min(1).optional().or(z.literal("")),
  })
  .superRefine((config, context) => {
    if (config.RAD_WORKSPACE_NETWORK === config.RAD_CONTROL_NETWORK) {
      context.addIssue({
        code: "custom",
        message: "workspace and control networks must be different",
        path: ["RAD_WORKSPACE_NETWORK"],
      });
    }

    const hasDiscordToken = Boolean(config.RAD_DISCORD_TOKEN);
    const hasDiscordApplication = Boolean(config.RAD_DISCORD_APPLICATION_ID);
    if (hasDiscordToken !== hasDiscordApplication) {
      context.addIssue({
        code: "custom",
        message: "Discord token and application ID must be configured together",
        path: ["RAD_DISCORD_TOKEN"],
      });
    }
  });

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  return runtimeConfigSchema.parse(environment);
}

