# barwise: Complete Tool Surface for Chat Participant

Status: Implemented -- 14 LM tools registered
(packages/vscode/src/mcp/ToolRegistration.ts) with matching chat
slash commands in the manifest; exceeds the target table.
Created: 2026-03-08
Last-updated: 2026-07-25

## Problem

The MCP server registers 13 tools, but only 7 are wired as VS Code
Language Model Tools and only 5 have chat participant slash commands.
Users typing `@barwise /export` or `@barwise /review` get nothing.
Six MCP tools are invisible to Copilot Chat.

### Current gap

| MCP Tool          | LM Tool | Slash Cmd  | Re-exported |
| ----------------- | ------- | ---------- | ----------- |
| validate_model    | Yes     | /validate  | Yes         |
| verbalize_model   | Yes     | /verbalize | Yes         |
| generate_schema   | Yes     | /schema    | Yes         |
| generate_diagram  | Yes     | /diagram   | Yes         |
| import_transcript | Yes     | /import    | Yes         |
| diff_models       | Yes     | --         | Yes         |
| merge_models      | Yes     | --         | Yes         |
| export_model      | --      | --         | --          |
| describe_domain   | --      | --         | --          |
| import_model      | --      | --         | --          |
| review_model      | --      | --         | --          |
| lineage_status    | --      | --         | Yes         |
| impact_analysis   | --      | --         | Yes         |

## Solution

Close every gap so that all 13 MCP tools are available as Language
Model Tools and all user-facing operations have slash commands. The
`review_model` tool requires an LLM call -- in the VS Code Language
Model Tool it should use `CopilotLlmClient` (same pattern as
`import_transcript`).

### Target state

| MCP Tool          | LM Tool Name              | Slash Cmd     |
| ----------------- | ------------------------- | ------------- |
| validate_model    | barwise_validate_model    | /validate     |
| verbalize_model   | barwise_verbalize_model   | /verbalize    |
| generate_schema   | barwise_generate_schema   | /schema       |
| generate_diagram  | barwise_generate_diagram  | /diagram      |
| import_transcript | barwise_import_transcript | /import       |
| diff_models       | barwise_diff_models       | /diff         |
| merge_models      | barwise_merge_models      | /merge        |
| export_model      | barwise_export_model      | /export       |
| describe_domain   | barwise_describe_domain   | /describe     |
| import_model      | barwise_import_model      | /import-model |
| review_model      | barwise_review_model      | /review       |
| lineage_status    | barwise_lineage_status    | /lineage      |
| impact_analysis   | barwise_impact_analysis   | /impact       |

## Design decisions

### Slash commands map 1:1 to tools

Each slash command prepends an instruction that names the exact tool
to use. Free-form prompts still work -- Copilot picks tools from the
system prompt. Slash commands remove ambiguity.

### review_model uses CopilotLlmClient

Like `import_transcript`, the `review_model` tool needs an LLM call.
The Language Model Tool implementation uses `CopilotLlmClient` by
default so no API key is needed. Falls back to Anthropic if configured.

### import_model is distinct from import_transcript

`/import` remains for LLM-based transcript extraction.
`/import-model` is for deterministic format parsing (DDL, OpenAPI).
The slash command name includes `-model` to avoid confusion.

### All execute functions re-exported from @barwise/mcp

Missing re-exports are added to `server.ts` so the vscode package can
call them directly without MCP transport.

## Implementation

### 1. Re-export missing execute functions

In `packages/mcp/src/server.ts`, add:

```typescript
export { executeDescribeDomain } from "./tools/describeDomain.js";
export { executeExportModel } from "./tools/exportModel.js";
export { executeImportModel } from "./tools/importModel.js";
export { executeReview } from "./tools/review.js";
```

### 2. New Language Model Tool classes

In `packages/vscode/src/mcp/ToolRegistration.ts`, add 6 new tool
classes following the existing pattern:

- `ExportModelTool` -- wraps `executeExportModel(source, format, options)`
- `DescribeDomainTool` -- wraps `executeDescribeDomain(source, focus, includePopulations, filePath)`
- `ImportModelTool` -- wraps `executeImportModel(source, format, modelName)`
- `ReviewModelTool` -- uses `CopilotLlmClient` (like `ImportTranscriptTool`)
  to call `reviewModel()` from `@barwise/llm`
- `LineageStatusTool` -- wraps `executeLineageStatus(source)`
- `ImpactAnalysisTool` -- wraps `executeImpactAnalysis(source, elementId)`

Register all 6 in `registerLanguageModelTools()`.

### 3. package.json: languageModelTools declarations

Add 6 new entries under `contributes.languageModelTools` with
appropriate `inputSchema`, `modelDescription`, `tags: ["orm"]`, and
`canBeReferencedInPrompt: true`.

### 4. package.json: chatParticipants commands

Add 8 new commands to the `chatParticipants[0].commands` array:

```json
{ "name": "diff", "description": "Compare two ORM models" },
{ "name": "merge", "description": "Merge an incoming model into a base model" },
{ "name": "export", "description": "Export model to DDL, OpenAPI, dbt, or Avro" },
{ "name": "describe", "description": "Describe domain entities and constraints" },
{ "name": "import-model", "description": "Import model from DDL or OpenAPI" },
{ "name": "review", "description": "LLM-powered semantic review of a model" },
{ "name": "lineage", "description": "Check staleness of exported artifacts" },
{ "name": "impact", "description": "Analyze impact of changing a model element" }
```

### 5. chatPrompts.ts updates

- **SYSTEM_PROMPT**: Add the 6 new tools to the capability list.
- **COMMAND_INSTRUCTIONS**: Add entries for all 8 new slash commands.
- **FOLLOWUP_SUGGESTIONS**: Add export and review suggestions.

### 6. Unit test updates

Update `ChatParticipant.test.ts`:

- Update expected tool count in system prompt test
- Add the 8 new command names to the command instructions test
- Verify each new command instruction references the correct tool
- Update follow-up suggestions test

## Files

### Modified files

- `packages/mcp/src/server.ts` -- add 4 missing re-exports
- `packages/vscode/src/mcp/ToolRegistration.ts` -- add 6 tool classes
  and registrations
- `packages/vscode/src/chat/chatPrompts.ts` -- update system prompt,
  command instructions, follow-up suggestions
- `packages/vscode/package.json` -- add 6 languageModelTools, 8
  chatParticipant commands
- `packages/vscode/tests/unit/ChatParticipant.test.ts` -- update
  assertions for new commands and tools

### No new files

All changes are additions to existing files.

## Test coverage

- Unit test: system prompt lists all 13 tool names
- Unit test: COMMAND_INSTRUCTIONS has entries for all 13 slash commands
- Unit test: each command instruction references the correct tool
- Unit test: follow-up suggestions include export and review
- Existing tests continue to pass unchanged

## Success criteria

- All 13 MCP tools appear as Language Model Tools in VS Code
- All 13 operations have chat participant slash commands
- `@barwise /export` exports a model to the requested format
- `@barwise /review` performs an LLM-powered model review
- `@barwise /describe` returns domain context
- `@barwise /diff` and `@barwise /merge` work via slash commands
- `@barwise /import-model` imports from DDL or OpenAPI
- `@barwise /lineage` checks artifact staleness
- `@barwise /impact` analyzes element change impact
- All existing and new tests pass
- Build succeeds
