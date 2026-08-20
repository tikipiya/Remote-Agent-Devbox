import { z } from "zod";

import type { Sha256Digest } from "@rad/git-artifacts";

export const approvalStatusSchema = z.enum(["PENDING", "APPROVED", "DENIED", "STALE"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalStaleReasonSchema = z.enum([
  "APPROVAL_EXPIRED",
  "STALE_APPROVAL_ARTIFACT_CHANGED",
  "STALE_APPROVAL_POLICY_CHANGED",
  "STALE_APPROVAL_VALIDATOR_CHANGED",
  "STALE_APPROVAL_SECURITY_POSTURE_CHANGED",
  "STALE_APPROVAL_REMOTE_STATE_CHANGED",
]);
export type ApprovalStaleReason = z.infer<typeof approvalStaleReasonSchema>;

export const approvalOperationTypeSchema = z.literal("CREATE_PULL_REQUEST");
export type ApprovalOperationType = z.infer<typeof approvalOperationTypeSchema>;

export interface ApprovalRequest {
  id: string;
  workspaceId: string;
  reviewSnapshotId: string;
  operationType: ApprovalOperationType;
  reviewDigest: Sha256Digest;
  validatorProfileDigest: Sha256Digest;
  securityEpoch: number;
  deploymentTier: number;
  securityPostureHash: Sha256Digest;
  status: ApprovalStatus;
  staleReason: ApprovalStaleReason | null;
  requestedBy: string;
  requestedAt: Date;
  expiresAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
}
