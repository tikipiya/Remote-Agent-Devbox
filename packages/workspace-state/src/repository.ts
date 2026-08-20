import { and, eq, ne } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  RadError,
  type DesiredWorkspaceState,
  type ObservedWorkspaceState,
  type Repository,
  type Workspace,
} from "@rad/shared";

import { instanceMetadata, repositories, workspaces } from "./schema.js";
import { assertStartupSecurityMetadata } from "./security-posture.js";

export interface NewRepository {
  id: string;
  remoteUrl: string;
  defaultBranch: string;
}

export interface NewWorkspace {
  id: string;
  ownerUserId: string;
  repositoryId: string;
  branchName: string;
  expiresAt: Date;
}

export interface WorkspaceRepository {
  createRepository(input: NewRepository): Promise<Repository>;
  getRepository(id: string): Promise<Repository | undefined>;
  findRepositoryByRemoteUrl(remoteUrl: string): Promise<Repository | undefined>;
  createWorkspace(input: NewWorkspace): Promise<Workspace>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  listForReconciliation(): Promise<Workspace[]>;
  setDesiredState(
    id: string,
    desiredState: DesiredWorkspaceState,
    expectedVersion: number,
  ): Promise<Workspace>;
  setObservedState(
    id: string,
    observedState: ObservedWorkspaceState,
    expectedVersion: number,
    lastError?: string | null,
  ): Promise<Workspace>;
}

export interface InstanceSecurityMetadata {
  deploymentTier: number;
  securityEpoch: number;
  securityPostureHash: string;
  maintenanceMode: boolean;
  maintenanceReason: string | null;
  maintenanceStartedAt: Date | null;
  updatedAt: Date;
}

export interface InstanceMetadataRepository {
  synchronizeSecurityMetadata(input: {
    deploymentTier: number;
    securityPostureHash: string;
  }): Promise<InstanceSecurityMetadata>;
  getSecurityMetadata(): Promise<InstanceSecurityMetadata | undefined>;
  enterMaintenanceMode(reason: string, startedAt: Date): Promise<InstanceSecurityMetadata>;
  exitMaintenanceMode(expectedEpoch: number, completedAt: Date): Promise<InstanceSecurityMetadata>;
}

export function createDatabase(databaseUrl: string): {
  db: NodePgDatabase;
  pool: Pool;
} {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return { db: drizzle(pool), pool };
}

