import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { RadError } from "@rad/shared";

import {
  gitArtifactStatusSchema,
  sha256DigestSchema,
  type GitArtifact,
  type GitArtifactStatus,
  type Sha256Digest,
} from "./artifact.js";
import {
  digestCanonical,
  reviewManifestSchema,
  validatorProfileSchema,
  type ReviewManifest,
  type ValidatorProfile,
} from "./crf.js";
import type { ReviewSnapshot } from "./review.js";

export const gitArtifacts = pgTable(
  "git_artifacts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    artifactDigest: text("artifact_digest").notNull(),
    storageKey: text("storage_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
  },
  (table) => [
    index("git_artifacts_workspace_idx").on(table.workspaceId, table.createdAt),
    index("git_artifacts_digest_idx").on(table.artifactDigest),
    check("git_artifacts_size_check", sql`${table.sizeBytes} > 0`),
    check(
      "git_artifacts_status_check",
      sql`${table.status} IN ('STAGED', 'VALIDATED', 'REJECTED')`,
    ),
  ],
);

export const reviewSnapshots = pgTable(
  "review_snapshots",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    artifactId: uuid("artifact_id").notNull().unique(),
    crfVersion: text("crf_version").notNull(),
    baseCommit: text("base_commit").notNull(),
    targetCommit: text("target_commit").notNull(),
    targetTree: text("target_tree").notNull(),
    artifactDigest: text("artifact_digest").notNull(),
    validatorProfileDigest: text("validator_profile_digest").notNull(),
    validatorProfile: jsonb("validator_profile").$type<ValidatorProfile>().notNull(),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull(),
    deploymentTier: bigint("deployment_tier", { mode: "number" }).notNull(),
    securityPostureHash: text("security_posture_hash").notNull(),
    reviewDigest: text("review_digest").notNull(),
    policyHash: text("policy_hash").notNull(),
    structuralManifest: jsonb("structural_manifest").$type<ReviewManifest>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("review_snapshots_review_digest_idx").on(table.reviewDigest),
    index("review_snapshots_workspace_idx").on(table.workspaceId, table.createdAt),
    check("review_snapshots_crf_check", sql`${table.crfVersion} = 'CRF-1'`),
    check("review_snapshots_epoch_check", sql`${table.securityEpoch} > 0`),
    check(
      "review_snapshots_tier_check",
      sql`${table.deploymentTier} BETWEEN 1 AND 3`,
    ),
  ],
);

export interface NewGitArtifact {
  id: string;
  workspaceId: string;
  repositoryId: string;
  artifactDigest: Sha256Digest;
  storageKey: string;
  sizeBytes: number;
}

export interface GitArtifactRepository {
  create(input: NewGitArtifact): Promise<GitArtifact>;
  get(id: string): Promise<GitArtifact | undefined>;
  findByDigest(digest: Sha256Digest): Promise<GitArtifact | undefined>;
  markValidated(id: string): Promise<GitArtifact>;
  markRejected(id: string, reason: string): Promise<GitArtifact>;
}

export interface NewReviewSnapshot {
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
}

export interface ReviewSnapshotRepository {
  createForStagedArtifact(input: NewReviewSnapshot): Promise<ReviewSnapshot>;
  get(id: string): Promise<ReviewSnapshot | undefined>;
  findByArtifact(artifactId: string): Promise<ReviewSnapshot | undefined>;
}

export class PostgresGitArtifactRepository implements GitArtifactRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async create(input: NewGitArtifact): Promise<GitArtifact> {
    const [record] = await this.db
      .insert(gitArtifacts)
      .values({ ...input, status: "STAGED" })
      .returning();
    if (!record) {
      throw new RadError("ARTIFACT_CREATE_FAILED", "Git artifact was not created");
    }
    return asArtifact(record);
  }

  public async get(id: string): Promise<GitArtifact | undefined> {
    const [record] = await this.db
      .select()
      .from(gitArtifacts)
      .where(eq(gitArtifacts.id, id))
      .limit(1);
    return record ? asArtifact(record) : undefined;
  }

  public async findByDigest(
    digest: Sha256Digest,
  ): Promise<GitArtifact | undefined> {
    const [record] = await this.db
      .select()
      .from(gitArtifacts)
      .where(eq(gitArtifacts.artifactDigest, digest))
      .limit(1);
    return record ? asArtifact(record) : undefined;
  }

  public markValidated(id: string): Promise<GitArtifact> {
    return this.transition(id, "VALIDATED", {
      validatedAt: new Date(),
      rejectionReason: null,
    });
  }

  public markRejected(id: string, reason: string): Promise<GitArtifact> {
    return this.transition(id, "REJECTED", {
      validatedAt: new Date(),
      rejectionReason: reason,
    });
  }

  private async transition(
    id: string,
    status: Exclude<GitArtifactStatus, "STAGED">,
    values: Partial<typeof gitArtifacts.$inferInsert>,
  ): Promise<GitArtifact> {
    const [record] = await this.db
      .update(gitArtifacts)
      .set({ ...values, status })
      .where(
        and(eq(gitArtifacts.id, id), eq(gitArtifacts.status, "STAGED")),
      )
      .returning();
    if (!record) {
      throw new RadError(
        "ARTIFACT_STATE_CONFLICT",
        `Artifact ${id} is no longer staged`,
      );
    }
    return asArtifact(record);
  }
}

