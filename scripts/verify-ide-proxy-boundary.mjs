import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const containerName = `rad-ide-proxy-${process.pid}`;
const image = process.env.RAD_IDE_PROXY_IMAGE ?? "remote-agent-devbox-ide-proxy:ci";
const secret = "ide-proxy-boundary-verification-secret-0001";

try {
  await docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--publish",
    "127.0.0.1::3001",
    "--env",
    `RAD_IDE_PROXY_SHARED_SECRET=${secret}`,
    "--env",
    "RAD_CONTROL_INTERNAL_URL=http://127.0.0.1:65535",
    image,
  ]);

  const port = (await docker(["port", containerName, "3001/tcp"])).stdout.trim();
  const match = /^127\.0\.0\.1:(\d+)$/.exec(port);
  if (!match?.[1]) throw new Error(`IDE proxy was not loopback-published: ${port}`);

  const hostConfig = JSON.parse(
    (await docker(["inspect", "--format", "{{json .HostConfig}}", containerName])).stdout,
  );
  if (hostConfig.ReadonlyRootfs !== true) throw new Error("IDE proxy root is writable");
  if (!hostConfig.CapDrop?.includes("ALL")) throw new Error("IDE proxy retains capabilities");
  if (!hostConfig.SecurityOpt?.includes("no-new-privileges=true")) {
    throw new Error("IDE proxy permits privilege escalation");
  }

  const healthUrl = `http://127.0.0.1:${match[1]}/health`;
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && (await response.json()).status === "ok") {
        healthy = true;
        break;
      }
    } catch {
      // The bounded loop handles container startup without accepting a partial result.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!healthy) throw new Error("IDE proxy did not become healthy");
  process.stdout.write("one-time IDE proxy boundary verified\n");
} finally {
  await docker(["rm", "--force", "--volumes", containerName], true);
}

async function docker(arguments_, allowFailure = false) {
  try {
    const result = await execFileAsync("docker", arguments_, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: typeof error.stdout === "string" ? error.stdout : "",
        stderr: typeof error.stderr === "string" ? error.stderr : String(error),
        exitCode: typeof error.code === "number" ? error.code : 1,
      };
    }
    throw error;
  }
}
