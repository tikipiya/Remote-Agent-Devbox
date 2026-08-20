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

  it("connects a remote exec environment and scopes the task to it", async () => {
    const fromServer = new PassThrough();
    const toServer = new PassThrough();
    const sent: Array<{ id?: number; method?: string; params?: unknown }> = [];
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
    await respond(fromServer, 1, { userAgent: "test" });
    await initialized;

    const environment = {
      environmentId: "workspace-1",
      execServerUrl: "ws://127.0.0.1:4500",
    };
    const connected = client.connectEnvironment(environment);
    await respond(fromServer, 2, {});
    await respond(fromServer, 3, { status: "ready" });
    await connected;

    const resultPromise = client.runTask(
      "fix the test",
      "/workspace/repository",
      environment,
    );
    await respond(fromServer, 4, { thread: { id: "thread-1" } });
    await respond(fromServer, 5, { turn: { id: "turn-1" } });
    fromServer.write(
      `${JSON.stringify({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } } })}\n`,
    );
    await resultPromise;

    expect(sent.find((message) => message.method === "environment/add")?.params)
      .toEqual({
        environmentId: "workspace-1",
        execServerUrl: "ws://127.0.0.1:4500",
        connectTimeoutMs: 1_000,
      });
    const expectedEnvironment = [{
      environmentId: "workspace-1",
      cwd: "/workspace/repository",
      runtimeWorkspaceRoots: ["/workspace/repository"],
    }];
    expect(sent.find((message) => message.method === "thread/start")?.params)
      .toMatchObject({ environments: expectedEnvironment });
    expect(sent.find((message) => message.method === "turn/start")?.params)
      .toMatchObject({ environments: expectedEnvironment });
  });

  it("fails closed when a remote exec environment is not ready", async () => {
    const fromServer = new PassThrough();
    const toServer = new PassThrough();
    const client = new CodexAppServerClient({
      input: fromServer,
      output: toServer,
      requestTimeoutMs: 1_000,
    });
    const connected = client.connectEnvironment({
      environmentId: "workspace-1",
      execServerUrl: "ws://127.0.0.1:4500",
    });
    await respond(fromServer, 1, {});
    await respond(fromServer, 2, {
      status: "disconnected",
      error: "connection refused",
    });

    await expect(connected).rejects.toThrow(/connection refused/);
  });
});

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function respond(
  stream: PassThrough,
  id: number,
  result: unknown,
): Promise<void> {
  await tick();
  stream.write(`${JSON.stringify({ id, result })}\n`);
}
