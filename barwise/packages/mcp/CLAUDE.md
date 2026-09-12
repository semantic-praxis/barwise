# @barwise/mcp

MCP (Model Context Protocol) server that exposes barwise ORM 2
modeling capabilities as tools, resources, and prompts. Any AI tool
that speaks MCP (Claude Code, Claude Desktop, opencode, Cursor,
Windsurf, Zed, Cline, JetBrains) gets barwise capabilities without
per-tool integration work.

## Dependency Rule

This package may depend on any internal package except
`barwise-vscode`, `@barwise/cli`, and `@barwise/promptlab`; the MCP
SDK and `zod` are the externals. It has ZERO dependencies on VS Code.
The authoritative internal list is the root CLAUDE.md dependency
graph (and this package's `package.json`).

## Package Layout

```
src/
  index.ts              Main entry point (bin shebang)
  server.ts             McpServer setup and registration
  workspace/
    resolve.ts          Source resolution (file path / inline YAML / project)
    projectLoader.ts    Filesystem walk for a .orm-project.yaml manifest
  llm/
    SamplingLlmClient.ts  LlmClient over MCP sampling -- the host's model, no key
    resolveClient.ts      Prefer sampling, fall back to a key, report which
  tools/
    index.ts            Tool registration barrel
    validate.ts         validate_model tool
    verbalize.ts        verbalize_model tool
    describeDomain.ts   describe_domain tool
    schema.ts           generate_schema tool
    diff.ts             diff_models tool
    diagram.ts          generate_diagram tool
    exportModel.ts      export_model tool
    importModel.ts      import_model tool (registry-backed formats)
    analyze.ts          analyze_repository tool (clone, profile, extract)
    gym.ts              gym_list / gym_check tools (modeling gym)
    import.ts           import_transcript tool
    merge.ts            merge_models tool
    review.ts           review_model tool (exports formatReview, shared with vscode)
    queryModel.ts       query_model tool
    lineageStatus.ts    lineage_status tool
    impactAnalysis.ts   impact_analysis tool
  resources/
    index.ts            Resource registration barrel
    ormSchema.ts        orm-schema://json-schema resource
    ormModel.ts         orm-model://{path} resource template
  prompts/
    index.ts            Prompt registration barrel
    analyzeDomain.ts    analyze-domain prompt
    reviewModel.ts      review-model prompt
tests/
  tools/                Tool handler tests
  resources/            Resource handler tests
```

## Commands

```sh
npx vitest run              # run tests
npx tsc --noEmit            # type-check only
```

## Key Conventions

- Uses stdio transport only (universally supported by all MCP clients).
- Each tool accepts a `source` parameter that can be a file path to an
  `.orm.yaml` file, inline YAML content, or a `.orm-project.yaml`
  manifest. The `resolveSource` helper handles single models; the read
  tools use `resolveModels`, which adds the project branch and an
  optional `domain` selector (no `domain` over a project yields a
  combined per-domain view; a `domain` selects one).
- Tool handlers return `{ content: [{ type: "text", text }] }` per
  MCP protocol.
- **The LLM tools prefer the client's model over an API key.**
  `import_transcript` and `review_model` resolve through
  `llm/resolveClient.ts`: when the connected client advertises
  `sampling.tools`, completions go through `server.createMessage` and this
  server needs no credential; otherwise it falls back to
  `createLlmClient()`. The route is appended to the tool result, because a
  silent fallback would let an operator believe no key was used while one
  was (`docs/specs/keyless-model-access.spec.md`).

  **The capability to check is `sampling.tools`, not `sampling`.** Both
  `processTranscript` and `reviewModel` request structured output, so every
  call this server makes carries `tools` -- and the protocol says a client
  MUST error when `tools` arrives without that capability. Keying on
  `sampling` alone would swap a working keyed path for a failing one.

  `executeImport` and `executeReview` take the client as an optional last
  argument and build their own when it is omitted, so they stay callable
  standalone; only the registration has the server handle sampling needs.
  Neither is usable by promptlab: a sampling client reports no `model`
  before the call, so a recorded `promptHash` would not be a function of
  the model that answered.
- Tests call tool handler functions directly with mock inputs (no
  transport needed).

## Dependencies

| Direction | Package                  | What is used                                                           |
| --------- | ------------------------ | ---------------------------------------------------------------------- |
| Upstream  | `@barwise/core`          | Model, validation, verbalization, mapping, diff, merge, query, lineage |
| Upstream  | `@barwise/diagram`       | Diagram layout for SVG output                                          |
| Upstream  | `@barwise/diagram-ui`    | Headless SVG rendering of the positioned graph                         |
| Upstream  | `@barwise/llm`           | `processTranscript`, `reviewModel`, `createLlmClient`, providers       |
| Upstream  | `@barwise/code-analysis` | `registerCodeFormats`; repo analysis for analyze_repository            |
| Upstream  | `@barwise/dbt`           | `registerDbtFormats` for dbt import/export                             |
| Upstream  | `@barwise/formats`       | `registerStandardFormats` (DDL/OpenAPI/Avro/NORMA/SQL descriptors)     |
| Upstream  | `@barwise/learn`         | Modeling gym (exercise catalog, evaluator) for gym_list / gym_check    |
