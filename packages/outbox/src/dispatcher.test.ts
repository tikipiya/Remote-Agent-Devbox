import { describe, expect, it } from "vitest";

import type { OutboxCommand } from "./command.js";
import { OutboxDispatcher } from "./dispatcher.js";
import type { OutboxRepository } from "./repository.js";

const now = new Date("2026-01-01T00:00:00Z");

describe("OutboxDispatcher", () => {
  it("acknowledges successful idempotent delivery", async () => {
    const repository = memoryRepository(command(1));
    const handled: string[] = [];
    const dispatcher = new OutboxDispatcher(repository, {
      handle: async (item) => { handled.push(item.id); },
    }, 5, () => now);
    expect(await dispatcher.dispatchAvailable()).toBe(1);
    expect(handled).toEqual(["10000000-0000-4000-8000-000000000001"]);
    expect(repository.succeeded).toBe(true);
  });

  it("retries boundedly and marks the final attempt terminal", async () => {
    const retrying = memoryRepository(command(2));
    await new OutboxDispatcher(retrying, { handle: async () => { throw new Error("offline"); } }, 5, () => now)
      .dispatchAvailable();
    expect(retrying.retryAt).toBeInstanceOf(Date);

    const terminal = memoryRepository(command(5));
    await new OutboxDispatcher(terminal, { handle: async () => { throw new Error("offline"); } }, 5, () => now)
      .dispatchAvailable();
    expect(terminal.retryAt).toBeNull();
  });
});

function command(attempts: number): OutboxCommand {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    aggregateType: "workspace",
    aggregateId: "20000000-0000-4000-8000-000000000001",
    commandType: "STOP",
    payload: { desiredState: "STOPPED" },
    state: "PROCESSING",
    attempts,
    lastError: null,
    createdAt: now,
    availableAt: now,
    processedAt: null,
  };
}

function memoryRepository(item: OutboxCommand) {
  type MemoryRepository = OutboxRepository & {
    item: OutboxCommand | undefined;
    succeeded: boolean;
    retryAt: Date | null | undefined;
  };
  const repository: MemoryRepository = {
    item: item as OutboxCommand | undefined,
    succeeded: false,
    retryAt: undefined as Date | null | undefined,
    requestWorkspaceState: async () => { throw new Error("not used"); },
    claimNext: async (): Promise<OutboxCommand | undefined> => {
      const next: OutboxCommand | undefined = repository.item;
      repository.item = undefined;
      return next;
    },
    markSucceeded: async () => { repository.succeeded = true; },
    markFailed: async (_id: string, _error: string, retryAt: Date | null) => {
      repository.retryAt = retryAt;
    },
    recoverStale: async () => 0,
  };
  return repository;
}
