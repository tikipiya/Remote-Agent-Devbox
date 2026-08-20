import { loadRuntimeConfig } from "@rad/shared";
import { PostgresAgentTaskRepository } from "@rad/agents";
import { OutboxDispatcher, PostgresOutboxRepository } from "@rad/outbox";
import { PostgresApprovalRepository } from "@rad/approvals";
import {
  PostgresCredentialLeaseRepository,
  PostgresGitOperationRepository,
} from "@rad/git-operations";
import { GitHubAppTokenIssuer } from "@rad/github-token-issuer";
import {
  PostgresGitArtifactRepository,
  PostgresReviewSnapshotRepository,
} from "@rad/git-artifacts";
import {
  PostgresWorkspaceRepository,
  WorkspaceReconciler,
  createDatabase,
} from "@rad/workspace-state";

import { createControlServer } from "./server.js";
import { ExecFileCommandRunner } from "./workspace/command-runner.js";
import { DockerSandboxSupervisor } from "./workspace/docker-supervisor.js";
import { TaskService } from "./tasks/task-service.js";
import { startDiscordBot } from "./discord/bot.js";
import { ArtifactService } from "./artifacts/artifact-service.js";
import { ArtifactStore } from "./artifacts/artifact-store.js";
import { DockerValidatorLauncher } from "./validation/docker-validator.js";
import { ReviewService } from "./validation/review-service.js";
import { ApprovalService } from "./approvals/approval-service.js";
import { ExactRevalidator } from "./validation/exact-revalidator.js";
import { GitOperationService } from "./git/git-operation-service.js";
import { GitRemoteHeadObserver } from "./git/remote-head-observer.js";
import { CredentialedGitWriteExecutor } from "./git/git-write-executor.js";
import { TrustedGitWriter } from "./git/git-writer.js";
import { GitHubPullRequestCreator } from "./git/github-pull-request.js";
import { MaintenanceModeGuard } from "./security/maintenance-guard.js";
import { buildSecurityPostureHash } from "./security/security-posture.js";
import {
  OutboxWorkspaceCoordinator,
  WorkspaceOutboxHandler,
} from "./workspace/outbox-coordinator.js";

const config = loadRuntimeConfig();
const { db, pool } = createDatabase(config.RAD_DATABASE_URL);
const repository = new PostgresWorkspaceRepository(db);
await repository.synchronizeSecurityMetadata({
  deploymentTier: config.RAD_DEPLOYMENT_TIER,
  securityPostureHash: buildSecurityPostureHash(config),
});
const commandRunner = new ExecFileCommandRunner();
const operationalGuard = new MaintenanceModeGuard(repository);
const supervisor = new DockerSandboxSupervisor(
  config,
  commandRunner,
  async (id) => repository.getRepository(id),
);
const reconciler = new WorkspaceReconciler(repository, supervisor);
const outboxRepository = new PostgresOutboxRepository(db);
await outboxRepository.recoverStale(
  new Date(Date.now() - Math.max(30_000, config.RAD_RECONCILE_INTERVAL_MS * 2)),
  new Date(),
);
const outboxDispatcher = new OutboxDispatcher(
  outboxRepository,
  new WorkspaceOutboxHandler(reconciler),
);
const coordinator = new OutboxWorkspaceCoordinator(
  outboxRepository,
  outboxDispatcher,
  repository,
);
const taskService = new TaskService(
  new PostgresAgentTaskRepository(db),
  repository,
  supervisor,
  operationalGuard,
);
const artifactStore = new ArtifactStore(
  config.RAD_ARTIFACT_ROOT,
  config.RAD_ARTIFACT_MAX_BYTES,
);
await artifactStore.initialize();
const artifactRepository = new PostgresGitArtifactRepository(db);
const reviewRepository = new PostgresReviewSnapshotRepository(db);
const approvalRepository = new PostgresApprovalRepository(db);
const operationRepository = new PostgresGitOperationRepository(db);
const credentialLeaseRepository = new PostgresCredentialLeaseRepository(db);
const artifactService = new ArtifactService(
  artifactRepository,
  repository,
  supervisor,
  artifactStore,
);
const reviewService = new ReviewService(
  artifactRepository,
  reviewRepository,
  repository,
  repository,
  new DockerValidatorLauncher(config, commandRunner),
);
const approvalService = new ApprovalService(
  approvalRepository,
  reviewRepository,
  repository,
  config.RAD_APPROVAL_TTL_SECONDS,
  operationalGuard,
);
const gitOperationService = new GitOperationService(
  approvalRepository,
  reviewRepository,
  artifactRepository,
  repository,
  operationRepository,
  new GitRemoteHeadObserver(commandRunner),
  new ExactRevalidator(
    repository,
    new DockerValidatorLauncher(config, commandRunner),
  ),
  new CredentialedGitWriteExecutor(
    config,
    operationRepository,
    credentialLeaseRepository,
    new GitHubAppTokenIssuer(config, repository),
    new TrustedGitWriter(commandRunner),
    new GitHubPullRequestCreator(config.RAD_GITHUB_API_URL),
    repository,
    artifactStore,
  ),
  operationalGuard,
);
const server = createControlServer({
  config,
  repository,
  supervisor,
  reconciler,
  coordinator,
  taskService,
  artifactService,
  reviewService,
  approvalService,
  gitOperationService,
  operationalGuard,
});

const reconcileTimer = setInterval(() => {
  void outboxDispatcher.dispatchAvailable();
  void reconciler.reconcileAll();
}, config.RAD_RECONCILE_INTERVAL_MS);
reconcileTimer.unref();

const close = async (): Promise<void> => {
  clearInterval(reconcileTimer);
  await server.close();
  discordBot?.destroy();
  await pool.end();
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await server.listen({ host: config.RAD_HOST, port: config.RAD_PORT });
const discordBot = await startDiscordBot({
  config,
  repository,
  reconciler,
  taskService,
  operationalGuard,
});
