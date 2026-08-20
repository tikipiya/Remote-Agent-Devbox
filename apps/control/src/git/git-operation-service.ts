import { randomUUID } from "node:crypto";

import type { ApprovalRepository, ApprovalRequest } from "@rad/approvals";
import type { GitArtifactRepository, ReviewSnapshot, ReviewSnapshotRepository } from "@rad/git-artifacts";
import type { GitOperation, GitOperationRepository } from "@rad/git-operations";
import { RadError } from "@rad/shared";
import type { WorkspaceRepository } from "@rad/workspace-state";

import type { ExactRevalidator } from "../validation/exact-revalidator.js";
import type { RemoteHeadObserver } from "./remote-head-observer.js";
import type { GitOperationExecutor } from "./git-write-executor.js";
import type { OperationalGuard } from "../security/maintenance-guard.js";

export class GitOperationService {
  public constructor(
    private readonly approvals: Pick<ApprovalRepository, "get">,
    private readonly reviews: Pick<ReviewSnapshotRepository, "get">,
    private readonly artifacts: Pick<GitArtifactRepository, "get">,
    private readonly workspaces: Pick<WorkspaceRepository, "getWorkspace" | "getRepository">,
    private readonly operations: GitOperationRepository,
    private readonly remoteHeads: RemoteHeadObserver,
    private readonly revalidator: Pick<ExactRevalidator, "revalidate">,
    private readonly executor: GitOperationExecutor,
    private readonly operationalGuard: OperationalGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async start(approvalId: string): Promise<GitOperation> {
    await this.operationalGuard.assertAvailable("Git operation start");
    const approval = await this.requireApproval(approvalId);
    const review = await this.requireReview(approval);
    const artifact = await this.artifacts.get(review.artifactId);
    if (!artifact) {
      throw new RadError("ARTIFACT_NOT_FOUND", `Artifact ${review.artifactId} not found`);
    }
    const workspace = await this.workspaces.getWorkspace(review.workspaceId);
    if (!workspace) {
      throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${review.workspaceId} not found`);
    }
    const repository = await this.workspaces.getRepository(review.repositoryId);
    if (!repository) {
      throw new RadError("REPOSITORY_NOT_FOUND", `Repository ${review.repositoryId} not found`);
    }
    if (workspace.repositoryId !== repository.id) {
      throw new RadError("GIT_WORKSPACE_REPOSITORY_MISMATCH", "Workspace repository binding changed");
    }
    if (
      workspace.branchName === repository.defaultBranch ||
      workspace.branchName !== `agent/${workspace.id}`
    ) {
      throw new RadError(
        "PROTECTED_BRANCH_PUSH_BLOCKED",
        "Git writes are allowed only to the workspace's dedicated agent branch",
      );
    }

    let operation = await this.operations.findByApproval(approval.id);
    if (!operation) {
      this.executor.assertReady();
      const expectedRemoteHead = await this.remoteHeads.observe(
        repository.remoteUrl,
        workspace.branchName,
      );
      operation = await this.operations.createBound({
        id: randomUUID(),
        workspaceId: workspace.id,
        repositoryId: repository.id,
        reviewSnapshotId: review.id,
        approvalId: approval.id,
        branchName: workspace.branchName,
        targetCommit: review.targetCommit,
        expectedRemoteHead,
        reviewDigest: review.reviewDigest,
        validatorProfileDigest: review.validatorProfileDigest,
        securityEpoch: review.securityEpoch,
        createdAt: this.now(),
      });
    }

    if (operation.state === "PENDING") {
      operation = await this.operations.transition(operation.id, "PENDING", "VALIDATING", {
        startedAt: this.now(),
      });
    }
    if (operation.state === "VALIDATING") {
      try {
        this.requireApprovalStillUsable(approval, review);
        await this.revalidator.revalidate(review, artifact, repository.defaultBranch);
        operation = await this.operations.transition(
          operation.id,
          "VALIDATING",
          "WAITING_CREDENTIAL",
        );
      } catch (error) {
        const code = error instanceof RadError ? error.code : "FINAL_REVALIDATION_FAILED";
        const stale = code.startsWith("FINAL_") && code.endsWith("MISMATCH");
        return await this.operations.transition(
          operation.id,
          "VALIDATING",
          stale ? "STALE" : "FAILED",
          stale
            ? { staleReason: code, completedAt: this.now() }
            : { errorCode: code, errorMessage: "Final revalidation failed", completedAt: this.now() },
        );
      }
    }
    if (operation.state !== "WAITING_CREDENTIAL") return operation;
    return this.executor.execute({ operation, approval, review, artifact, repository });
  }

  public get(id: string): Promise<GitOperation | undefined> {
    return this.operations.get(id);
  }

  private async requireApproval(id: string): Promise<ApprovalRequest> {
    const approval = await this.approvals.get(id);
    if (!approval) throw new RadError("APPROVAL_NOT_FOUND", `Approval ${id} not found`);
    return approval;
  }

  private async requireReview(approval: ApprovalRequest): Promise<ReviewSnapshot> {
    const review = await this.reviews.get(approval.reviewSnapshotId);
    if (!review) {
      throw new RadError("REVIEW_NOT_FOUND", `Review ${approval.reviewSnapshotId} not found`);
    }
    if (
      review.workspaceId !== approval.workspaceId ||
      review.reviewDigest !== approval.reviewDigest ||
      review.validatorProfileDigest !== approval.validatorProfileDigest ||
      review.securityEpoch !== approval.securityEpoch
    ) {
      throw new RadError("APPROVAL_REVIEW_MISMATCH", "Approval no longer matches its review");
    }
    return review;
  }

  private requireApprovalStillUsable(
    approval: ApprovalRequest,
    review: ReviewSnapshot,
  ): void {
    if (
      approval.status !== "APPROVED" ||
      approval.expiresAt <= this.now() ||
      approval.reviewDigest !== review.reviewDigest ||
      approval.validatorProfileDigest !== review.validatorProfileDigest ||
      approval.securityEpoch !== review.securityEpoch
    ) {
      throw new RadError(
        "FINAL_APPROVAL_MISMATCH",
        "Approval expired or changed before final revalidation",
      );
    }
  }
}
