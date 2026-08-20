import { describe, expect, it } from "vitest";

import type { ApprovalRequest } from "@rad/approvals";
import type { GitArtifact, ReviewSnapshot } from "@rad/git-artifacts";
import type {
  GitOperation,
  GitOperationRepository,
  GitOperationState,
  NewGitOperation,
} from "@rad/git-operations";
import { RadError, type Repository, type Workspace } from "@rad/shared";

import { GitOperationService } from "./git-operation-service.js";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const repositoryId = "10000000-0000-4000-8000-000000000001";
const reviewId = "30000000-0000-4000-8000-000000000001";
const approvalId = "40000000-0000-4000-8000-000000000001";
const artifactId = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-01-01T12:00:00Z");
const review = {
  id: reviewId,
  workspaceId,
  repositoryId,
  artifactId,
  targetCommit: "a".repeat(40),
  reviewDigest: `sha256:${"b".repeat(64)}`,
  validatorProfileDigest: `sha256:${"c".repeat(64)}`,
  securityEpoch: 5,
} as ReviewSnapshot;
const approval = {
  id: approvalId,
  workspaceId,
  reviewSnapshotId: reviewId,
  reviewDigest: review.reviewDigest,
  validatorProfileDigest: review.validatorProfileDigest,
  securityEpoch: review.securityEpoch,
  status: "APPROVED",
  expiresAt: new Date("2026-01-01T13:00:00Z"),
} as ApprovalRequest;
const artifact = { id: artifactId } as GitArtifact;
const workspace = {
  id: workspaceId,
  repositoryId,
  branchName: `agent/${workspaceId}`,
} as Workspace;
const repository = {
  id: repositoryId,
  remoteUrl: "https://github.com/example/repo.git",
  defaultBranch: "main",
} as Repository;

class MemoryOperations implements GitOperationRepository {
  public record: GitOperation | undefined;

  public async createBound(input: NewGitOperation): Promise<GitOperation> {
    this.record = {
      ...input,
      state: "PENDING",
      staleReason: null,
      errorCode: null,
      errorMessage: null,
      pullRequestNumber: null,
      pullRequestUrl: null,
      startedAt: null,
      completedAt: null,
    };
    return this.record;
  }

  public async get(id: string): Promise<GitOperation | undefined> {
    return this.record?.id === id ? this.record : undefined;
  }

  public async findByApproval(id: string): Promise<GitOperation | undefined> {
    return this.record?.approvalId === id ? this.record : undefined;
  }

  public async transition(
    id: string,
    expectedState: GitOperationState,
    nextState: GitOperationState,
    values: Partial<GitOperation> = {},
  ): Promise<GitOperation> {
    if (!this.record || this.record.id !== id || this.record.state !== expectedState) {
      throw new Error("state conflict");
    }
    this.record = { ...this.record, ...values, state: nextState };
    return this.record;
  }
}

describe("GitOperationService", () => {
  it("records remote CAS input and reaches credential wait only after exact revalidation", async () => {
    const operations = new MemoryOperations();
    let revalidationCalls = 0;
    const service = createService(operations, workspace, {
      revalidate: async () => {
        revalidationCalls += 1;
      },
    });

    const operation = await service.start(approvalId);

    expect(operation.state).toBe("WAITING_CREDENTIAL");
    expect(operation.expectedRemoteHead).toBe("d".repeat(40));
    expect(operation.branchName).toBe(`agent/${workspaceId}`);
    expect(revalidationCalls).toBe(1);
  });

  it("blocks a default or non-dedicated branch before remote access", async () => {
    let remoteCalls = 0;
    const service = createService(
      new MemoryOperations(),
      { ...workspace, branchName: "main" },
      { revalidate: async () => undefined },
      () => {
        remoteCalls += 1;
      },
    );
    await expect(service.start(approvalId)).rejects.toThrow("dedicated agent branch");
    expect(remoteCalls).toBe(0);
  });

  it("records exact revalidation mismatch as STALE", async () => {
    const service = createService(new MemoryOperations(), workspace, {
      revalidate: async () => {
        throw new RadError("FINAL_REVIEW_DIGEST_MISMATCH", "changed");
      },
    });
    const operation = await service.start(approvalId);
    expect(operation.state).toBe("STALE");
    expect(operation.staleReason).toBe("FINAL_REVIEW_DIGEST_MISMATCH");
  });
});

function createService(
  operations: GitOperationRepository,
  currentWorkspace: Workspace,
  revalidator: { revalidate: () => Promise<void> },
  onRemote = () => undefined,
): GitOperationService {
  return new GitOperationService(
    { get: async () => approval },
    { get: async () => review },
    { get: async () => artifact },
    {
      getWorkspace: async () => currentWorkspace,
      getRepository: async () => repository,
    },
    operations,
    {
      observe: async () => {
        onRemote();
        return "d".repeat(40);
      },
    },
    revalidator,
    {
      assertReady: () => undefined,
      execute: async ({ operation }) => operation,
    },
    () => now,
  );
}
