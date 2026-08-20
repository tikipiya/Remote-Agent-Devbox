import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const project = `rad-schema-${process.pid}`;
const environment = {
  ...process.env,
};
const migrations = [
  "packages/workspace-state/migrations/0001_workspace_state.sql",
  "packages/agents/migrations/0001_agent_tasks.sql",
  "packages/git-artifacts/migrations/0001_git_artifacts.sql",
  "packages/git-artifacts/migrations/0002_review_snapshots.sql",
  "packages/approvals/migrations/0001_approval_requests.sql",
  "packages/git-operations/migrations/0001_git_operations.sql",
  "packages/workspace-state/migrations/0002_operational_posture.sql",
  "packages/audit-events/migrations/0001_audit_events.sql",
  "packages/outbox/migrations/0001_outbox_commands.sql",
];

try {
  const mounts = migrations.flatMap((migration, index) => [
    "--volume",
    `${resolve(migration)}:/docker-entrypoint-initdb.d/${String(index + 1).padStart(3, "0")}.sql:ro`,
  ]);
  await docker([
    "run",
    "--detach",
    "--name",
    project,
    "--env",
    "POSTGRES_DB=rad",
    "--env",
    "POSTGRES_USER=rad",
    "--env",
    "POSTGRES_PASSWORD=rad-schema-verification-only",
    ...mounts,
    "postgres:16.4-bookworm",
  ]);
  await waitForDatabase();

  const tableCount = await psql(`
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('instance_metadata', 'audit_events', 'outbox_commands')
  `);
  if (tableCount !== "3") throw new Error("operational schema tables are incomplete");

  const postureColumnCount = await psql(`
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'instance_metadata'
      AND column_name IN ('maintenance_mode', 'maintenance_reason', 'maintenance_started_at')
  `);
  if (postureColumnCount !== "3") throw new Error("maintenance posture columns are incomplete");

  await psql(`
    INSERT INTO audit_events (
      id, event_type, severity, actor_id, subject_type, subject_id,
      security_epoch, deployment_tier, details, occurred_at
    ) VALUES (
      '10000000-0000-4000-8000-000000000001', 'SCHEMA_BOUNDARY_VERIFIED',
      'INFO', NULL, 'instance', 'instance', 1, 1, '{}', NOW()
    )
  `);
  const mutation = await psql(
    "UPDATE audit_events SET severity = 'HIGH' WHERE id = '10000000-0000-4000-8000-000000000001'",
    true,
  );
  if (mutation.exitCode === 0 || !mutation.stderr.includes("append-only")) {
    throw new Error("audit append-only trigger did not reject mutation");
  }

  process.stdout.write("operational posture schema verified\n");
} finally {
  await docker(["rm", "--force", "--volumes", project], true);
}

async function waitForDatabase() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const logs = await docker(["logs", project], true);
    const initializationComplete = `${logs.stdout}\n${logs.stderr}`.includes(
      "PostgreSQL init process complete; ready for start up.",
    );
    const result = await docker(
      ["exec", project, "pg_isready", "-U", "rad", "-d", "rad"],
      true,
    );
    if (initializationComplete && result.exitCode === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("PostgreSQL did not become ready");
}

async function psql(statement, allowFailure = false) {
  const result = await docker(
    ["exec", project, "psql", "-U", "rad", "-d", "rad", "-v", "ON_ERROR_STOP=1", "-Atc", statement],
    allowFailure,
  );
  return allowFailure ? result : result.stdout.trim();
}

async function docker(arguments_, allowFailure = false) {
  try {
    const result = await execFileAsync(
      "docker",
      arguments_,
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120_000,
        windowsHide: true,
        env: environment,
      },
    );
    return { ...result, exitCode: 0 };
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: typeof error.stdout === "string" ? error.stdout : "",
        stderr: typeof error.stderr === "string" ? error.stderr : String(error),
        exitCode: typeof error.code === "number" ? error.code : 1,
      };
    }
    throw error;
  }
}
