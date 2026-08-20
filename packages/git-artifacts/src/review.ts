import type { ReviewManifest, ValidatorProfile } from "./crf.js";
import type { Sha256Digest } from "./artifact.js";

export interface ReviewSnapshot {
  id: string;
  workspaceId: string;
  repositoryId: string;
  artifactId: string;
  crfVersion: "CRF-1";
  baseCommit: string;
  targetCommit: string;
  targetTree: string;
  artifactDigest: Sha256Digest;
  validatorProfileDigest: Sha256Digest;
  validatorProfile: ValidatorProfile;
  securityEpoch: number;
  deploymentTier: number;
  securityPostureHash: Sha256Digest;
  reviewDigest: Sha256Digest;
  policyHash: Sha256Digest;
  structuralManifest: ReviewManifest;
  createdAt: Date;
}
