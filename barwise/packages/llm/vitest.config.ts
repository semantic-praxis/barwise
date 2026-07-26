import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The pipeline integration test lays out diagrams through real ELK,
    // which can blow the 5s default on a loaded CI runner under coverage.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // Floors calibrated to actual coverage. The previous 78/82/100/78
      // never ran in CI: the statement/line floors sat well below real
      // coverage while the 100% functions target was unmet.
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 92,
        lines: 85,
      },
    },
  },
});
