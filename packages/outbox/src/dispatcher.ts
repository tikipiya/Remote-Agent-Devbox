import type { OutboxCommand } from "./command.js";
import type { OutboxRepository } from "./repository.js";

export interface OutboxCommandHandler {
  handle(command: OutboxCommand): Promise<void>;
}

export class OutboxDispatcher {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly handler: OutboxCommandHandler,
    private readonly maximumAttempts = 5,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async dispatchAvailable(limit = 25): Promise<number> {
    let processed = 0;
    for (; processed < limit; processed += 1) {
      const command = await this.repository.claimNext(this.now());
      if (!command) break;
      try {
        await this.handler.handle(command);
        await this.repository.markSucceeded(command.id, this.now());
      } catch (error) {
        const terminal = command.attempts >= this.maximumAttempts;
        const retryAt = terminal
          ? null
          : new Date(this.now().getTime() + Math.min(60_000, 2 ** command.attempts * 1_000));
        await this.repository.markFailed(
          command.id,
          error instanceof Error ? error.message : "Unknown outbox handler failure",
          retryAt,
          this.now(),
        );
      }
    }
    return processed;
  }
}
