import { randomUUID } from "node:crypto";

import {
  canonicalizeFiles,
  digestCanonical,
  reviewManifestSchema,
  sha256DigestSchema,
  type GitArtifact,
  type GitArtifactRepository,
  type ReviewSnapshot,
  type ReviewSnapshotRepository,
} from "@rad/git-artifacts";
import { RadError } from "@rad/shared";
import type {
  InstanceMetadataRepository,
  InstanceSecurityMetadata,
  WorkspaceRepository,
} from "@rad/workspace-state";

import type { ValidationResult } from "./docker-validator.js";

export interface ArtifactValidator {
  validate(artifact: GitArtifact, defaultBranch: string): Promise<ValidationResult>;
}

export class ReviewService {
  public constructor(
    private readonly artifacts: Pick<GitArtifactRepository, "get">,
    private readonly reviews: ReviewSnapshotRepository,
    private readonly workspaces: Pick<WorkspaceRepository, "getRepository">,
    private readonly metadata: InstanceMetadataRepository,
    private readonly validator: ArtifactValidator,
  ) {}

  public async validateArtifact(artifactId: string): Promise<ReviewSnapshot> {
    const existing = await this.reviews.findByArtifact(artifactId);
    if (existing) return existing;

    const artifact = await this.artifacts.get(artifactId);
    if (!artifact) {
      throw new RadError("ARTIFACT_NOT_FOUND", `Artifact ${artifactId} not found`);
    }
    if (artifact.status !== "STAGED") {
      throw new RadError(
        "ARTIFACT_STATE_CONFLICT",
        `Artifact ${artifactId} cannot be validated from ${artifact.status}`,
      );
    }
    const repository = await this.workspaces.getRepository(artifact.repositoryId);
    if (!repository) {
      throw new RadError(
        "REPOSITORY_NOT_FOUND",
        `Repository ${artifact.repositoryId} not found`,
      );
    }

    const securityContext = await this.requireSecurityMetadata();
    const validation = await this.validator.validate(artifact, repository.defaultBranch);
    const finalSecurityContext = await this.requireSecurityMetadata();
    if (!sameSecurityContext(securityContext, finalSecurityContext)) {
      throw new RadError(
        "SECURITY_CONTEXT_CHANGED",
        "Security context changed during validation; the result was discarded",
      );
    }

    const manifest = reviewManifestSchema.parse({
      crfVersion: "CRF-1",
      repositoryId: artifact.repositoryId,
      workspaceId: artifact.workspaceId,
      gitObjectFormat: validation.manifest.gitObjectFormat,
      baseCommit: validation.manifest.baseCommit,
      targetCommit: validation.manifest.targetCommit,
      targetTree: validation.manifest.targetTree,
      artifactDigest: artifact.artifactDigest,
      validatorProfileDigest: validation.profileDigest,
      policyDigest: validation.profile.policyDigest,
      securityEpoch: securityContext.securityEpoch,
      deploymentTier: securityContext.deploymentTier,
      securityPostureHash: sha256DigestSchema.parse(securityContext.securityPostureHash),
      files: canonicalizeFiles(validation.manifest.files),
    });
    const reviewDigest = digestCanonical(manifest);

    return await this.reviews.createForStagedArtifact({
      id: randomUUID(),
      workspaceId: artifact.workspaceId,
      repositoryId: artifact.repositoryId,
      artifactId: artifact.id,
      crfVersion: "CRF-1",
      baseCommit: manifest.baseCommit,
      targetCommit: manifest.targetCommit,
      targetTree: manifest.targetTree,
      artifactDigest: artifact.artifactDigest,
      validatorProfileDigest: validation.profileDigest,
      validatorProfile: validation.profile,
      securityEpoch: securityContext.securityEpoch,
      deploymentTier: securityContext.deploymentTier,
      securityPostureHash: manifest.securityPostureHash,
      reviewDigest,
      policyHash: validation.profile.policyDigest,
      structuralManifest: manifest,
    });
  }

  public get(id: string): Promise<ReviewSnapshot | undefined> {
    return this.reviews.get(id);
  }

  private async requireSecurityMetadata(): Promise<InstanceSecurityMetadata> {
    const metadata = await this.metadata.getSecurityMetadata();
    if (!metadata) {
      throw new RadError(
        "SECURITY_CONTEXT_MISSING",
        "Instance security metadata has not been initialized",
      );
    }
    if (
      !Number.isSafeInteger(metadata.securityEpoch) ||
      metadata.securityEpoch < 1 ||
      !Number.isSafeInteger(metadata.deploymentTier) ||
      metadata.deploymentTier < 1 ||
      metadata.deploymentTier > 3
    ) {
      throw new RadError("SECURITY_CONTEXT_INVALID", "Instance security metadata is invalid");
    }
    sha256DigestSchema.parse(metadata.securityPostureHash);
    return metadata;
  }
}

function sameSecurityContext(
  left: InstanceSecurityMetadata,
  right: InstanceSecurityMetadata,
): boolean {
  return (
    left.securityEpoch === right.securityEpoch &&
    left.deploymentTier === right.deploymentTier &&
    left.securityPostureHash === right.securityPostureHash
  );
}
