import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Loading the packaged seed suite parses seven cases with their
    // reference models; the 5s default is too tight on a loaded CI runner
    // under coverage instrumentation.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // Floors sit just under measured coverage (90.7/87.2/100/90.7)
      // so a real regression fails without making every edit a chore.
      thresholds: {
        statements: 85,
        branches: 82,
        functions: 95,
        lines: 85,
      },
    },
  },
});
