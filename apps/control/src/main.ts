import { loadRuntimeConfig } from "@rad/shared";
import { PostgresAgentTaskRepository } from "@rad/agents";
import { PostgresGitArtifactRepository } from "@rad/git-artifacts";
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

const config = loadRuntimeConfig();
const { db, pool } = createDatabase(config.RAD_DATABASE_URL);
const repository = new PostgresWorkspaceRepository(db);
const supervisor = new DockerSandboxSupervisor(
  config,
  new ExecFileCommandRunner(),
  async (id) => repository.getRepository(id),
);
const reconciler = new WorkspaceReconciler(repository, supervisor);
const coordinator = new WorkspaceCoordinator(repository, reconciler);
const taskService = new TaskService(
  new PostgresAgentTaskRepository(db),
  repository,
  supervisor,
);
const artifactStore = new ArtifactStore(
  config.RAD_ARTIFACT_ROOT,
  config.RAD_ARTIFACT_MAX_BYTES,
);
await artifactStore.initialize();
const artifactService = new ArtifactService(
  new PostgresGitArtifactRepository(db),
  repository,
  supervisor,
  artifactStore,
);
const server = createControlServer({
  config,
  repository,
  supervisor,
  reconciler,
  coordinator,
  taskService,
  artifactService,
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
});