export class PostgresReviewSnapshotRepository implements ReviewSnapshotRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async createForStagedArtifact(input: NewReviewSnapshot): Promise<ReviewSnapshot> {
    return await this.db.transaction(async (transaction) => {
      const [record] = await transaction.insert(reviewSnapshots).values(input).returning();
      if (!record) {
        throw new RadError("REVIEW_CREATE_FAILED", "Review snapshot was not created");
      }
      const [artifact] = await transaction
        .update(gitArtifacts)
        .set({ status: "VALIDATED", validatedAt: new Date(), rejectionReason: null })
        .where(and(eq(gitArtifacts.id, input.artifactId), eq(gitArtifacts.status, "STAGED")))
        .returning({ id: gitArtifacts.id });
      if (!artifact) {
        throw new RadError(
          "ARTIFACT_STATE_CONFLICT",
          `Artifact ${input.artifactId} is no longer staged`,
        );
      }
      return asReviewSnapshot(record);
    });
  }

  public async get(id: string): Promise<ReviewSnapshot | undefined> {
    const [record] = await this.db
      .select()
      .from(reviewSnapshots)
      .where(eq(reviewSnapshots.id, id))
      .limit(1);
    return record ? asReviewSnapshot(record) : undefined;
  }

  public async findByArtifact(artifactId: string): Promise<ReviewSnapshot | undefined> {
    const [record] = await this.db
      .select()
      .from(reviewSnapshots)
      .where(eq(reviewSnapshots.artifactId, artifactId))
      .limit(1);
    return record ? asReviewSnapshot(record) : undefined;
  }
}

function asArtifact(record: typeof gitArtifacts.$inferSelect): GitArtifact {
  return {
    ...record,
    artifactDigest: sha256DigestSchema.parse(record.artifactDigest),
    status: gitArtifactStatusSchema.parse(record.status),
  };
}

function asReviewSnapshot(record: typeof reviewSnapshots.$inferSelect): ReviewSnapshot {
  const artifactDigest = sha256DigestSchema.parse(record.artifactDigest);
  const validatorProfileDigest = sha256DigestSchema.parse(record.validatorProfileDigest);
  const validatorProfile = validatorProfileSchema.parse(record.validatorProfile);
  const securityPostureHash = sha256DigestSchema.parse(record.securityPostureHash);
  const reviewDigest = sha256DigestSchema.parse(record.reviewDigest);
  const policyHash = sha256DigestSchema.parse(record.policyHash);
  const structuralManifest = reviewManifestSchema.parse(record.structuralManifest);
  if (
    digestCanonical(validatorProfile) !== validatorProfileDigest ||
    digestCanonical(structuralManifest) !== reviewDigest ||
    structuralManifest.repositoryId !== record.repositoryId ||
    structuralManifest.workspaceId !== record.workspaceId ||
    structuralManifest.baseCommit !== record.baseCommit ||
    structuralManifest.targetCommit !== record.targetCommit ||
    structuralManifest.targetTree !== record.targetTree ||
    structuralManifest.artifactDigest !== artifactDigest ||
    structuralManifest.validatorProfileDigest !== validatorProfileDigest ||
    structuralManifest.policyDigest !== policyHash ||
    structuralManifest.securityEpoch !== record.securityEpoch ||
    structuralManifest.deploymentTier !== record.deploymentTier ||
    structuralManifest.securityPostureHash !== securityPostureHash
  ) {
    throw new RadError(
      "REVIEW_INTEGRITY_FAILED",
      `Review snapshot ${record.id} failed canonical integrity verification`,
    );
  }
  return {
    ...record,
    crfVersion: "CRF-1",
    artifactDigest,
    validatorProfileDigest,
    validatorProfile,
    securityPostureHash,
    reviewDigest,
    policyHash,
    structuralManifest,
  };
}
