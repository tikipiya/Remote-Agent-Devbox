import { spawn } from "node:child_process";

import { RadError } from "@rad/shared";

import { CodexAppServerClient } from "./app-server-client.js";

export function spawnCodexAppServer(): CodexAppServerClient {
  const child = spawn(
    "codex",
    ["app-server", "--stdio", "--strict-config", "--disable", "multi_agent"],
    {
      env: sanitizedEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });

  return new CodexAppServerClient({
    input: child.stdout,
    output: child.stdin,
    close: async () => {
      child.kill("SIGTERM");
      const exitCode = await new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve(child.exitCode);
        }, 5_000).unref();
      });
      if (exitCode && exitCode !== 0) {
        throw new RadError("CODEX_APP_SERVER_EXITED", stderr || `Exit ${exitCode}`);
      }
    },
  });
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TERM",
    "CODEX_HOME",
    "OPENAI_API_KEY",
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
