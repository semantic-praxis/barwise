# @barwise/mcp

MCP (Model Context Protocol) server that exposes barwise ORM 2
modeling capabilities as tools, resources, and prompts. Any AI tool
that speaks MCP (Claude Code, Claude Desktop, opencode, Cursor,
Windsurf, Zed, Cline, JetBrains) gets barwise capabilities without
per-tool integration work.

## Dependency Rule

This package depends on `@barwise/core`, `@barwise/diagram`,
`@barwise/llm`, the MCP SDK, and `zod`. It has ZERO dependencies on
VS Code.

## Package Layout

```
src/
  index.ts              Main entry point (bin shebang)
  server.ts             McpServer setup and registration
  workspace/
    resolve.ts          Source resolution (file path / inline YAML / project)
    projectLoader.ts    Filesystem walk for a .orm-project.yaml manifest
  tools/
    index.ts            Tool registration barrel
    validate.ts         validate_model tool
    verbalize.ts        verbalize_model tool
    schema.ts           generate_schema tool
    diff.ts             diff_models tool
    diagram.ts          generate_diagram tool
    import.ts           import_transcript tool
    merge.ts            merge_models tool
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
- Tests call tool handler functions directly with mock inputs (no
  transport needed).

## Dependencies

| Direction | Package            | What is used                                                          |
| --------- | ------------------ | --------------------------------------------------------------------- |
| Upstream  | `@barwise/core`    | Model, validation, verbalization, mapping, diff, merge, serialization |
| Upstream  | `@barwise/diagram` | `generateDiagram` for SVG output                                      |
| Upstream  | `@barwise/llm`     | `processTranscript`, `createLlmClient`, provider factory              |
