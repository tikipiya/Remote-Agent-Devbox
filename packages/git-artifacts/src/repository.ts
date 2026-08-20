import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  bigint,
  check,
  index,
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

export const gitArtifacts = pgTable(
  "git_artifacts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    artifactDigest: text("artifact_digest").notNull().unique(),
    storageKey: text("storage_key").notNull().unique(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
  },
  (table) => [
    index("git_artifacts_workspace_idx").on(table.workspaceId, table.createdAt),
    check("git_artifacts_size_check", sql`${table.sizeBytes} > 0`),
    check(
      "git_artifacts_status_check",
      sql`${table.status} IN ('STAGED', 'VALIDATED', 'REJECTED')`,
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

function asArtifact(record: typeof gitArtifacts.$inferSelect): GitArtifact {
  return {
    ...record,
    artifactDigest: sha256DigestSchema.parse(record.artifactDigest),
    status: gitArtifactStatusSchema.parse(record.status),
  };
}
