import { PostgresAuditEventRepository } from "@rad/audit-events";
import { loadRuntimeConfig } from "@rad/shared";
import {
  PostgresWorkspaceRepository,
  WorkspaceReconciler,
  createDatabase,
} from "@rad/workspace-state";

import { ExecFileCommandRunner } from "./workspace/command-runner.js";
import { DockerSandboxSupervisor } from "./workspace/docker-supervisor.js";
import {
  PostgresSecurityMigrationRepository,
  SecurityMigrationService,
} from "./security/security-migration.js";
import { buildSecurityPostureHash } from "./security/security-posture.js";

const [command, ...arguments_] = process.argv.slice(2);
if (command !== "security-migrate") {
  fail("Usage: admin security-migrate --actor <uuid> --reason <text> --confirm <exact> [--rotate-epoch]");
}

const config = loadRuntimeConfig();
const { db, pool } = createDatabase(config.RAD_DATABASE_URL);
try {
  const workspaceRepository = new PostgresWorkspaceRepository(db);
  const commandRunner = new ExecFileCommandRunner();
  const supervisor = new DockerSandboxSupervisor(
    config,
    commandRunner,
    async (id) => workspaceRepository.getRepository(id),
  );
  const service = new SecurityMigrationService(
    workspaceRepository,
    new PostgresSecurityMigrationRepository(db),
    new PostgresAuditEventRepository(db),
    new WorkspaceReconciler(workspaceRepository, supervisor),
  );
  const result = await service.migrate({
    targetTier: config.RAD_DEPLOYMENT_TIER,
    targetPostureHash: buildSecurityPostureHash(config),
    initiatedBy: requiredArgument(arguments_, "--actor"),
    reason: requiredArgument(arguments_, "--reason"),
    confirmation: requiredArgument(arguments_, "--confirm"),
    forceEpochRotation: arguments_.includes("--rotate-epoch"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}

function requiredArgument(arguments_: string[], name: string): string {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith("--")) fail(`Missing ${name}`);
  return value;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
