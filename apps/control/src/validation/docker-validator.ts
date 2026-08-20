import {
  canonicalJson,
  digestCanonical,
  sha256DigestSchema,
  validatorManifestSchema,
  validatorProfileSchema,
  type GitArtifact,
  type Sha256Digest,
  type ValidatorManifest,
  type ValidatorProfile
} from "@rad/git-artifacts";
import { RadError, type RuntimeConfig } from "@rad/shared";

import type { CommandRunner } from "../workspace/command-runner.js";

const imageIdPattern = /^sha256:[0-9a-f]{64}$/;
const gitDigestPattern = /^[0-9a-f]{64}\s+\/usr\/bin\/git$/;
const branchPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9._-])?$/;
const validatorOutputLimitBytes = 16 * 1024 * 1024;

export interface ValidationResult {
  manifest: ValidatorManifest;
  profile: ValidatorProfile;
  profileDigest: Sha256Digest;
}

type ValidatorRuntimeConfig = Pick<
  RuntimeConfig,
  | "RAD_ARTIFACT_VOLUME"
  | "RAD_VALIDATOR_IMAGE"
  | "RAD_VALIDATOR_IMAGE_DIGEST"
  | "RAD_VALIDATOR_MEMORY_MB"
  | "RAD_VALIDATOR_CPUS"
  | "RAD_VALIDATOR_PIDS"
  | "RAD_VALIDATOR_TIMEOUT_MS"
>;

export class DockerValidatorLauncher {
  public constructor(
    private readonly config: ValidatorRuntimeConfig,
    private readonly runner: CommandRunner
  ) {}

  public async validate(artifact: GitArtifact, defaultBranch: string): Promise<ValidationResult> {
    const configuredDigest = this.requireConfiguredImageDigest();
    this.requireArtifactIdentity(artifact);
    const baseRef = this.baseRef(defaultBranch);
    const observedImageDigest = await this.inspectImageDigest();
    if (observedImageDigest !== configuredDigest) {
      throw new RadError(
        "VALIDATOR_IMAGE_MISMATCH",
        `Validator image resolved to ${observedImageDigest}, expected ${configuredDigest}`
      );
    }

    const gitBinaryDigest = await this.inspectGitBinary(configuredDigest);
    const profile = this.buildProfile(configuredDigest, gitBinaryDigest);
    const profileDigest = digestCanonical(profile);
    const artifactHexDigest = artifact.artifactDigest.slice("sha256:".length);
    const artifactSubpath = `sha256/${artifactHexDigest}`;
    const result = await this.runner.run(
      "docker",
      [
        "container",
        "run",
        "--rm",
        ...this.sandboxArguments(),
        "--mount",
        `type=volume,source=${this.config.RAD_ARTIFACT_VOLUME},target=/artifact,readonly,volume-subpath=${artifactSubpath}`,
        configuredDigest,
        "/artifact/artifact.bundle",
        baseRef,
        artifactHexDigest
      ],
      {
        timeoutMs: this.config.RAD_VALIDATOR_TIMEOUT_MS,
        maxBufferBytes: validatorOutputLimitBytes
      }
    );

    let decoded: unknown;
    try {
      decoded = JSON.parse(result.stdout);
    } catch {
      throw new RadError("VALIDATOR_OUTPUT_INVALID", "Validator did not emit JSON");
    }
    const manifest = validatorManifestSchema.parse(decoded);
    if (manifest.artifactDigest !== artifactHexDigest) {
      throw new RadError("VALIDATOR_DIGEST_MISMATCH", "Validator reported a different artifact digest");
    }

    return { manifest, profile, profileDigest };
  }

  private requireConfiguredImageDigest(): Sha256Digest {
    const digest = this.config.RAD_VALIDATOR_IMAGE_DIGEST;
    if (!digest) {
      throw new RadError(
        "VALIDATOR_IMAGE_UNPINNED",
        "RAD_VALIDATOR_IMAGE_DIGEST must pin the exact validator image before validation"
      );
    }
    return sha256DigestSchema.parse(digest);
  }

