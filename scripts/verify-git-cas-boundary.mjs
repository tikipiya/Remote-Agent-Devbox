import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "rad-git-cas-"));
const source = join(root, "source");
const remote = join(root, "remote.git");
const branch = "agent/cas-test";
const remoteRef = `refs/heads/${branch}`;

try {
  await git(["init", "--initial-branch=work", source]);
  await git(["init", "--bare", remote]);
  await git(["-C", source, "config", "user.name", "RAD CI"]);
  await git(["-C", source, "config", "user.email", "rad-ci@example.invalid"]);

  const first = await commit("first");
  await pushWithLease(first, null);
  const observed = await remoteHead();
  if (observed !== first) throw new Error("new-branch CAS did not publish the first target");

  const second = await commit("second");
  await pushWithLease(second, first);
  if ((await remoteHead()) !== second) {
    throw new Error("existing-branch CAS did not publish the expected update");
  }

  const third = await commit("third");
  let staleRejected = false;
  try {
    await pushWithLease(third, first);
  } catch {
    staleRejected = true;
  }
  if (!staleRejected || (await remoteHead()) !== second) {
    throw new Error("stale remote CAS did not fail closed");
  }

  const main = await git(["--git-dir", remote, "show-ref", "--verify", "refs/heads/main"], true);
  if (main.exitCode === 0) throw new Error("CAS verification wrote the protected default branch");
  process.stdout.write("remote branch CAS boundary verified\n");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function commit(value) {
  await writeFile(join(source, "value.txt"), `${value}\n`);
  await git(["-C", source, "add", "value.txt"]);
  await git(["-C", source, "commit", "-m", value]);
  return (await git(["-C", source, "rev-parse", "HEAD"])).stdout.trim();
}

async function pushWithLease(target, expected) {
  await git([
    "-C",
    source,
    "push",
    "--porcelain",
    `--force-with-lease=${remoteRef}:${expected ?? ""}`,
    remote,
    `${target}:${remoteRef}`,
  ]);
}

async function remoteHead() {
  return (await git(["--git-dir", remote, "rev-parse", "--verify", remoteRef])).stdout.trim();
}

async function git(args, allowFailure = false) {
  try {
    const result = await execFileAsync("git", args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    if (allowFailure) return { stdout: "", stderr: "", exitCode: 1 };
    throw error;
  }
}
