import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      // Gate the unit-tested surface only: the LSP providers and the chat
      // participant. The webview, commands, and extension wiring are
      // exercised by the integration suite, not these unit tests.
      include: [
        "src/chat/ChatParticipant.ts",
        "src/server/CompletionProvider.ts",
        "src/server/DiagnosticsProvider.ts",
        "src/server/HoverProvider.ts",
        "src/server/YamlSourceMap.ts",
      ],
      thresholds: {
        statements: 78,
        branches: 80,
        functions: 95,
        lines: 78,
      },
    },
  },
});
