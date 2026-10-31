import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Match the `@/*` path alias from tsconfig.json.
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one PostgreSQL — never run files in parallel.
    fileParallelism: false,
    // Integration tests talk to a real PostgreSQL (incl. lock waits).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
