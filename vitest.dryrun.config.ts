import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Runner for the H9 simulated-cohort dry run (scripts/dry-run/*.dryrun.ts).
 *
 * Deliberately separate from vitest.config.ts: these files talk to a REAL
 * database and must never run as part of `npm test`. The main config only
 * includes src/**\/*.test.ts, so they are excluded there by construction.
 *
 *   npx vitest run --config vitest.dryrun.config.ts scripts/dry-run/seed.dryrun.ts
 *   npx vitest run --config vitest.dryrun.config.ts scripts/dry-run/teardown.dryrun.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["scripts/dry-run/*.dryrun.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
