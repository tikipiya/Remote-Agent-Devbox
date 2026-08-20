import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export class CommandExecutionError extends Error {
  public constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "CommandExecutionError";
  }
}

export interface CommandRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBufferBytes?: number },
  ): Promise<CommandResult>;
}

export class ExecFileCommandRunner implements CommandRunner {
  public async run(
    executable: string,
    args: readonly string[],
    options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBufferBytes?: number } = {},
  ): Promise<CommandResult> {
    try {
      return await execFileAsync(executable, [...args], {
        encoding: "utf8",
        maxBuffer: options.maxBufferBytes ?? 1024 * 1024,
        timeout: options.timeoutMs ?? 30_000,
        windowsHide: true,
        env: options.env,
      });
    } catch (error) {
      const output = error as { stdout?: unknown; stderr?: unknown };
      throw new CommandExecutionError(
        error instanceof Error ? error.message : "Command failed",
        typeof output.stdout === "string" ? output.stdout : "",
        typeof output.stderr === "string" ? output.stderr : "",
      );
    }
  }
}
