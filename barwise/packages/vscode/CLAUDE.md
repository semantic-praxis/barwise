# barwise-vscode

VS Code extension that wires the platform-independent packages
(`@barwise/core`, `@barwise/diagram`, `@barwise/llm`, `@barwise/mcp`) into the editor.
This package is the thin integration layer -- business logic lives in
the core packages.

## Dependency Rule

This is the ONLY package that may depend on the `vscode` module.
All ORM domain logic, validation, mapping, verbalization, and
serialization must stay in `@barwise/core`. Diagram generation logic
stays in `@barwise/diagram`. LLM extraction logic stays in
`@barwise/llm`.

If you find yourself writing model logic or validation rules here,
it belongs in core instead.

## Package Layout

```
src/
  client/
    extension.ts              VS Code activate/deactivate entry point
  server/
    OrmLanguageServer.ts      LSP server (diagnostics, completion, hover)
    CompletionProvider.ts     Autocomplete for .orm.yaml files
    DiagnosticsProvider.ts    Maps validation diagnostics to LSP
    HoverProvider.ts          Hover info for object type references
  commands/
    NewProjectCommand.ts      orm.newProject -- scaffold a new .orm.yaml
    ValidateModelCommand.ts   orm.validateModel -- full validation
    VerbalizeCommand.ts       orm.verbalize -- generate verbalization report
    ShowDiagramCommand.ts     orm.showDiagram -- open diagram webview panel
    ImportTranscriptCommand.ts orm.importTranscript -- LLM transcript extraction
    ImportCodeCommand.ts      orm.import -- TypeScript/Java/Kotlin code analysis
  diagram/
    DiagramPanel.ts           Webview host; thin adapter over @barwise/diagram DiagramSession
    protocol.ts               Webview message types (envelopes over the diagram contract)
  llm/
    CopilotLlmClient.ts      LlmClient implementation using GitHub Copilot chat API
  mcp/
    ToolRegistration.ts      Registers tools via vscode.lm.registerTool() (in-process, Copilot access)
    McpServerProvider.ts     Registers bundled MCP stdio server for external MCP clients
    stdio-entry.ts           Standalone entry point for the MCP server child process
```

## Build

This package uses **esbuild** (not `tsc`) for production builds. The
build produces three bundles:

- `dist/client/extension.js` -- the extension entry point
- `dist/server/OrmLanguageServer.js` -- the language server process
- `dist/mcp/index.js` -- the MCP server (spawned as a child process)

```sh
node esbuild.mjs            # build all three bundles
npx tsc --noEmit             # type-check only (uses tsconfig.json with Bundler resolution)
```

The tsconfig uses `moduleResolution: "Bundler"` (not `NodeNext` like
the other packages) because esbuild handles module resolution at
bundle time.

## Key Conventions

- The extension uses the Language Server Protocol (LSP). The server
  runs in a separate process and communicates via JSON-RPC.
- `vscode` is an external in the esbuild config -- it is provided by
  the VS Code runtime, not bundled.
- The `CopilotLlmClient` implements the `LlmClient` interface from
  `@barwise/llm` using the VS Code Copilot chat API. This is the
  default provider so users do not need an API key.
- Extension settings are declared in `package.json` under
  `contributes.configuration` (LLM provider, API key, model selection).
- AI tool integration uses two complementary mechanisms:
  1. **Language Model Tools** (`vscode.lm.registerTool`) -- the primary
     integration. Runs in the extension host process with full access
     to Copilot language models. `ToolRegistration.ts` wraps each
     `execute*()` function from `@barwise/mcp` in a
     `LanguageModelTool<T>`. The `import_transcript` tool uses
     `CopilotLlmClient` directly so no API key is needed.
  2. **MCP stdio server** (`registerMcpServerDefinitionProvider`) --
     spawns `dist/mcp/index.js` as a child process for external MCP
     clients that discover servers through VS Code.
     The `barwise.enableMcpServer` setting controls both mechanisms.
     Tool declarations live in `package.json` under
     `contributes.languageModelTools`.

## Testing

Two test tiers, each with its own runner:

**Unit tests** (`tests/unit/`) -- Vitest, no VS Code runtime needed.
Test the LSP server providers (DiagnosticsProvider, CompletionProvider,
HoverProvider) using `vscode-languageserver-textdocument` objects and
mock connections. Fast, run as part of `npm run test` via turbo.

```sh
npx vitest run              # run unit tests
```

**Integration tests** (`tests/integration/`) -- @vscode/test-cli +
Mocha inside a real VS Code instance. Test extension activation,
command execution, diagnostics rendering, and completions end-to-end.
Compiled with `tsconfig.test.json` to `dist/tests/`.

```sh
npm run test:integration    # compiles + launches VS Code + runs tests
```

Test fixtures live in `tests/fixtures/` (`.orm.yaml` files).

## Dependencies

| Direction | Package                        | What is used                                                                       |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| Upstream  | `@barwise/code-analysis`       | `registerCodeFormats`, `getImporter` for TypeScript/Java/Kotlin code import        |
| Upstream  | `@barwise/core`                | Model types, validation, verbalization, serialization, mapping                     |
| Upstream  | `@barwise/diagram`             | `generateDiagram` for webview SVG rendering                                        |
| Upstream  | `@barwise/llm`                 | `processTranscript`, `LlmClient` interface, extraction types                       |
| Upstream  | `@barwise/mcp`                 | `createServer` for MCP stdio server; `execute*` functions for Language Model Tools |
| External  | `vscode`                       | Editor API (provided at runtime, not bundled)                                      |
| External  | `vscode-languageserver/client` | LSP protocol implementation                                                        |
