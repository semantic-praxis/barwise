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
      exclude: [
        "src/index.ts",
        // Reachable only through LspManager.startSession, which spawns a
        // real language server, so no test constructs either -- they were
        // pure denominator, and V8's never-compiled-function omission made
        // that denominator move with the Node version (see ci.yml). Testing
        // the transport against a fake ChildProcess is tracked: barwise-914.
        "src/lsp/LspJsonRpc.ts",
        "src/lsp/LspSession.impl.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 90,
        lines: 80,
      },
    },
  },
});
