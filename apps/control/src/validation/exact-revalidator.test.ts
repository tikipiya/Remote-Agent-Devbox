import { describe, expect, it } from "vitest";

import {
  canonicalizeFiles,
  digestCanonical,
  type GitArtifact,
  type ReviewManifest,
  type ReviewSnapshot,
  type ValidatorProfile,
} from "@rad/git-artifacts";

import { ExactRevalidator } from "./exact-revalidator.js";

const profile: ValidatorProfile = {
  schemaVersion: "validator-profile-1",
  imageDigest: `sha256:${"1".repeat(64)}`,
  gitBinaryDigest: `sha256:${"2".repeat(64)}`,
  crfVersion: "CRF-1",
  canonicalizerDigest: `sha256:${"3".repeat(64)}`,
  policyDigest: `sha256:${"4".repeat(64)}`,
  runnerConfigDigest: `sha256:${"5".repeat(64)}`,
};
const profileDigest = digestCanonical(profile);
const validatorManifest = {
  schemaVersion: "git-structural-manifest-1" as const,
  artifactDigest: "a".repeat(64),
  gitObjectFormat: "sha1" as const,
  baseCommit: "b".repeat(40),
  targetCommit: "c".repeat(40),
  targetTree: "d".repeat(40),
  files: canonicalizeFiles([]),
};
const structuralManifest: ReviewManifest = {
  crfVersion: "CRF-1",
  repositoryId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  gitObjectFormat: "sha1",
  baseCommit: validatorManifest.baseCommit,
  targetCommit: validatorManifest.targetCommit,
  targetTree: validatorManifest.targetTree,
  artifactDigest: `sha256:${"a".repeat(64)}`,
  validatorProfileDigest: profileDigest,
  policyDigest: profile.policyDigest,
  securityEpoch: 9,
  deploymentTier: 1,
  securityPostureHash: `sha256:${"6".repeat(64)}`,
  files: [],
};
const review = {
  id: "30000000-0000-4000-8000-000000000001",
  repositoryId: structuralManifest.repositoryId,
  workspaceId: structuralManifest.workspaceId,
  artifactId: "40000000-0000-4000-8000-000000000001",
  artifactDigest: structuralManifest.artifactDigest,
  validatorProfileDigest: profileDigest,
  validatorProfile: profile,
  securityEpoch: 9,
  deploymentTier: 1,
  securityPostureHash: structuralManifest.securityPostureHash,
  reviewDigest: digestCanonical(structuralManifest),
  structuralManifest,
} as ReviewSnapshot;
const artifact: GitArtifact = {
  id: review.artifactId,
  workspaceId: review.workspaceId,
  repositoryId: review.repositoryId,
  artifactDigest: review.artifactDigest,
  storageKey: `sha256/${"a".repeat(64)}/artifact.bundle`,
  sizeBytes: 10,
  status: "VALIDATED",
  rejectionReason: null,
  createdAt: new Date(),
  validatedAt: new Date(),
};

describe("ExactRevalidator", () => {
  it("reproduces the approved digest under the exact profile and epoch", async () => {
    const revalidator = createRevalidator();
    await expect(revalidator.revalidate(review, artifact, "main")).resolves.toBeUndefined();
  });

  it("rejects profile and security context drift", async () => {
    await expect(
      createRevalidator({ profileDigest: `sha256:${"f".repeat(64)}` }).revalidate(
        review,
        artifact,
        "main",
      ),
    ).rejects.toThrow("profile");
    await expect(createRevalidator({}, 10).revalidate(review, artifact, "main")).rejects.toThrow(
      "Security context",
    );
  });
});

function createRevalidator(
  validationOverrides: Partial<{ profileDigest: typeof profileDigest }> = {},
  securityEpoch = 9,
): ExactRevalidator {
  return new ExactRevalidator(
    {
      getSecurityMetadata: async () => ({
        securityEpoch,
        deploymentTier: 1,
        securityPostureHash: structuralManifest.securityPostureHash,
        maintenanceMode: false,
        maintenanceReason: null,
        maintenanceStartedAt: null,
        updatedAt: new Date(),
      }),
    },
    {
      validate: async () => ({
        manifest: validatorManifest,
        profile,
        profileDigest,
        ...validationOverrides,
      }),
    },
  );
}
