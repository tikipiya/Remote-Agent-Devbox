import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
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
    return execFileAsync(executable, [...args], {
      encoding: "utf8",
      maxBuffer: options.maxBufferBytes ?? 1024 * 1024,
      timeout: options.timeoutMs ?? 30_000,
      windowsHide: true,
      env: options.env,
    });
  }
}
