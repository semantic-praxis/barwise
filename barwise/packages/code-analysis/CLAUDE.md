# @barwise/code-analysis

LSP-based code analysis for ORM model extraction. Analyzes TypeScript,
Java, and Kotlin codebases to extract business rules encoded in
application code: type definitions, validation functions, state
machines, and annotation-based constraints.

## Dependency Rule

This package depends on `@barwise/core` for model types and the
`ImportFormat` interface. It does NOT depend on `@barwise/llm` -- the
LLM client is injected via `enrich()`, same pattern as other formats.

Allowed runtime dependencies: `@barwise/core`. No others without
discussion. The package uses `node:child_process` for spawning language
servers and `node:fs` for file discovery.

## Package Layout

```
src/
  index.ts                   Public API
  types.ts                   CodeContext, LspSession, LSP types
  lsp/
    LspManager.ts            Start/stop language servers
    LspSession.impl.ts       Concrete LspSession over JSON-RPC
    LspJsonRpc.ts            JSON-RPC 2.0 over stdio transport
    servers/
      typescript.ts           TS server defaults
      java.ts                 JDT LS defaults
      kotlin.ts               kotlin-language-server defaults
  context/
    ContextAssembler.ts       LSP results + source -> CodeContext
    TypeCollector.ts          Collect type definitions
    ValidationCollector.ts    Collect validation functions
    StateTransitionCollector.ts  Collect state machines
    AnnotationCollector.ts    Bean Validation/JPA annotations
  formats/
    TypeScriptImportFormat.ts  ImportFormat for TypeScript
    JavaImportFormat.ts        ImportFormat for Java
    KotlinImportFormat.ts      ImportFormat for Kotlin
    registration.ts            registerCodeFormats()
  prompt/
    CodeExtractionPrompt.ts    LLM prompt for code analysis
  repo/
    RepoManager.ts             Clone a repository for analysis
    RepoProfiler.ts            Profile a repository (analyze_repository)
    LanguageDetector.ts        Detect source languages
    BuildSystemDetector.ts     Detect build systems
    detectors/                 Framework detectors
tests/
  lsp/                        LSP infrastructure tests
  context/                    Collector tests
  formats/                    Format importer tests
  fixtures/                   Test fixture projects
```

## Commands

```sh
npx vitest run              # run tests
npx tsc --noEmit            # type-check only
```

## Key Conventions

- Each format importer follows the standard `ImportFormat` interface
  from `@barwise/core`.
- LSP is optional: importers fall back to regex-based extraction when
  no language server is available.
- The `LspSessionProvider` interface allows VS Code to inject existing
  editor sessions instead of spawning new servers.
- Format registration uses `registerCodeFormats()` called at startup.

## Dependencies

| Direction | Package         | What is used                               |
| --------- | --------------- | ------------------------------------------ |
| Upstream  | `@barwise/core` | Model types, ImportFormat, format registry |
