import { loadRuntimeConfig } from "@rad/shared";
import { PostgresAgentTaskRepository } from "@rad/agents";
import { PostgresApprovalRepository } from "@rad/approvals";
import {
  PostgresCredentialLeaseRepository,
  PostgresGitOperationRepository,
} from "@rad/git-operations";
import { GitHubAppTokenIssuer } from "@rad/github-token-issuer";
import {
  PostgresGitArtifactRepository,
  PostgresReviewSnapshotRepository,
  digestCanonical,
} from "@rad/git-artifacts";
import {
  PostgresWorkspaceRepository,
  WorkspaceCoordinator,
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

const config = loadRuntimeConfig();
const { db, pool } = createDatabase(config.RAD_DATABASE_URL);
const repository = new PostgresWorkspaceRepository(db);
await repository.synchronizeSecurityMetadata({
  deploymentTier: config.RAD_DEPLOYMENT_TIER,
  securityPostureHash: digestCanonical({
    schemaVersion: "tier1-security-posture-1",
    deploymentTier: config.RAD_DEPLOYMENT_TIER,
    sandboxBackend: config.RAD_SANDBOX_BACKEND,
    workspaceImage: config.RAD_WORKSPACE_IMAGE,
    workspaceNetwork: config.RAD_WORKSPACE_NETWORK,
    controlNetwork: config.RAD_CONTROL_NETWORK,
    workspaceMemoryMegabytes: config.RAD_WORKSPACE_MEMORY_MB,
    workspaceCpus: config.RAD_WORKSPACE_CPUS,
    workspacePids: config.RAD_WORKSPACE_PIDS,
    artifactRoot: config.RAD_ARTIFACT_ROOT,
    artifactVolume: config.RAD_ARTIFACT_VOLUME,
    artifactMaxBytes: config.RAD_ARTIFACT_MAX_BYTES,
    validatorImage: config.RAD_VALIDATOR_IMAGE,
    validatorImageDigest: config.RAD_VALIDATOR_IMAGE_DIGEST || null,
    validatorMemoryMegabytes: config.RAD_VALIDATOR_MEMORY_MB,
    validatorCpus: config.RAD_VALIDATOR_CPUS,
    validatorPids: config.RAD_VALIDATOR_PIDS,
    validatorTimeoutMilliseconds: config.RAD_VALIDATOR_TIMEOUT_MS,
    approvalTtlSeconds: config.RAD_APPROVAL_TTL_SECONDS,
    githubApiUrl: config.RAD_GITHUB_API_URL,
    githubAppId: config.RAD_GITHUB_APP_ID || null,
    githubInstallationId: config.RAD_GITHUB_INSTALLATION_ID ?? null,
    githubPrivateKeyConfigured: Boolean(config.RAD_GITHUB_PRIVATE_KEY_BASE64),
  }),
});
const commandRunner = new ExecFileCommandRunner();
const operationalGuard = new MaintenanceModeGuard(repository);
const supervisor = new DockerSandboxSupervisor(
  config,
  commandRunner,
  async (id) => repository.getRepository(id),
);
const reconciler = new WorkspaceReconciler(repository, supervisor);
const coordinator = new WorkspaceCoordinator(repository, reconciler);
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
