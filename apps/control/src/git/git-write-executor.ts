import { randomUUID } from "node:crypto";

import type { ApprovalRequest } from "@rad/approvals";
import type { GitArtifact, ReviewSnapshot } from "@rad/git-artifacts";
import type { TokenIssuer } from "@rad/github-token-issuer";
import type {
  CredentialLease,
  CredentialLeaseRepository,
  GitOperation,
  GitOperationRepository,
} from "@rad/git-operations";
import { RadError, type Repository, type RuntimeConfig } from "@rad/shared";
import type { InstanceMetadataRepository } from "@rad/workspace-state";

import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { PullRequestCreator } from "./github-pull-request.js";
import type { GitPushPreparer, PreparedGitPush } from "./git-writer.js";

type GitHubCredentialConfig = Pick<
  RuntimeConfig,
  "RAD_GITHUB_APP_ID" | "RAD_GITHUB_INSTALLATION_ID" | "RAD_GITHUB_PRIVATE_KEY_BASE64"
>;

export interface GitOperationExecutor {
  assertReady(): void;
  execute(input: {
    operation: GitOperation;
    approval: ApprovalRequest;
    review: ReviewSnapshot;
    artifact: GitArtifact;
    repository: Repository;
  }): Promise<GitOperation>;
}

export class CredentialedGitWriteExecutor implements GitOperationExecutor {
  public constructor(
    private readonly config: GitHubCredentialConfig,
    private readonly operations: GitOperationRepository,
    private readonly leases: CredentialLeaseRepository,
    private readonly issuer: TokenIssuer,
    private readonly writer: GitPushPreparer,
    private readonly pullRequests: PullRequestCreator,
    private readonly metadata: Pick<InstanceMetadataRepository, "getSecurityMetadata">,
    private readonly artifactStore: ArtifactStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public assertReady(): void {
    if (
      !this.config.RAD_GITHUB_APP_ID ||
      !this.config.RAD_GITHUB_INSTALLATION_ID ||
      !this.config.RAD_GITHUB_PRIVATE_KEY_BASE64
    ) {
      throw new RadError(
        "GITHUB_APP_NOT_CONFIGURED",
        "GitHub App credentials must be configured before starting a Git operation",
      );
    }
  }

  public async execute(input: {
    operation: GitOperation;
    approval: ApprovalRequest;
    review: ReviewSnapshot;
    artifact: GitArtifact;
    repository: Repository;
  }): Promise<GitOperation> {
    this.assertReady();
    if (input.operation.state !== "WAITING_CREDENTIAL") return input.operation;

    let prepared: PreparedGitPush | undefined;
    let lease: CredentialLease | undefined;
    let operation = input.operation;
    try {
      prepared = await this.writer.prepare(
        this.artifactStore.resolve(input.artifact.storageKey),
        operation.targetCommit,
      );
      await this.requireCurrentContext(input);
      lease = await this.leases.reserve({
        id: randomUUID(),
        operationId: operation.id,
        repositoryId: operation.repositoryId,
        securityEpoch: operation.securityEpoch,
        createdAt: this.now(),
      });
      const credential = await this.issuer.issueForOperation({
        operationId: operation.id,
        repositoryId: operation.repositoryId,
        repositoryRemoteUrl: input.repository.remoteUrl,
        securityEpoch: operation.securityEpoch,
      });
      lease = await this.leases.markIssued(lease.id, this.now(), credential.expiresAt);
      await this.requireCurrentContext(input);
      if (credential.expiresAt.getTime() <= this.now().getTime() + 30_000) {
        throw new RadError("GITHUB_TOKEN_ALREADY_EXPIRED", "Credential expired before Git push");
      }

      operation = await this.operations.transition(
        operation.id,
        "WAITING_CREDENTIAL",
        "PUSHING",
      );
      await prepared.push({
        remoteUrl: input.repository.remoteUrl,
        branchName: operation.branchName,
        expectedRemoteHead: operation.expectedRemoteHead,
        credential,
      });
      const pullRequest = await this.pullRequests.create({
        remoteUrl: input.repository.remoteUrl,
        branchName: operation.branchName,
        baseBranch: input.repository.defaultBranch,
        targetCommit: operation.targetCommit,
        reviewDigest: operation.reviewDigest,
        token: credential.token,
      });
      lease = await this.leases.markConsumed(lease.id, this.now());
      return await this.operations.transition(operation.id, "PUSHING", "SUCCEEDED", {
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.url,
        completedAt: this.now(),
      });
    } catch (error) {
      return await this.recordFailure(operation, lease, error);
    } finally {
      await prepared?.dispose();
    }
  }

  private async requireCurrentContext(input: {
    operation: GitOperation;
    approval: ApprovalRequest;
    review: ReviewSnapshot;
  }): Promise<void> {
    const metadata = await this.metadata.getSecurityMetadata();
    if (
      input.approval.status !== "APPROVED" ||
      input.approval.expiresAt <= this.now() ||
      input.approval.reviewDigest !== input.operation.reviewDigest ||
      input.approval.validatorProfileDigest !== input.operation.validatorProfileDigest ||
      input.approval.securityEpoch !== input.operation.securityEpoch ||
      input.review.reviewDigest !== input.operation.reviewDigest ||
      input.review.validatorProfileDigest !== input.operation.validatorProfileDigest ||
      input.review.securityEpoch !== input.operation.securityEpoch ||
      !metadata ||
      metadata.maintenanceMode ||
      metadata.securityEpoch !== input.operation.securityEpoch ||
      metadata.deploymentTier !== input.review.deploymentTier ||
      metadata.securityPostureHash !== input.review.securityPostureHash
    ) {
      throw new RadError(
        "GIT_WRITE_CONTEXT_STALE",
        "Approval or security context changed before credential use",
      );
    }
  }

  private async recordFailure(
    operation: GitOperation,
    lease: CredentialLease | undefined,
    error: unknown,
  ): Promise<GitOperation> {
    const code = error instanceof RadError ? error.code : "GIT_WRITE_FAILED";
    if (!lease) {
      return this.operations.transition(operation.id, "WAITING_CREDENTIAL", "FAILED", {
        errorCode: code,
        errorMessage: "Git write preparation failed",
        completedAt: this.now(),
      });
    }
    if (lease.state === "RESERVED") {
      await this.leases.markFailed(lease.id, this.now(), code);
      return this.operations.transition(operation.id, "WAITING_CREDENTIAL", "FAILED", {
        errorCode: code,
        errorMessage: "Credential issuance failed",
        completedAt: this.now(),
      });
    }
    if (code === "REMOTE_CAS_CONFLICT" && operation.state === "PUSHING") {
      await this.leases.markConsumed(lease.id, this.now());
      return this.operations.transition(operation.id, "PUSHING", "CONFLICT", {
        errorCode: code,
        errorMessage: "Remote branch compare-and-swap failed",
        completedAt: this.now(),
      });
    }

    await this.leases.markUncertain(lease.id, this.now(), code);
    const expectedState = operation.state === "PUSHING" ? "PUSHING" : "WAITING_CREDENTIAL";
    return this.operations.transition(operation.id, expectedState, "FAILED", {
      errorCode: code,
      errorMessage: "Credential was issued but the external result is not safely retryable",
      completedAt: this.now(),
    });
  }
}
