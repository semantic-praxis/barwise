import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The 5s default is too tight on a loaded CI runner under coverage
    // instrumentation; matches the other packages.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        statements: 80,
        branches: 74,
        functions: 90,
        lines: 80,
      },
    },
  },
});
