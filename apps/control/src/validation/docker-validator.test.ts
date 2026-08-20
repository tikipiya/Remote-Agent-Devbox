import { describe, expect, it } from "vitest";

import type { GitArtifact } from "@rad/git-artifacts";

import type { CommandResult, CommandRunner } from "../workspace/command-runner.js";
import { DockerValidatorLauncher } from "./docker-validator.js";

const imageDigest = `sha256:${"a".repeat(64)}`;
const artifactDigest = `sha256:${"b".repeat(64)}` as const;
const artifact: GitArtifact = {
  id: "30000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  repositoryId: "10000000-0000-4000-8000-000000000001",
  artifactDigest,
  storageKey: `sha256/${"b".repeat(64)}/artifact.bundle`,
  sizeBytes: 123,
  status: "STAGED",
  rejectionReason: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  validatedAt: null
};

const config = {
  RAD_ARTIFACT_VOLUME: "rad-artifacts",
  RAD_VALIDATOR_IMAGE: "rad-validator:local",
  RAD_VALIDATOR_IMAGE_DIGEST: imageDigest,
  RAD_VALIDATOR_MEMORY_MB: 512,
  RAD_VALIDATOR_CPUS: 1,
  RAD_VALIDATOR_PIDS: 64,
  RAD_VALIDATOR_TIMEOUT_MS: 120_000
} as const;

class StubRunner implements CommandRunner {
  public readonly calls: Array<{ executable: string; args: readonly string[] }> = [];
  public constructor(private readonly results: CommandResult[]) {}
  public async run(executable: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ executable, args });
    const result = this.results.shift();
    if (!result) throw new Error("unexpected command");
    return result;
  }
}

describe("DockerValidatorLauncher", () => {
  it("pins the image and launches the parser without network or write access", async () => {
    const manifest = {
      schemaVersion: "git-structural-manifest-1",
      artifactDigest: "b".repeat(64),
      gitObjectFormat: "sha1",
      baseCommit: "1".repeat(40),
      targetCommit: "2".repeat(40),
      targetTree: "3".repeat(40),
      files: []
    };
    const runner = new StubRunner([
      { stdout: `${imageDigest}\n`, stderr: "" },
      { stdout: `${"c".repeat(64)}  /usr/bin/git\n`, stderr: "" },
      { stdout: JSON.stringify(manifest), stderr: "" }
    ]);

    const result = await new DockerValidatorLauncher(config, runner).validate(artifact, "main");

    expect(result.manifest).toEqual(manifest);
    expect(result.profile.imageDigest).toBe(imageDigest);
    expect(result.profileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const validationArgs = runner.calls[2]!.args;
    expect(validationArgs).toContain("none");
    expect(validationArgs).toContain("--read-only");
    expect(validationArgs).toContain(
      `type=volume,source=rad-artifacts,target=/artifact,readonly,volume-subpath=sha256/${"b".repeat(64)}`
    );
    expect(validationArgs).toContain(imageDigest);
    expect(validationArgs).not.toContain("rad-validator:local");
  });

  it("fails closed when the image is not pinned", async () => {
    const runner = new StubRunner([]);
    await expect(
      new DockerValidatorLauncher({ ...config, RAD_VALIDATOR_IMAGE_DIGEST: "" }, runner).validate(
        artifact,
        "main"
      )
    ).rejects.toThrow("must pin");
    expect(runner.calls).toHaveLength(0);
  });

  it("rejects an artifact key that disagrees with the recorded digest", async () => {
    const runner = new StubRunner([]);
    await expect(
      new DockerValidatorLauncher(config, runner).validate(
        { ...artifact, storageKey: `sha256/${"d".repeat(64)}/artifact.bundle` },
        "main"
      )
    ).rejects.toThrow("does not match");
  });
});
