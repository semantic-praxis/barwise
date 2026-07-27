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

## Context hygiene

Each tool's description states its own output-size behavior (summary
modes, length caps, file spills) - trust those. The one cross-tool rule:
when a tool writes an artifact to a file, reference the path in replies
rather than pasting the contents, and read the file back only when the
inline preview genuinely does not suffice.

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
