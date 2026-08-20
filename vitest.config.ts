import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@rad/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
      "@rad/agents": fileURLToPath(
        new URL("./packages/agents/src/index.ts", import.meta.url),
      ),
      "@rad/workspace-state": fileURLToPath(
        new URL("./packages/workspace-state/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
    },
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
