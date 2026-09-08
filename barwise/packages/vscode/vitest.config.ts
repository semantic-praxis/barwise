import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

// `globals: false` used to be stated here; it is vitest's own default,
// so dropping it changes nothing but the line count.
export default defineConfig(barwiseVitestConfig("vscode", {
  testInclude: ["tests/unit/**/*.test.ts"],
  coverage: {
    // Gate the unit-tested surface only: the LSP providers and the chat
    // participant. The webview, commands, and extension wiring are
    // exercised by the integration suite, not these unit tests.
    kind: "named-files",
    include: [
      "src/chat/ChatParticipant.ts",
      "src/mcp/resolveModelSource.ts",
      "src/server/CompletionProvider.ts",
      "src/server/DiagnosticsProvider.ts",
      "src/server/HoverProvider.ts",
      "src/server/YamlSourceMap.ts",
    ],
  },
  thresholds: { statements: 78, branches: 80, functions: 95, lines: 78 },
}));
