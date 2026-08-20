import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  GitArtifact,
  GitArtifactRepository,
  NewGitArtifact,
  Sha256Digest,
} from "@rad/git-artifacts";
import type { Repository, Workspace } from "@rad/shared";

import { ArtifactService, type GitBundleExporter } from "./artifact-service.js";
import { ArtifactStore } from "./artifact-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("ArtifactService", () => {
  it("persists only the identity computed by the trusted store", async () => {
    const workspace = readyWorkspace();
    const repository = testRepository(workspace.repositoryId);
    const root = await mkdtemp(join(tmpdir(), "rad-artifact-service-"));
    roots.push(root);
    const store = new ArtifactStore(root, 1024);
    await store.initialize();
    const artifacts = new MemoryArtifactRepository();
    const exporter: GitBundleExporter = {
      async exportGitBundle(_workspace, _repository, destinationPath) {
        await writeFile(destinationPath, "bundle bytes");
      },
    };
    const service = new ArtifactService(
      artifacts,
      {
        getWorkspace: async () => workspace,
        getRepository: async () => repository,
      },
      exporter,
      store,
    );

    const artifact = await service.capture(workspace.id);

    expect(artifact.workspaceId).toBe(workspace.id);
    expect(artifact.repositoryId).toBe(repository.id);
    expect(artifact.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(artifact.status).toBe("STAGED");
    await expect(store.read(artifact.storageKey)).resolves.toEqual(
      Buffer.from("bundle bytes"),
    );
  });

  it("rejects capture unless the Workspace is ready", async () => {
    const workspace = { ...readyWorkspace(), observedState: "BUSY" as const };
    const root = await mkdtemp(join(tmpdir(), "rad-artifact-service-"));
    roots.push(root);
    const store = new ArtifactStore(root, 1024);
    await store.initialize();
    const service = new ArtifactService(
      new MemoryArtifactRepository(),
      {
        getWorkspace: async () => workspace,
        getRepository: async () => testRepository(workspace.repositoryId),
      },
      { exportGitBundle: async () => undefined },
      store,
    );

    await expect(service.capture(workspace.id)).rejects.toThrow(/not ready/);
  });
});

class MemoryArtifactRepository implements GitArtifactRepository {
  private readonly records = new Map<string, GitArtifact>();

  public async create(input: NewGitArtifact): Promise<GitArtifact> {
    const artifact: GitArtifact = {
      ...input,
      status: "STAGED",
      rejectionReason: null,
      createdAt: new Date(),
      validatedAt: null,
    };
    this.records.set(artifact.id, artifact);
    return artifact;
  }

  public async get(id: string): Promise<GitArtifact | undefined> {
    return this.records.get(id);
  }

  public async findByDigest(digest: Sha256Digest): Promise<GitArtifact | undefined> {
    return [...this.records.values()].find(
      (artifact) => artifact.artifactDigest === digest,
    );
  }

  public async markValidated(id: string): Promise<GitArtifact> {
    return this.transition(id, "VALIDATED", null);
  }

  public async markRejected(id: string, reason: string): Promise<GitArtifact> {
    return this.transition(id, "REJECTED", reason);
  }

  private transition(
    id: string,
    status: "VALIDATED" | "REJECTED",
    rejectionReason: string | null,
  ): GitArtifact {
    const artifact = this.records.get(id);
    if (!artifact) throw new Error("missing artifact");
    const updated = {
      ...artifact,
      status,
      rejectionReason,
      validatedAt: new Date(),
    };
    this.records.set(id, updated);
    return updated;
  }
}

function readyWorkspace(): Workspace {
  const id = randomUUID();
  return {
    id,
    ownerUserId: randomUUID(),
    repositoryId: randomUUID(),
    desiredState: "RUNNING",
    observedState: "READY",
    stateVersion: 1,
    sandboxBackend: "docker",
    branchName: `agent/${id}`,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    lastError: null,
  };
}

function testRepository(id: string): Repository {
  return {
    id,
    remoteUrl: "https://github.com/example/project.git",
    defaultBranch: "main",
    createdAt: new Date(),
  };
}
