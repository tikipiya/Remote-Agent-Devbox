import { z } from "zod";

export const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type Sha256Digest = z.infer<typeof sha256DigestSchema>;

export const gitArtifactStatusSchema = z.enum([
  "STAGED",
  "VALIDATED",
  "REJECTED",
]);
export type GitArtifactStatus = z.infer<typeof gitArtifactStatusSchema>;

export interface GitArtifact {
  id: string;
  workspaceId: string;
  repositoryId: string;
  artifactDigest: Sha256Digest;
  storageKey: string;
  sizeBytes: number;
  status: GitArtifactStatus;
  rejectionReason: string | null;
  createdAt: Date;
  validatedAt: Date | null;
}
