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

import { repositories, workspaces } from "./schema.js";

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

export function createDatabase(databaseUrl: string): {
  db: NodePgDatabase;
  pool: Pool;
} {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return { db: drizzle(pool), pool };
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async createRepository(input: NewRepository): Promise<Repository> {
    const [record] = await this.db
      .insert(repositories)
      .values(input)
      .returning();
    return requireRecord(record, "REPOSITORY_CREATE_FAILED");
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
