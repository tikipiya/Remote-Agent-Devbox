import { describe, expect, it } from "vitest";

import {
  digestCanonical,
  type GitArtifact,
  type NewReviewSnapshot,
  type ReviewSnapshot,
  type ReviewSnapshotRepository,
  type ValidatorProfile,
} from "@rad/git-artifacts";
import type { InstanceSecurityMetadata } from "@rad/workspace-state";

import type { ArtifactValidator } from "./review-service.js";
import { ReviewService } from "./review-service.js";

const artifact: GitArtifact = {
  id: "30000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  repositoryId: "10000000-0000-4000-8000-000000000001",
  artifactDigest: `sha256:${"a".repeat(64)}`,
  storageKey: `sha256/${"a".repeat(64)}/artifact.bundle`,
  sizeBytes: 10,
  status: "STAGED",
  rejectionReason: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  validatedAt: null,
};
const profile: ValidatorProfile = {
  schemaVersion: "validator-profile-1",
  imageDigest: `sha256:${"b".repeat(64)}`,
  gitBinaryDigest: `sha256:${"c".repeat(64)}`,
  crfVersion: "CRF-1",
  canonicalizerDigest: `sha256:${"d".repeat(64)}`,
  policyDigest: `sha256:${"e".repeat(64)}`,
  runnerConfigDigest: `sha256:${"f".repeat(64)}`,
};
const securityMetadata: InstanceSecurityMetadata = {
  deploymentTier: 1,
  securityEpoch: 7,
  securityPostureHash: `sha256:${"9".repeat(64)}`,
  maintenanceMode: false,
  maintenanceReason: null,
  maintenanceStartedAt: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

class MemoryReviews implements ReviewSnapshotRepository {
  public snapshot: ReviewSnapshot | undefined;

  public async createForStagedArtifact(input: NewReviewSnapshot): Promise<ReviewSnapshot> {
    this.snapshot = { ...input, createdAt: new Date("2026-01-01T00:00:00Z") };
    return this.snapshot;
  }

  public async get(id: string): Promise<ReviewSnapshot | undefined> {
    return this.snapshot?.id === id ? this.snapshot : undefined;
  }

  public async findByArtifact(artifactId: string): Promise<ReviewSnapshot | undefined> {
    return this.snapshot?.artifactId === artifactId ? this.snapshot : undefined;
  }
}

describe("ReviewService", () => {
  it("binds canonical CRF-1 to profile and stable security context", async () => {
    const reviews = new MemoryReviews();
    let validationCalls = 0;
    const validator: ArtifactValidator = {
      async validate() {
        validationCalls += 1;
        return {
          profile,
          profileDigest: digestCanonical(profile),
          manifest: {
            schemaVersion: "git-structural-manifest-1",
            artifactDigest: "a".repeat(64),
            gitObjectFormat: "sha1",
            baseCommit: "1".repeat(40),
            targetCommit: "2".repeat(40),
            targetTree: "3".repeat(40),
            files: [file("z"), file("a")],
          },
        };
      },
    };
    const service = new ReviewService(
      { get: async () => artifact },
      reviews,
      {
        getRepository: async () => ({
          id: artifact.repositoryId,
          remoteUrl: "https://example.test/repo.git",
          defaultBranch: "main",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        }),
      },
      {
        getSecurityMetadata: async () => securityMetadata,
      },
      validator,
    );

    const first = await service.validateArtifact(artifact.id);
    const second = await service.validateArtifact(artifact.id);

    expect(second).toBe(first);
    expect(validationCalls).toBe(1);
    expect(first.structuralManifest.files.map((entry) => decode(entry.pathBase64))).toEqual([
      "a",
      "z",
    ]);
    expect(first.structuralManifest.deploymentTier).toBe(1);
    expect(first.structuralManifest.securityEpoch).toBe(7);
    expect(first.reviewDigest).toBe(digestCanonical(first.structuralManifest));
  });

  it("discards a result if the security epoch changes while validating", async () => {
    let readCount = 0;
    const reviews = new MemoryReviews();
    const service = new ReviewService(
      { get: async () => artifact },
      reviews,
      {
        getRepository: async () => ({
          id: artifact.repositoryId,
          remoteUrl: "https://example.test/repo.git",
          defaultBranch: "main",
          createdAt: new Date(),
        }),
      },
      {
        getSecurityMetadata: async () => ({
          ...securityMetadata,
          securityEpoch: readCount++ === 0 ? 7 : 8,
        }),
      },
      {
        validate: async () => ({
          profile,
          profileDigest: digestCanonical(profile),
          manifest: {
            schemaVersion: "git-structural-manifest-1",
            artifactDigest: "a".repeat(64),
            gitObjectFormat: "sha1",
            baseCommit: "1".repeat(40),
            targetCommit: "2".repeat(40),
            targetTree: "3".repeat(40),
            files: [],
          },
        }),
      },
    );

    await expect(service.validateArtifact(artifact.id)).rejects.toThrow("changed during validation");
    expect(reviews.snapshot).toBeUndefined();
  });
});

function file(path: string) {
  return {
    pathBase64: Buffer.from(path).toString("base64"),
    oldBlob: "0".repeat(40),
    newBlob: "1".repeat(40),
    oldMode: "100644",
    newMode: "100644",
    status: "M" as const,
  };
}

function decode(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}
