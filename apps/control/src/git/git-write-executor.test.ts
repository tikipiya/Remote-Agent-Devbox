import { describe, expect, it } from "vitest";

import type { ApprovalRequest } from "@rad/approvals";
import type { GitArtifact, ReviewSnapshot } from "@rad/git-artifacts";
import type {
  CredentialLease,
  CredentialLeaseRepository,
  GitOperation,
  GitOperationRepository,
  GitOperationState,
  NewGitOperation,
} from "@rad/git-operations";
import { RadError, type Repository } from "@rad/shared";

import { ArtifactStore } from "../artifacts/artifact-store.js";
import { CredentialedGitWriteExecutor } from "./git-write-executor.js";

const now = new Date("2026-01-01T12:00:00Z");
const operation = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  repositoryId: "30000000-0000-4000-8000-000000000001",
  reviewSnapshotId: "40000000-0000-4000-8000-000000000001",
  approvalId: "50000000-0000-4000-8000-000000000001",
  branchName: "agent/20000000-0000-4000-8000-000000000001",
  targetCommit: "a".repeat(40),
  expectedRemoteHead: null,
  reviewDigest: `sha256:${"b".repeat(64)}`,
  validatorProfileDigest: `sha256:${"c".repeat(64)}`,
  securityEpoch: 7,
  state: "WAITING_CREDENTIAL",
  staleReason: null,
  errorCode: null,
  errorMessage: null,
  pullRequestNumber: null,
  pullRequestUrl: null,
  createdAt: now,
  startedAt: now,
  completedAt: null,
} satisfies GitOperation;
const approval = {
  id: operation.approvalId,
  status: "APPROVED",
  expiresAt: new Date("2026-01-01T13:00:00Z"),
  reviewDigest: operation.reviewDigest,
  validatorProfileDigest: operation.validatorProfileDigest,
  securityEpoch: 7,
} as ApprovalRequest;
const review = {
  id: operation.reviewSnapshotId,
  reviewDigest: operation.reviewDigest,
  validatorProfileDigest: operation.validatorProfileDigest,
  securityEpoch: 7,
  deploymentTier: 1,
  securityPostureHash: `sha256:${"d".repeat(64)}`,
} as ReviewSnapshot;
const artifact = {
  storageKey: `sha256/${"e".repeat(64)}/artifact.bundle`,
} as GitArtifact;
const repository = {
  id: operation.repositoryId,
  remoteUrl: "https://github.com/example/repo.git",
  defaultBranch: "main",
} as Repository;

class MemoryOperations implements GitOperationRepository {
  public record: GitOperation = operation;
  public createBound(_input: NewGitOperation): Promise<GitOperation> {
    throw new Error("not used");
  }
  public async get(): Promise<GitOperation> {
    return this.record;
  }
  public async findByApproval(): Promise<GitOperation> {
    return this.record;
  }
  public async transition(
    _id: string,
    expected: GitOperationState,
    next: GitOperationState,
    values: Partial<GitOperation> = {},
  ): Promise<GitOperation> {
    if (this.record.state !== expected) throw new Error("state conflict");
    this.record = { ...this.record, ...values, state: next };
    return this.record;
  }
}

class MemoryLeases implements CredentialLeaseRepository {
  public record: CredentialLease | undefined;
  public async reserve(input: {
    id: string;
    operationId: string;
    repositoryId: string;
    securityEpoch: number;
    createdAt: Date;
  }): Promise<CredentialLease> {
    this.record = {
      ...input,
      state: "RESERVED",
      issuedAt: null,
      expiresAt: null,
      consumedAt: null,
      failureReason: null,
    };
    return this.record;
  }
  public async markIssued(id: string, issuedAt: Date, expiresAt: Date): Promise<CredentialLease> {
    return this.update(id, { state: "ISSUED", issuedAt, expiresAt });
  }
  public async markConsumed(id: string, consumedAt: Date): Promise<CredentialLease> {
    return this.update(id, { state: "CONSUMED", consumedAt });
  }
  public async markFailed(id: string, _at: Date, reason: string): Promise<CredentialLease> {
    return this.update(id, { state: "FAILED", failureReason: reason });
  }
  public async markUncertain(id: string, _at: Date, reason: string): Promise<CredentialLease> {
    return this.update(id, { state: "UNCERTAIN", failureReason: reason });
  }
  private update(id: string, values: Partial<CredentialLease>): CredentialLease {
    if (!this.record || this.record.id !== id) throw new Error("missing lease");
    this.record = { ...this.record, ...values };
    return this.record;
  }
}

describe("CredentialedGitWriteExecutor", () => {
  it("uses the credential once, creates a PR, and consumes the lease", async () => {
    const operations = new MemoryOperations();
    const leases = new MemoryLeases();
    let pushedToken = "";
    let disposed = false;
    const executor = createExecutor(operations, leases, {
      push: async ({ credential }) => {
        pushedToken = credential.token;
      },
      dispose: async () => {
        disposed = true;
      },
    });

    const result = await executor.execute({ operation, approval, review, artifact, repository });

    expect(result.state).toBe("SUCCEEDED");
    expect(result.pullRequestUrl).toBe("https://github.com/example/repo/pull/8");
    expect(leases.record?.state).toBe("CONSUMED");
    expect(pushedToken).toBe("ephemeral");
    expect(disposed).toBe(true);
  });

  it("records a definitive force-with-lease rejection as CONFLICT", async () => {
    const operations = new MemoryOperations();
    const leases = new MemoryLeases();
    const executor = createExecutor(operations, leases, {
      push: async () => {
        throw new RadError("REMOTE_CAS_CONFLICT", "changed");
      },
      dispose: async () => undefined,
    });
    const result = await executor.execute({ operation, approval, review, artifact, repository });
    expect(result.state).toBe("CONFLICT");
    expect(result.errorCode).toBe("REMOTE_CAS_CONFLICT");
    expect(leases.record?.state).toBe("CONSUMED");
  });
});

function createExecutor(
  operations: GitOperationRepository,
  leases: CredentialLeaseRepository,
  prepared: { push: (input: any) => Promise<void>; dispose: () => Promise<void> },
) {
  return new CredentialedGitWriteExecutor(
    {
      RAD_GITHUB_APP_ID: "1",
      RAD_GITHUB_INSTALLATION_ID: 2,
      RAD_GITHUB_PRIVATE_KEY_BASE64: "key",
    },
    operations,
    leases,
    {
      issueForOperation: async () => ({
        token: "ephemeral",
        expiresAt: new Date("2026-01-01T13:00:00Z"),
      }),
    },
    { prepare: async () => prepared },
    {
      create: async () => ({ number: 8, url: "https://github.com/example/repo/pull/8" }),
    },
    {
      getSecurityMetadata: async () => ({
        securityEpoch: 7,
        deploymentTier: 1,
        securityPostureHash: review.securityPostureHash,
        updatedAt: now,
      }),
      synchronizeSecurityMetadata: async () => {
        throw new Error("not used");
      },
    },
    new ArtifactStore("C:\\rad-test", 100),
    () => now,
  );
}
