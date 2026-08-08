import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
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
