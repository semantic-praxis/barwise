import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The the diagram tool renders through real ELK; the 5s default is too tight on a loaded CI runner.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        statements: 75,
        branches: 82,
        functions: 88,
        lines: 75,
      },
    },
  },
});
