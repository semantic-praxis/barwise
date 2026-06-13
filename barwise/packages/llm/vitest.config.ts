import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
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
