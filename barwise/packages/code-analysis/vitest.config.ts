import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("code-analysis", {
  coverage: {
    kind: "whole-src",
    // Reachable only through LspManager.startSession, which spawns a
    // real language server, so no test constructs either -- they were
    // pure denominator, and V8's never-compiled-function omission made
    // that denominator move with the Node version (see ci.yml). Testing
    // the transport against a fake ChildProcess is tracked: barwise-914.
    exclude: ["src/lsp/LspJsonRpc.ts", "src/lsp/LspSession.impl.ts"],
  },
  thresholds: { statements: 80, branches: 75, functions: 90, lines: 80 },
}));
