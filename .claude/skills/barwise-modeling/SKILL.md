---
name: barwise-modeling
description: Use when working with ORM 2 / Object-Role Modeling, .orm.yaml files, or the barwise toolkit (the barwise CLI, the barwise-mcp server, or the VS Code extension) - building, validating, verbalizing, diagramming, diffing, or exporting conceptual data models. Provides the modeling workflow and the rules for using barwise's tools without flooding the context window.
---

# Barwise ORM Modeling

Barwise is an ORM 2 (Object-Role Modeling) toolkit. Models are
`.orm.yaml` files. Capabilities are reached through the `barwise-mcp`
MCP server (tools, resources, prompts), the `barwise` CLI, or the VS
Code extension.

## Workflow

1. **Capture** - start from a business-domain transcript or an existing model.
2. **Extract** - `import_transcript` drafts a model from a transcript;
   `import_model` converts DDL / OpenAPI / code into a draft.
3. **Validate** - `validate_model`; resolve structural errors.
4. **Verbalize** - `verbalize_model`; check that readings sound natural.
5. **Review** - `review_model` for semantic-quality suggestions.
6. **Export** - `export_model` (ddl, openapi, ...) once the model is sound.

## Context hygiene (important)

The barwise tools can return very large output. To keep this conversation's
context window clean:

- For a **specific structural question** (what entities exist, which roles
  are mandatory, how two entities connect, model statistics), use
  `query_model` - it gives a precise deterministic answer. Do not re-derive
  answers from a large `describe_domain` dump or guess from prior context.
- For an **overview**, use `describe_domain`. Its arrays are length-capped;
  if it reports truncation, follow up with `query_model`.
- `verbalize_model` defaults to full output - call it with `mode='summary'`
  first, or pass `factType=<name>` to focus on one fact type.
- `export_model` and `generate_diagram` write large artifacts to a file and
  return the **file path**. Reference the path; never paste raw DDL,
  OpenAPI, or SVG into a reply. Pass `outputPath` to choose where
  `export_model` writes.
- When a tool says output was written to a file, open that file with `Read`
  only if you genuinely need the full content - the inline preview usually
  suffices.
- Do not read the `orm-model://` resource for a non-trivial model; it
  returns the entire model JSON, unbounded.

## Delegate heavy operations

Two operations consume large inputs and emit large outputs. Dispatch them
to sub-agents so the bulk never enters this context window:

- **Transcript extraction** -> the `barwise-transcript-extractor` sub-agent.
- **Full model review** -> the `barwise-model-reviewer` sub-agent.

Each runs in its own context window and returns only a short summary.

## Canonical reference

The authoritative guidance is
`barwise/packages/mcp/src/prompts/guidance/guidance.ts`, also delivered
through the barwise MCP prompts `analyze-domain` and `review-model`.
