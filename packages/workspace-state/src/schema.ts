import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const repositories = pgTable("repositories", {
  id: uuid("id").primaryKey(),
  remoteUrl: text("remote_url").notNull().unique(),
  defaultBranch: text("default_branch").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "restrict" }),
    desiredState: text("desired_state").notNull(),
    observedState: text("observed_state").notNull(),
    stateVersion: bigint("state_version", { mode: "number" }).notNull().default(0),
    sandboxBackend: text("sandbox_backend").notNull(),
    branchName: text("branch_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastError: text("last_error"),
  },
  (table) => [
    index("workspaces_reconcile_idx").on(
      table.desiredState,
      table.observedState,
      table.expiresAt,
    ),
    check(
      "workspaces_desired_state_check",
      sql`${table.desiredState} IN ('RUNNING', 'SUSPENDED', 'STOPPED', 'DESTROYED')`,
    ),
    check(
      "workspaces_observed_state_check",
      sql`${table.observedState} IN ('MISSING', 'PROVISIONING', 'STARTING', 'READY', 'BUSY', 'SUSPENDING', 'SUSPENDED', 'STOPPING', 'STOPPED', 'DESTROYING', 'DESTROYED', 'FAILED')`,
    ),
    check("workspaces_state_version_check", sql`${table.stateVersion} >= 0`),
    check("workspaces_sandbox_backend_check", sql`${table.sandboxBackend} = 'docker'`),
    check("workspaces_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const instanceMetadata = pgTable(
  "instance_metadata",
  {
    singletonKey: text("singleton_key").primaryKey().default("instance"),
    deploymentTier: bigint("deployment_tier", { mode: "number" }).notNull(),
    securityEpoch: bigint("security_epoch", { mode: "number" }).notNull().default(1),
    securityPostureHash: text("security_posture_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("instance_metadata_singleton_check", sql`${table.singletonKey} = 'instance'`),
    check("instance_metadata_tier_check", sql`${table.deploymentTier} BETWEEN 1 AND 3`),
    check("instance_metadata_epoch_check", sql`${table.securityEpoch} > 0`),
  ],
);