export class PostgresWorkspaceRepository implements WorkspaceRepository, InstanceMetadataRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async createRepository(input: NewRepository): Promise<Repository> {
    const [record] = await this.db
      .insert(repositories)
      .values(input)
      .returning();
    return requireRecord(record, "REPOSITORY_CREATE_FAILED");
  }

  public async synchronizeSecurityMetadata(input: {
    deploymentTier: number;
    securityPostureHash: string;
  }): Promise<InstanceSecurityMetadata> {
    const [inserted] = await this.db
      .insert(instanceMetadata)
      .values({ singletonKey: "instance", securityEpoch: 1, ...input })
      .onConflictDoNothing({ target: instanceMetadata.singletonKey })
      .returning();

    const record = inserted ?? (await this.getSecurityMetadata());
    return assertStartupSecurityMetadata(
      requireRecord(record, "INSTANCE_METADATA_SYNC_FAILED"),
      input,
    );
  }

  public async getSecurityMetadata(): Promise<InstanceSecurityMetadata | undefined> {
    const [record] = await this.db
      .select({
        deploymentTier: instanceMetadata.deploymentTier,
        securityEpoch: instanceMetadata.securityEpoch,
        securityPostureHash: instanceMetadata.securityPostureHash,
        maintenanceMode: instanceMetadata.maintenanceMode,
        maintenanceReason: instanceMetadata.maintenanceReason,
        maintenanceStartedAt: instanceMetadata.maintenanceStartedAt,
        updatedAt: instanceMetadata.updatedAt,
      })
      .from(instanceMetadata)
      .where(eq(instanceMetadata.singletonKey, "instance"))
      .limit(1);
    return record;
  }

  public async enterMaintenanceMode(
    reason: string,
    startedAt: Date,
  ): Promise<InstanceSecurityMetadata> {
    const [record] = await this.db
      .update(instanceMetadata)
      .set({
        maintenanceMode: true,
        maintenanceReason: reason,
        maintenanceStartedAt: startedAt,
        updatedAt: startedAt,
      })
      .where(
        and(
          eq(instanceMetadata.singletonKey, "instance"),
          eq(instanceMetadata.maintenanceMode, false),
        ),
      )
      .returning();
    if (record) return record;

    const current = await this.getSecurityMetadata();
    if (current?.maintenanceMode) return current;
    throw new RadError("MAINTENANCE_MODE_ENTER_FAILED", "Security metadata is missing");
  }

  public async exitMaintenanceMode(
    expectedEpoch: number,
    completedAt: Date,
  ): Promise<InstanceSecurityMetadata> {
    const [record] = await this.db
      .update(instanceMetadata)
      .set({
        maintenanceMode: false,
        maintenanceReason: null,
        maintenanceStartedAt: null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(instanceMetadata.singletonKey, "instance"),
          eq(instanceMetadata.maintenanceMode, true),
          eq(instanceMetadata.securityEpoch, expectedEpoch),
        ),
      )
      .returning();
    if (!record) {
      throw new RadError(
        "MAINTENANCE_MODE_EXIT_CONFLICT",
        "Maintenance mode or security epoch changed before exit",
      );
    }
    return record;
  }

  public async getRepository(id: string): Promise<Repository | undefined> {
    const [record] = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);
    return record;
  }

  public async findRepositoryByRemoteUrl(
    remoteUrl: string,
  ): Promise<Repository | undefined> {
    const [record] = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.remoteUrl, remoteUrl))
      .limit(1);
    return record;
  }

  public async createWorkspace(input: NewWorkspace): Promise<Workspace> {
    const [record] = await this.db
      .insert(workspaces)
      .values({
        ...input,
        desiredState: "RUNNING",
        observedState: "MISSING",
        sandboxBackend: "docker",
      })
      .returning();
    return asWorkspace(requireRecord(record, "WORKSPACE_CREATE_FAILED"));
  }

  public async getWorkspace(id: string): Promise<Workspace | undefined> {
    const [record] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);
    return record ? asWorkspace(record) : undefined;
  }

  public async listForReconciliation(): Promise<Workspace[]> {
    const records = await this.db
      .select()
      .from(workspaces)
      .where(ne(workspaces.observedState, "DESTROYED"));
    return records.map(asWorkspace);
  }

  public async setDesiredState(
    id: string,
    desiredState: DesiredWorkspaceState,
    expectedVersion: number,
  ): Promise<Workspace> {
    return this.updateState(id, expectedVersion, { desiredState });
  }

  public async setObservedState(
    id: string,
    observedState: ObservedWorkspaceState,
    expectedVersion: number,
    lastError: string | null = null,
  ): Promise<Workspace> {
    return this.updateState(id, expectedVersion, { observedState, lastError });
  }

  private async updateState(
    id: string,
    expectedVersion: number,
    values: Partial<{
      desiredState: DesiredWorkspaceState;
      observedState: ObservedWorkspaceState;
      lastError: string | null;
    }>,
  ): Promise<Workspace> {
    const [record] = await this.db
      .update(workspaces)
      .set({ ...values, stateVersion: expectedVersion + 1 })
      .where(
        and(eq(workspaces.id, id), eq(workspaces.stateVersion, expectedVersion)),
      )
      .returning();

    if (!record) {
      throw new RadError(
        "WORKSPACE_STATE_CONFLICT",
        `Workspace ${id} changed during the operation`,
      );
    }
    return asWorkspace(record);
  }
}

function requireRecord<T>(record: T | undefined, code: string): T {
  if (!record) {
    throw new RadError(code, "Database did not return the created record");
  }
  return record;
}

function asWorkspace(record: typeof workspaces.$inferSelect): Workspace {
  return {
    ...record,
    desiredState: record.desiredState as DesiredWorkspaceState,
    observedState: record.observedState as ObservedWorkspaceState,
    sandboxBackend: "docker",
  };
}
