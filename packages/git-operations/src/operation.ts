import { z } from "zod";

import type { Sha256Digest } from "@rad/git-artifacts";

export const gitOperationStateSchema = z.enum([
  "PENDING",
  "VALIDATING",
  "WAITING_CREDENTIAL",
  "PUSHING",
  "SUCCEEDED",
  "FAILED",
  "CONFLICT",
  "CANCELLED",
  "STALE",
]);
export type GitOperationState = z.infer<typeof gitOperationStateSchema>;

export const credentialLeaseStateSchema = z.enum([
  "RESERVED",
  "ISSUED",
  "CONSUMED",
  "EXPIRED",
  "FAILED",
  "UNCERTAIN",
]);
export type CredentialLeaseState = z.infer<typeof credentialLeaseStateSchema>;

export interface GitOperation {
  id: string;
  workspaceId: string;
  repositoryId: string;
  reviewSnapshotId: string;
  approvalId: string;
  branchName: string;
  targetCommit: string;
  expectedRemoteHead: string | null;
  reviewDigest: Sha256Digest;
  validatorProfileDigest: Sha256Digest;
  securityEpoch: number;
  state: GitOperationState;
  staleReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CredentialLease {
  id: string;
  operationId: string;
  repositoryId: string;
  securityEpoch: number;
  state: CredentialLeaseState;
  issuedAt: Date | null;
  expiresAt: Date | null;
  consumedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}

const allowedTransitions: Readonly<Record<GitOperationState, readonly GitOperationState[]>> = {
  PENDING: ["VALIDATING", "CANCELLED", "STALE", "FAILED"],
  VALIDATING: ["WAITING_CREDENTIAL", "CANCELLED", "STALE", "FAILED"],
  WAITING_CREDENTIAL: ["PUSHING", "CANCELLED", "STALE", "FAILED"],
  PUSHING: ["SUCCEEDED", "FAILED", "CONFLICT", "STALE"],
  SUCCEEDED: [],
  FAILED: [],
  CONFLICT: [],
  CANCELLED: [],
  STALE: [],
};

export function canTransitionGitOperation(
  from: GitOperationState,
  to: GitOperationState,
): boolean {
  return allowedTransitions[from].includes(to);
}
