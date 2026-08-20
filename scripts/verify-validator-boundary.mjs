import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const image = process.env.RAD_VALIDATOR_TEST_IMAGE ?? "remote-agent-devbox-validator:ci";
const workDirectory = await mkdtemp(join(tmpdir(), "rad-validator-boundary-"));
const repositoryPath = join(workDirectory, "repository");
const bundlePath = join(workDirectory, "artifact.bundle");
const stagingContainer = `rad-validator-stage-${randomUUID()}`;
const volume = `rad-validator-artifact-${randomUUID()}`;

try {
  await git(["init", "--initial-branch=work", repositoryPath]);
  await git(["-C", repositoryPath, "config", "user.name", "RAD CI"]);
  await git(["-C", repositoryPath, "config", "user.email", "rad-ci@example.invalid"]);
  await writeFile(join(repositoryPath, "review.txt"), "base\n");
  await git(["-C", repositoryPath, "add", "review.txt"]);
  await git(["-C", repositoryPath, "commit", "-m", "base"]);
  const baseCommit = await gitText(["-C", repositoryPath, "rev-parse", "HEAD"]);
  await git(["-C", repositoryPath, "update-ref", "refs/remotes/origin/main", baseCommit]);
  await writeFile(join(repositoryPath, "review.txt"), "target\n");
  await git(["-C", repositoryPath, "commit", "-am", "target"]);
  const targetCommit = await gitText(["-C", repositoryPath, "rev-parse", "HEAD"]);
  const targetTree = await gitText(["-C", repositoryPath, "rev-parse", "HEAD^{tree}"]);
  await git([
    "-C",
    repositoryPath,
    "bundle",
    "create",
    bundlePath,
    "HEAD",
    "refs/remotes/origin/main",
  ]);
  const bundleBytes = await readFile(bundlePath);
  const digest = createHash("sha256").update(bundleBytes).digest("hex");
  const imageId = (await command("docker", ["image", "inspect", "--format", "{{.Id}}", image])).stdout.trim();

  await command("docker", ["volume", "create", volume]);
  await command("docker", [
    "container",
    "run",
    "--rm",
    "--user",
    "0:0",
    "--mount",
    `type=volume,source=${volume},target=/artifacts`,
    "--entrypoint",
    "/bin/mkdir",
    imageId,
    "-p",
    `/artifacts/sha256/${digest}`,
  ]);
  await command("docker", [
    "container",
    "create",
    "--name",
    stagingContainer,
    "--user",
    "0:0",
    "--mount",
    `type=volume,source=${volume},target=/artifacts`,
    "--entrypoint",
    "/bin/sleep",
    imageId,
    "120",
  ]);
  await command("docker", ["container", "start", stagingContainer]);
  await command("docker", [
    "cp",
    bundlePath,
    `${stagingContainer}:/artifacts/sha256/${digest}/artifact.bundle`,
  ]);
  await command("docker", ["container", "rm", "--force", stagingContainer]);

  const validation = await runValidator(imageId, digest);
  const manifest = JSON.parse(validation.stdout);
  if (
    manifest.artifactDigest !== digest ||
    manifest.baseCommit !== baseCommit ||
    manifest.targetCommit !== targetCommit ||
    manifest.targetTree !== targetTree ||
    manifest.files?.length !== 1 ||
    Buffer.from(manifest.files[0].pathBase64, "base64").toString("utf8") !== "review.txt"
  ) {
    throw new Error(`validator manifest did not bind the expected Git structure: ${validation.stdout}`);
  }

  process.stdout.write(`validator boundary verified for ${imageId}\n`);
} finally {
  await command("docker", ["container", "rm", "--force", stagingContainer], true);
  await command("docker", ["volume", "rm", "--force", volume], true);
  await rm(workDirectory, { recursive: true, force: true });
}

async function runValidator(imageId, digest) {
  return command("docker", [
    "container",
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=384m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "64",
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--user",
    "10002:10002",
    "--mount",
    `type=volume,source=${volume},target=/artifact,readonly,volume-subpath=sha256/${digest}`,
    imageId,
    "/artifact/artifact.bundle",
    "refs/remotes/origin/main",
    digest,
  ]);
}

async function git(args) {
  return command("git", args);
}

async function gitText(args) {
  return (await git(args)).stdout.trim();
}

async function command(executable, args, ignoreFailure = false) {
  try {
    return await execFileAsync(executable, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });
  } catch (error) {
    if (ignoreFailure) return { stdout: "", stderr: "" };
    throw error;
  }
}
