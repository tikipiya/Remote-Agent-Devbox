import { loadRuntimeConfig } from "@rad/shared";
import {
  PostgresWorkspaceRepository,
  WorkspaceCoordinator,
  WorkspaceReconciler,
  createDatabase,
} from "@rad/workspace-state";

import { createControlServer } from "./server.js";
import { ExecFileCommandRunner } from "./workspace/command-runner.js";
import { DockerSandboxSupervisor } from "./workspace/docker-supervisor.js";

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
const server = createControlServer({
  config,
  repository,
  supervisor,
  reconciler,
  coordinator,
});

const reconcileTimer = setInterval(() => {
  void reconciler.reconcileAll();
}, config.RAD_RECONCILE_INTERVAL_MS);
reconcileTimer.unref();

const close = async (): Promise<void> => {
  clearInterval(reconcileTimer);
  await server.close();
  await pool.end();
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await server.listen({ host: config.RAD_HOST, port: config.RAD_PORT });

