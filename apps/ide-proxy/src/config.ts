import { z } from "zod";

export const ideProxyConfigSchema = z.object({
  RAD_IDE_PROXY_HOST: z.string().min(1).default("0.0.0.0"),
  RAD_IDE_PROXY_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  RAD_IDE_PROXY_PUBLIC_URL: z
    .url()
    .refine(isHttpOrigin, "IDE proxy public URL must be an HTTP(S) origin")
    .default("http://127.0.0.1:3001"),
  RAD_CONTROL_INTERNAL_URL: z
    .url()
    .refine(isHttpOrigin, "Control internal URL must be an HTTP(S) origin")
    .default("http://control:3000"),
  RAD_IDE_PROXY_SHARED_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
});

export type IdeProxyConfig = z.infer<typeof ideProxyConfigSchema>;

export function loadIdeProxyConfig(
  environment: NodeJS.ProcessEnv = process.env,
): IdeProxyConfig {
  return ideProxyConfigSchema.parse(environment);
}

function isHttpOrigin(value: string): boolean {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
}
