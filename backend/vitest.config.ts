import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Required so DB-backed tests can point the API at a throwaway database
    // before any module (config/pool) caches env-derived values.
    setupFiles: ["./test/setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