  private requireArtifactIdentity(artifact: GitArtifact): void {
    const expectedStorageKey = `sha256/${artifact.artifactDigest.slice("sha256:".length)}/artifact.bundle`;
    if (artifact.storageKey !== expectedStorageKey) {
      throw new RadError(
        "ARTIFACT_IDENTITY_MISMATCH",
        "Artifact storage key does not match its server-recorded digest"
      );
    }
  }

  private baseRef(defaultBranch: string): string {
    if (
      !branchPattern.test(defaultBranch) ||
      defaultBranch.includes("..") ||
      defaultBranch.includes("//") ||
      defaultBranch.endsWith(".lock")
    ) {
      throw new RadError("INVALID_DEFAULT_BRANCH", "Repository default branch is invalid");
    }
    return `refs/remotes/origin/${defaultBranch}`;
  }

  private async inspectImageDigest(): Promise<Sha256Digest> {
    const result = await this.runner.run("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      this.config.RAD_VALIDATOR_IMAGE
    ]);
    const digest = result.stdout.trim();
    if (!imageIdPattern.test(digest)) {
      throw new RadError("VALIDATOR_IMAGE_ID_INVALID", "Docker returned a malformed validator image ID");
    }
    return sha256DigestSchema.parse(digest);
  }

  private async inspectGitBinary(imageDigest: Sha256Digest): Promise<Sha256Digest> {
    const result = await this.runner.run(
      "docker",
      [
        "container",
        "run",
        "--rm",
        ...this.sandboxArguments(),
        "--entrypoint",
        "/usr/bin/sha256sum",
        imageDigest,
        "/usr/bin/git"
      ],
      { timeoutMs: 30_000 }
    );
    const output = result.stdout.trim();
    if (!gitDigestPattern.test(output)) {
      throw new RadError("VALIDATOR_GIT_DIGEST_INVALID", "Validator Git digest output was malformed");
    }
    return sha256DigestSchema.parse(`sha256:${output.slice(0, 64)}`);
  }

  private buildProfile(imageDigest: Sha256Digest, gitBinaryDigest: Sha256Digest): ValidatorProfile {
    return validatorProfileSchema.parse({
      schemaVersion: "validator-profile-1",
      imageDigest,
      gitBinaryDigest,
      crfVersion: "CRF-1",
      canonicalizerDigest: digestCanonical({ implementation: "rad-canonical-json", version: 1 }),
      policyDigest: digestCanonical({
        schemaVersion: "git-structural-policy-1",
        acceptedStatuses: ["A", "D", "M", "T"],
        maxFiles: 10_000,
        preserveRawPaths: true,
        renameDetection: false
      }),
      runnerConfigDigest: digestCanonical(this.runnerProfile())
    });
  }

  private sandboxArguments(): string[] {
    return [
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
      String(this.config.RAD_VALIDATOR_PIDS),
      "--memory",
      `${this.config.RAD_VALIDATOR_MEMORY_MB}m`,
      "--cpus",
      String(this.config.RAD_VALIDATOR_CPUS),
      "--user",
      "10002:10002",
      "--ulimit",
      "nofile=1024:1024"
    ];
  }

  private runnerProfile(): unknown {
    return JSON.parse(
      canonicalJson({
        network: "none",
        readOnlyRoot: true,
        artifactMountReadOnly: true,
        artifactMountScope: "digest-subdirectory",
        artifactVolume: this.config.RAD_ARTIFACT_VOLUME,
        temporaryFilesystem: "/tmp:rw,noexec,nosuid,nodev,size=384m",
        capabilities: [],
        noNewPrivileges: true,
        pidsLimit: this.config.RAD_VALIDATOR_PIDS,
        memoryMegabytes: this.config.RAD_VALIDATOR_MEMORY_MB,
        cpus: this.config.RAD_VALIDATOR_CPUS,
        uid: 10002,
        gid: 10002,
        openFilesLimit: 1024,
        timeoutMilliseconds: this.config.RAD_VALIDATOR_TIMEOUT_MS,
        outputLimitBytes: validatorOutputLimitBytes
      })
    );
  }
}
