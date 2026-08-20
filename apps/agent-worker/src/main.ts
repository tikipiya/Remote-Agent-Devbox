#!/usr/bin/env node
import { Buffer } from "node:buffer";

import { z } from "zod";

import { spawnCodexAppServer } from "@rad/agents";

const inputSchema = z.object({
  task: z.string().min(1).max(64 * 1024),
  cwd: z.string().startsWith("/workspace/").default("/workspace/repository"),
});

const encoded = process.argv[2];
if (!encoded) throw new Error("Expected a base64url-encoded task payload");
const input = inputSchema.parse(
  JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
);
const client = spawnCodexAppServer();

try {
  process.stdout.write(`${JSON.stringify({ event: "task_started" })}\n`);
  await client.initialize();
  const result = await client.runTask(input.task, input.cwd);
  process.stdout.write(`${JSON.stringify({ event: "task_completed", ...result })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown agent error";
  process.stdout.write(`${JSON.stringify({ event: "task_failed", message })}\n`);
  process.exitCode = 1;
} finally {
  await client.close();
}

