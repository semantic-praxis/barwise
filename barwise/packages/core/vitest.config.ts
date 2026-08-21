import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Splitting and fully validating the real auction model runs several
    // seconds under coverage instrumentation with twelve packages in
    // parallel; the 5s default is too tight on a loaded CI runner.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        statements: 90,
        branches: 84,
        functions: 90,
        lines: 90,
      },
    },
  },
});
