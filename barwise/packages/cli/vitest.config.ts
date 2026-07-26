import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The diagram/export commands run real ELK and subprocess-heavy flows; the 5s default is too tight on a loaded CI runner.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        statements: 60,
        branches: 78,
        functions: 88,
        lines: 60,
      },
    },
  },
});
