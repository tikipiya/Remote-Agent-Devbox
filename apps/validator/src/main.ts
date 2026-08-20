import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRawDiff } from "./raw-diff.js";

const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const baseRefPattern = /^refs\/remotes\/origin\/[A-Za-z0-9._/-]+$/;
const bundlePathPattern = /^\/artifact\/artifact\.bundle$/;
const maxCommandOutputBytes = 16 * 1024 * 1024;
const maxFiles = 10_000;

type ValidatorInput = Readonly<{
  bundlePath: string;
  baseRef: string;
  artifactDigest: string;
}>;

type CommandResult = Readonly<{ stdout: Buffer; stderr: Buffer }>;

async function main(): Promise<void> {
  const input = parseInput(process.argv.slice(2));
  const workDirectory = await mkdtemp(join(tmpdir(), "rad-validator-"));
  const repositoryPath = join(workDirectory, "repository.git");

  try {
    const observedDigest = await digestFile(input.bundlePath);
    if (observedDigest !== input.artifactDigest) {
      throw new Error("artifact bytes do not match the server-recorded digest");
    }
    await runGit(["init", "--bare", repositoryPath]);
    await runGit(["-C", repositoryPath, "bundle", "verify", input.bundlePath]);
    await runGit([
      "-C",
      repositoryPath,
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      input.bundlePath,
      "HEAD:refs/rad/target",
      `${input.baseRef}:refs/rad/base`
    ]);

    const objectFormat = await gitText(repositoryPath, ["rev-parse", "--show-object-format"]);
    if (objectFormat !== "sha1" && objectFormat !== "sha256") {
      throw new Error("git reported an unsupported object format");
    }

    const baseCommit = await gitObjectId(repositoryPath, "refs/rad/base", objectFormat);
    const targetCommit = await gitObjectId(repositoryPath, "refs/rad/target", objectFormat);
    const targetTree = await gitObjectId(repositoryPath, "refs/rad/target^{tree}", objectFormat);
    const diff = await runGit([
      "-C",
      repositoryPath,
      "diff-tree",
      "--no-commit-id",
      "--raw",
      "-r",
      "-z",
      "--no-abbrev",
      "--no-renames",
      "refs/rad/base",
      "refs/rad/target"
    ]);

    const output = {
      schemaVersion: "git-structural-manifest-1",
      artifactDigest: input.artifactDigest,
      gitObjectFormat: objectFormat,
      baseCommit,
      targetCommit,
      targetTree,
      files: parseRawDiff(diff.stdout, maxFiles)
    } as const;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseInput(arguments_: string[]): ValidatorInput {
  if (arguments_.length !== 3) {
    throw new Error("usage: rad-validator <bundle-path> <base-ref> <artifact-sha256>");
  }

  const [bundlePath, baseRef, artifactDigest] = arguments_ as [string, string, string];
  if (!bundlePathPattern.test(bundlePath)) {
    throw new Error("bundle path is outside the read-only artifact namespace");
  }
  if (!baseRefPattern.test(baseRef) || baseRef.includes("..") || baseRef.endsWith("/")) {
    throw new Error("base ref is invalid");
  }
  if (!sha256Pattern.test(artifactDigest)) {
    throw new Error("artifact digest must be canonical SHA-256");
  }
  return { bundlePath, baseRef, artifactDigest };
}

async function gitText(repositoryPath: string, arguments_: string[]): Promise<string> {
  const result = await runGit(["-C", repositoryPath, ...arguments_]);
  return result.stdout.toString("ascii").trim();
}

async function gitObjectId(
  repositoryPath: string,
  revision: string,
  objectFormat: "sha1" | "sha256"
): Promise<string> {
  const objectId = await gitText(repositoryPath, ["rev-parse", "--verify", revision]);
  const expectedPattern = objectFormat === "sha1" ? sha1Pattern : sha256Pattern;
  if (!expectedPattern.test(objectId)) {
    throw new Error("git emitted a malformed object ID");
  }
  return objectId;
}

async function runGit(arguments_: string[]): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...arguments_], {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/tmp",
        LANG: "C",
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("git command timed out"));
    }, 60_000);

    const append = (destination: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > maxCommandOutputBytes) {
        child.kill("SIGKILL");
        finish(new Error("git command output exceeded its limit"));
        return;
      }
      destination.push(chunk);
    };

    const finish = (error?: Error, result?: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result!);
    };

    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (code === 0) {
        finish(undefined, result);
        return;
      }
      const diagnostic = result.stderr.toString("utf8").trim().slice(0, 2_000);
      finish(new Error(`git command failed (${signal ?? code}): ${diagnostic}`));
    });
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "validator failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
