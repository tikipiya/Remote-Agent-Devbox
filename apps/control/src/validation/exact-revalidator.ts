import {
  canonicalizeFiles,
  digestCanonical,
  reviewManifestSchema,
  type GitArtifact,
  type ReviewSnapshot,
} from "@rad/git-artifacts";
import { RadError } from "@rad/shared";
import type { InstanceMetadataRepository } from "@rad/workspace-state";

import type { ArtifactValidator } from "./review-service.js";

export class ExactRevalidator {
  public constructor(
    private readonly metadata: InstanceMetadataRepository,
    private readonly validator: ArtifactValidator,
  ) {}

  public async revalidate(
    review: ReviewSnapshot,
    artifact: GitArtifact,
    defaultBranch: string,
  ): Promise<void> {
    this.requireArtifact(review, artifact);
    await this.requireSecurityContext(review);
    const validation = await this.validator.validate(artifact, defaultBranch);
    if (validation.profileDigest !== review.validatorProfileDigest) {
      throw new RadError(
        "FINAL_VALIDATOR_PROFILE_MISMATCH",
        "Exact validator profile is no longer available",
      );
    }

    const reproduced = reviewManifestSchema.parse({
      crfVersion: "CRF-1",
      repositoryId: review.repositoryId,
      workspaceId: review.workspaceId,
      gitObjectFormat: validation.manifest.gitObjectFormat,
      baseCommit: validation.manifest.baseCommit,
      targetCommit: validation.manifest.targetCommit,
      targetTree: validation.manifest.targetTree,
      artifactDigest: artifact.artifactDigest,
      validatorProfileDigest: validation.profileDigest,
      policyDigest: validation.profile.policyDigest,
      securityEpoch: review.securityEpoch,
      deploymentTier: review.deploymentTier,
      securityPostureHash: review.securityPostureHash,
      files: canonicalizeFiles(validation.manifest.files),
    });
    if (digestCanonical(reproduced) !== review.reviewDigest) {
      throw new RadError(
        "FINAL_REVIEW_DIGEST_MISMATCH",
        "Final structural revalidation did not reproduce the approved review digest",
      );
    }
    await this.requireSecurityContext(review);
  }

  private requireArtifact(review: ReviewSnapshot, artifact: GitArtifact): void {
    if (
      artifact.id !== review.artifactId ||
      artifact.workspaceId !== review.workspaceId ||
      artifact.repositoryId !== review.repositoryId ||
      artifact.artifactDigest !== review.artifactDigest ||
      artifact.status !== "VALIDATED"
    ) {
      throw new RadError(
        "FINAL_ARTIFACT_MISMATCH",
        "Approved Review Snapshot no longer matches the immutable artifact record",
      );
    }
  }

  private async requireSecurityContext(review: ReviewSnapshot): Promise<void> {
    const metadata = await this.metadata.getSecurityMetadata();
    if (
      !metadata ||
      metadata.securityEpoch !== review.securityEpoch ||
      metadata.deploymentTier !== review.deploymentTier ||
      metadata.securityPostureHash !== review.securityPostureHash
    ) {
      throw new RadError(
        "FINAL_SECURITY_CONTEXT_MISMATCH",
        "Security context changed after human approval",
      );
    }
  }
}
