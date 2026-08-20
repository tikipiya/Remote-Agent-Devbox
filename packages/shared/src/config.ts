import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const optionalPositiveInteger = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

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
    RAD_ARTIFACT_ROOT: z.string().min(1).default("/var/lib/rad/artifacts"),
    RAD_ARTIFACT_MAX_BYTES: positiveInteger
      .max(1024 * 1024 * 1024)
      .default(64 * 1024 * 1024),
    RAD_ARTIFACT_VOLUME: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).default("rad-artifacts"),
    RAD_VALIDATOR_IMAGE: z.string().min(1).default("remote-agent-devbox-validator:local"),
    RAD_VALIDATOR_IMAGE_DIGEST: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .optional()
      .or(z.literal("")),
    RAD_VALIDATOR_MEMORY_MB: positiveInteger.min(128).max(4096).default(512),
    RAD_VALIDATOR_CPUS: z.coerce.number().positive().max(4).default(1),
    RAD_VALIDATOR_PIDS: positiveInteger.min(16).max(512).default(64),
    RAD_VALIDATOR_TIMEOUT_MS: positiveInteger.min(1_000).max(600_000).default(120_000),
    RAD_APPROVAL_TTL_SECONDS: positiveInteger.min(60).max(86_400).default(3_600),
    RAD_GITHUB_API_URL: z.url().refine((url) => url.startsWith("https://")).default("https://api.github.com"),
    RAD_GITHUB_APP_ID: z.string().regex(/^\d+$/).optional().or(z.literal("")),
    RAD_GITHUB_INSTALLATION_ID: optionalPositiveInteger,
    RAD_GITHUB_PRIVATE_KEY_BASE64: z.string().min(1).optional().or(z.literal("")),
    RAD_CODEX_API_KEY: z.string().min(1).optional().or(z.literal("")),
    RAD_DISCORD_TOKEN: z.string().min(1).optional().or(z.literal("")),
    RAD_DISCORD_APPLICATION_ID: z.string().min(1).optional().or(z.literal("")),
    RAD_DISCORD_GUILD_ID: z.string().min(1).optional().or(z.literal("")),
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

    const githubValues = [
      Boolean(config.RAD_GITHUB_APP_ID),
      Boolean(config.RAD_GITHUB_INSTALLATION_ID),
      Boolean(config.RAD_GITHUB_PRIVATE_KEY_BASE64),
    ];
    if (githubValues.some(Boolean) && !githubValues.every(Boolean)) {
      context.addIssue({
        code: "custom",
        message: "GitHub App ID, installation ID, and private key must be configured together",
        path: ["RAD_GITHUB_APP_ID"],
      });
    }
  });

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  return runtimeConfigSchema.parse(environment);
}
