import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { CodexAppServerClient } from "./app-server-client.js";

describe("CodexAppServerClient", () => {
  it("uses fail-closed thread settings and returns the agent message", async () => {
    const fromServer = new PassThrough();
    const toServer = new PassThrough();
    const sent: unknown[] = [];
    toServer.setEncoding("utf8");
    toServer.on("data", (chunk: string) => {
      for (const line of chunk.trim().split("\n")) sent.push(JSON.parse(line));
    });
    const client = new CodexAppServerClient({
      input: fromServer,
      output: toServer,
      requestTimeoutMs: 1_000,
      turnTimeoutMs: 1_000,
    });

    const initialized = client.initialize();
    await tick();
    fromServer.write(`${JSON.stringify({ id: 1, result: { userAgent: "test" } })}\n`);
    await initialized;

    const resultPromise = client.runTask("fix the test", "/workspace/repository");
    await tick();
    fromServer.write(
      `${JSON.stringify({ id: 2, result: { thread: { id: "thread-1" } } })}\n`,
    );
    await tick();
    fromServer.write(
      `${JSON.stringify({ id: 3, result: { turn: { id: "turn-1" } } })}\n`,
    );
    fromServer.write(
      `${JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", delta: "done" } })}\n`,
    );
    fromServer.write(
      `${JSON.stringify({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } } })}\n`,
    );

    await expect(resultPromise).resolves.toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
      message: "done",
    });
    const threadStart = sent.find(
      (message) => (message as { method?: string }).method === "thread/start",
    ) as { params: Record<string, unknown> };
    expect(threadStart.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "workspace-write",
      environments: [],
    });
  });

  it("denies unexpected server requests", async () => {
    const fromServer = new PassThrough();
    const toServer = new PassThrough();
    let response = "";
    toServer.setEncoding("utf8");
    toServer.on("data", (chunk: string) => (response += chunk));
    new CodexAppServerClient({ input: fromServer, output: toServer });

    fromServer.write(
      `${JSON.stringify({ id: 99, method: "item/commandExecution/requestApproval", params: {} })}\n`,
    );
    await tick();

    expect(JSON.parse(response)).toMatchObject({
      id: 99,
      error: { code: -32_601 },
    });
  });
});

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

