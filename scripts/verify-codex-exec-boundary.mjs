import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CodexAppServerClient } from "../packages/agents/dist/app-server-client.js";

const execFileAsync = promisify(execFile);
const modelTask = process.argv.includes("--model-task");
const apiKey = modelTask
  ? requiredEnvironment("RAD_CODEX_API_KEY")
  : "sk-test-not-a-real-key";
const codexHome = await mkdtemp(join(tmpdir(), "rad-codex-boundary-"));
const verificationWorkspace = await mkdtemp(join(tmpdir(), "rad-codex-workspace-"));
await writeFile(join(verificationWorkspace, "proof.txt"), "before\n", "utf8");
await execFileAsync("git", ["init", verificationWorkspace], { windowsHide: true });
const port = await reservePort();
const execServerUrl = `ws://127.0.0.1:${port}`;
const baseEnvironment = pickEnvironment(["PATH", "HOME", "LANG", "LC_ALL"]);
baseEnvironment.CODEX_HOME = codexHome;

const execServer = spawn(
  "codex",
  [
    "exec-server",
    "--listen",
    execServerUrl,
    "--strict-config",
    "--disable",
    "multi_agent",
  ],
  {
    cwd: verificationWorkspace,
    env: baseEnvironment,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  },
);
const execStderr = collect(execServer.stderr);
let appServer;

try {
  await waitForPort(port, execServer, execStderr);
  appServer = spawn(
    "codex",
    ["app-server", "--stdio", "--strict-config", "--disable", "multi_agent"],
    {
      env: {
        ...baseEnvironment,
        OPENAI_API_KEY: apiKey,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const appStderr = collect(appServer.stderr);
  const client = new CodexAppServerClient({
    input: appServer.stdout,
    output: appServer.stdin,
    requestTimeoutMs: 10_000,
    close: () => stop(appServer),
  });

  try {
    await client.initialize();
    await client.connectEnvironment({
      environmentId: "boundary-verification",
      execServerUrl,
    });
    if (modelTask) {
      await client.runTask(
        "Replace the entire contents of proof.txt with the text 'remote execution verified' without quotes or trailing punctuation. Do not modify any other file.",
        verificationWorkspace,
        {
          environmentId: "boundary-verification",
          execServerUrl,
        },
      );
      const proof = await readFile(join(verificationWorkspace, "proof.txt"), "utf8");
      if (proof.trim() !== "remote execution verified") {
        throw new Error(`Unexpected proof.txt contents: ${JSON.stringify(proof)}`);
      }
    }
  } catch (error) {
    throw new Error(`${String(error)}\n${appStderr()}`);
  } finally {
    await client.close();
  }

  process.stdout.write(
    `${JSON.stringify({
      appServer: "initialized",
      execEnvironment: "ready",
      execServerHasApiKey: false,
      modelCalled: modelTask,
      workspaceEditVerified: modelTask,
    })}\n`,
  );
} finally {
  if (appServer) await stop(appServer);
  await stop(execServer);
  await rm(codexHome, { recursive: true, force: true });
  await rm(verificationWorkspace, { recursive: true, force: true });
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required with --model-task`);
  return value;
}

function pickEnvironment(names) {
  return Object.fromEntries(
    names.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
}

function collect(stream) {
  let output = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-8_192);
  });
  return () => output;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port assigned");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForPort(port, child, stderr) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`exec-server exited with ${child.exitCode}: ${stderr()}`);
    }
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`exec-server did not listen: ${stderr()}`);
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
