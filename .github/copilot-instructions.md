# Copilot instructions for barwise

Barwise is an ORM 2 (Object-Role Modeling) toolkit. Models are
`.orm.yaml` files, and capabilities are reached through the `barwise`
CLI, the `barwise-mcp` MCP server, and the VS Code extension.

## When working with ORM models

Follow the barwise modeling workflow: capture a transcript or existing
model, extract a draft (`import_transcript` / `import_model`), validate
(`validate_model`), verbalize (`verbalize_model`), review
(`review_model`), then export (`export_model`).

## Keep the context window clean

The barwise tools can return very large output. Follow these rules:

- For a specific structural question, use `query_model` (precise,
  deterministic) instead of re-deriving the answer from a large
  `describe_domain` dump or guessing.
- `verbalize_model` defaults to full output -- prefer `mode='summary'`
  first, or `factType=<name>` to focus on one fact type.
- `export_model` and `generate_diagram` write large artifacts to a file
  and return a path. Reference the path; do not paste raw DDL, OpenAPI,
  or SVG into a reply.
- Do not read the `orm-model://` resource for a non-trivial model.

The authoritative, single-source guidance lives in
`barwise/packages/mcp/src/prompts/guidance/guidance.ts` and is delivered
through the barwise MCP prompts (`analyze-domain`, `review-model`) and
the `@barwise` chat participant.
