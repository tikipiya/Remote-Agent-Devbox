import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const composePath = new URL("../../docker-compose.yml", import.meta.url);
const workspaceDockerfilePath = new URL(
  "../../images/workspace-node/Dockerfile",
  import.meta.url,
);
const controlDockerfilePath = new URL(
  "../../images/control/Dockerfile",
  import.meta.url,
);
const supervisorPath = new URL(
  "../../apps/control/src/workspace/docker-supervisor.ts",
  import.meta.url,
);
const workspaceEntrypointPath = new URL(
  "../../images/workspace-node/entrypoint.sh",
  import.meta.url,
);

describe("Security Gate A", () => {
  it("does not mount the Docker socket into a workspace service", async () => {
    const compose = await readFile(composePath, "utf8");
    const workspaceImageBlock = compose.slice(compose.indexOf("  workspace-image:"));

    expect(workspaceImageBlock).not.toMatch(/docker\.sock/i);
    expect(workspaceImageBlock).not.toMatch(/GITHUB_TOKEN|GH_TOKEN/);
  });

  it("keeps control and database off the workspace network", async () => {
    const compose = await readFile(composePath, "utf8");
    const databaseBlock = compose.slice(
      compose.indexOf("  database:"),
      compose.indexOf("  control:"),
    );
    const controlBlock = compose.slice(
      compose.indexOf("  control:"),
      compose.indexOf("  workspace-image:"),
    );

    expect(databaseBlock).toContain("- control");
    expect(controlBlock).toContain("- control");
    expect(databaseBlock).not.toContain("- workspace");
    expect(controlBlock).not.toContain("- workspace");
    expect(databaseBlock).not.toContain("- egress");
    expect(controlBlock).toContain("- egress");
  });

  it("runs workspace and control processes as non-root", async () => {
    const dockerfile = await readFile(workspaceDockerfilePath, "utf8");
    const controlDockerfile = await readFile(controlDockerfilePath, "utf8");

    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).not.toMatch(/docker\.sock/i);
    expect(controlDockerfile).toContain("USER node");
  });

  it("places model identity only in the separate agent runner", async () => {
    const supervisor = await readFile(supervisorPath, "utf8");
    const entrypoint = await readFile(workspaceEntrypointPath, "utf8");

    expect(supervisor).toContain('"--network",\n      `container:');
    expect(supervisor).toContain('"--env",\n      "OPENAI_API_KEY"');
    expect(supervisor).not.toContain('`OPENAI_API_KEY=${');
    expect(entrypoint).toContain("unset OPENAI_API_KEY CODEX_ACCESS_TOKEN");
  });
});
