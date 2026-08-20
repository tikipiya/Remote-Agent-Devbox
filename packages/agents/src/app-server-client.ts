import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { RadError } from "@rad/shared";

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface RpcNotification {
  method: string;
  params?: unknown;
  id?: number;
}

interface ThreadStartResult {
  thread: { id: string };
}

interface TurnStartResult {
  turn: { id: string };
}

interface EnvironmentStatusResult {
  status: "ready" | "pending" | "disconnected" | "unknown";
  error?: string;
}

interface TurnCompletedParams {
  threadId: string;
  turn: {
    id: string;
    status: "completed" | "interrupted" | "failed" | "inProgress";
    error: { message?: string } | null;
  };
}

interface AgentMessageDeltaParams {
  threadId: string;
  turnId: string;
  delta: string;
}

export interface CodexTaskResult {
  threadId: string;
  turnId: string;
  message: string;
}

export interface CodexExecutionEnvironment {
  environmentId: string;
  execServerUrl: string;
}

export interface CodexAppServerOptions {
  input: Readable;
  output: Writable;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  close?: () => Promise<void> | void;
}

export class CodexAppServerClient {
  private readonly events = new EventEmitter();
  private readonly pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private readonly completedTurns = new Map<string, TurnCompletedParams>();
  private readonly requestTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private nextId = 1;

  public constructor(private readonly options: CodexAppServerOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 60 * 60 * 1000;
    const lines = createInterface({ input: options.input, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));
    lines.on("close", () => this.failPending("Codex App Server closed"));
    options.input.on("error", (error) => this.failPending(error.message));
  }

  public async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "remote-agent-devbox",
        title: "Remote Agent Devbox",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    this.notify("initialized");
  }

  public async connectEnvironment(
    environment: CodexExecutionEnvironment,
  ): Promise<void> {
    await this.request("environment/add", {
      environmentId: environment.environmentId,
      execServerUrl: environment.execServerUrl,
      connectTimeoutMs: this.requestTimeoutMs,
    });
    const deadline = Date.now() + this.requestTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.request<EnvironmentStatusResult>(
        "environment/status",
        { environmentId: environment.environmentId },
      );
      if (status.status === "ready") return;
      if (status.status !== "pending") {
        throw new RadError(
          "CODEX_ENVIRONMENT_NOT_READY",
          status.error ??
            `Codex environment ${environment.environmentId} is ${status.status}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new RadError(
      "CODEX_ENVIRONMENT_NOT_READY",
      `Codex environment ${environment.environmentId} did not become ready`,
    );
  }

  public async runTask(
    task: string,
    cwd: string,
    environment?: CodexExecutionEnvironment,
  ): Promise<CodexTaskResult> {
    const environments = environment
      ? [
          {
            environmentId: environment.environmentId,
            cwd,
            runtimeWorkspaceRoots: [cwd],
          },
        ]
      : [];
    const threadResult = await this.request<ThreadStartResult>("thread/start", {
      cwd,
      runtimeWorkspaceRoots: [cwd],
      approvalPolicy: "never",
      sandbox: "workspace-write",
      ephemeral: true,
      environments,
    });
    const threadId = threadResult.thread.id;
    let message = "";
    const onDelta = (params: AgentMessageDeltaParams): void => {
      if (params.threadId === threadId) message += params.delta;
    };
    this.events.on("item/agentMessage/delta", onDelta);

    try {
      const turnResult = await this.request<TurnStartResult>("turn/start", {
        threadId,
        input: [{ type: "text", text: task, text_elements: [] }],
        cwd,
        runtimeWorkspaceRoots: [cwd],
        approvalPolicy: "never",
        environments,
      });
      const completion = await this.waitForTurn(turnResult.turn.id);
      if (completion.turn.status !== "completed") {
        throw new RadError(
          "CODEX_TURN_FAILED",
          completion.turn.error?.message ?? `Codex turn ${completion.turn.status}`,
        );
      }
      return { threadId, turnId: turnResult.turn.id, message };
    } finally {
      this.events.off("item/agentMessage/delta", onDelta);
    }
  }

  public async close(): Promise<void> {
    await this.options.close?.();
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RadError("CODEX_REQUEST_TIMEOUT", `${method} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.write({ method, id, params });
    return promise as Promise<T>;
  }

  private notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  private handleLine(line: string): void {
    if (line.trim() === "") return;
    let message: RpcResponse | RpcNotification;
    try {
      message = JSON.parse(line) as RpcResponse | RpcNotification;
    } catch (error) {
      this.failPending(`Invalid JSON from Codex App Server: ${String(error)}`);
      return;
    }

    if ("method" in message && typeof message.id === "number") {
      this.write({
        id: message.id,
        error: { code: -32_601, message: "Server requests are disabled" },
      });
      return;
    }
    if ("method" in message) {
      if (message.method === "turn/completed") {
        const completion = message.params as TurnCompletedParams;
        this.completedTurns.set(completion.turn.id, completion);
      }
      this.events.emit(message.method, message.params);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new RadError(
          "CODEX_REQUEST_FAILED",
          message.error.message ?? "Codex request failed",
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private waitForTurn(turnId: string): Promise<TurnCompletedParams> {
    const completed = this.completedTurns.get(turnId);
    if (completed) return Promise.resolve(completed);
    return new Promise((resolve, reject) => {
      const onComplete = (params: TurnCompletedParams): void => {
        if (params.turn.id !== turnId) return;
        clearTimeout(timer);
        this.events.off("turn/completed", onComplete);
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.events.off("turn/completed", onComplete);
        reject(new RadError("CODEX_TURN_TIMEOUT", `Turn ${turnId} timed out`));
      }, this.turnTimeoutMs);
      this.events.on("turn/completed", onComplete);
    });
  }

  private write(message: unknown): void {
    this.options.output.write(`${JSON.stringify(message)}\n`);
  }

  private failPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new RadError("CODEX_APP_SERVER_CLOSED", message));
    }
    this.pending.clear();
  }
}
