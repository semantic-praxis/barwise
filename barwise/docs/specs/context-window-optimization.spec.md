# barwise: Context Window Optimization

## Problem

When an AI agent uses barwise, several MCP tools return unbounded
output that lands directly in the agent's context window:

- `generate_diagram` returns raw SVG (`result.svg`) -- can be megabytes.
- `export_model` returns the exporter `result.text` -- OpenAPI specs
  reach 100KB+.
- `verbalize_model` joins every verbalization line -- 50-100KB for large
  models.
- The `orm-model://{+path}` resource returns the full model JSON.
- `describe_domain` caps populations to 3 samples but leaves its
  entity / fact-type / constraint arrays uncapped.

A single such call can consume a large fraction of an agent's context,
crowding out the actual task. `query_model` was already added (see
`symbolic-model-query.spec.md`) because `describe_domain` produced
"token-expensive" blobs; this spec extends that principle across the
whole MCP surface.

Separately, the workflow and tool-usage guidance that would teach an
agent to stay frugal is not expressed anywhere. The MCP prompts
(`analyze-domain`, `review-model`) are barwise's existing skill-like
surface, but they carry no context-hygiene guidance, and `review-model`
still references the deprecated `generate_schema` tool.

## Solution

Two layers.

### Layer 1 -- MCP output discipline

A shared helper bounds tool output. Output **under a byte threshold is
returned inline unchanged** -- no behavior change for small models.
Output **over the threshold spills to a file**; the tool returns a short
preview plus the absolute file path and byte/line counts. Because the
change only triggers when output would otherwise have polluted context,
it is non-breaking: the VS Code extension, which calls the same
`execute*` functions, needs no changes.

### Layer 2 -- One source, many surfaces

Modeling-workflow and context-hygiene guidance is authored once (as
exported string constants in `@barwise/mcp`) and surfaced through every
channel that can carry it: the MCP prompts (portable, every MCP client),
a first-class Claude skill (`barwise-modeling`, model-invoked,
progressive disclosure), the tool descriptions (always-on minimum), and
the `@barwise` GitHub Copilot chat participant. Two Claude sub-agents
isolate the context-heavy operations (transcript extraction, full model
review) in their own context windows.

## Design decisions

### Spill helper -- `boundedTextResult`

`packages/mcp/src/helpers/response.ts` exports `INLINE_BYTE_LIMIT`
(default 8192, overridable via `BARWISE_MCP_INLINE_LIMIT`) and
`boundedTextResult(text, opts)`. Text at or under the limit is returned
verbatim. Over the limit, the text is written to a spill file and the
tool returns a header, the first ~40 lines, an elision marker, the
absolute path, and byte/line counts.

Spill files go to an explicit `outputPath` if given, otherwise to
`.barwise/mcp-cache/` resolved from the model file's directory (or
`process.cwd()` for inline YAML). Filenames are content-addressed
(`<kind>-<sha1(text)[0:8]>.<ext>`, via `node:crypto`) so repeat calls
are idempotent. `.barwise/` is gitignored.

The result stays a single `{ type: "text" }` content part. MCP
`resource_link` parts are deliberately **not** used: the VS Code
adapter's `toToolResult()` drops every non-text part and its result
type is hard-typed to text parts.

### Non-breaking signature changes

`execute*` functions are called positionally by `server.ts` and by the
VS Code extension's `ToolRegistration.ts`. New parameters are only ever
**appended** as optional. `verbalize_model` gains an optional
`mode: "full" | "summary"` defaulting to `"full"`, so existing callers
are unaffected.

### Single guidance source

`packages/mcp/src/prompts/guidance/guidance.ts` exports
`MODELING_WORKFLOW_GUIDANCE` and `CONTEXT_HYGIENE_GUIDANCE` as
string constants, re-exported from `server.ts` (the package's public
entry). The MCP prompts and the VS Code chat participant import them;
the `barwise-modeling` skill references the same file. Authoring the
content directly as template-literal strings keeps both the `tsc` build
and the esbuild bundle free of loader or copy-step wiring.

### Sub-agents over a parallel skill for heavy operations

`import_transcript` and `review_model` consume large inputs and emit
large outputs. Two Claude Code sub-agents wrap them, absorbing the bulk
input/output in a separate context window and returning only a distilled
summary. This isolation is something an MCP prompt cannot provide.

## Files

### New files

- `barwise/packages/mcp/src/helpers/response.ts` -- `boundedTextResult`
- `barwise/packages/mcp/tests/helpers/response.test.ts`
- `barwise/packages/mcp/src/prompts/guidance/guidance.ts` -- guidance constants
- `.claude/skills/barwise-modeling/SKILL.md`
- `.claude/agents/barwise-transcript-extractor.md`
- `.claude/agents/barwise-model-reviewer.md`
- `barwise/.github/copilot-instructions.md`

### Modified files

- `barwise/packages/mcp/src/tools/diagram.ts` -- bound SVG output
- `barwise/packages/mcp/src/tools/exportModel.ts` -- bound output, add `outputPath`
- `barwise/packages/mcp/src/tools/verbalize.ts` -- bound output, add `mode`
- `barwise/packages/mcp/src/tools/describeDomain.ts` -- cap arrays
- `barwise/packages/mcp/src/resources/ormModel.ts` -- description guard
- `barwise/packages/mcp/src/prompts/analyzeDomain.ts` -- embed guidance
- `barwise/packages/mcp/src/prompts/reviewModel.ts` -- embed guidance, fix stale tool
- `barwise/packages/mcp/src/server.ts` -- re-export guidance constants
- `barwise/packages/mcp/tests/tools/{diagram,exportModel,verbalize,describeDomain}.test.ts`
- `barwise/packages/vscode/src/chat/chatPrompts.ts` -- fold guidance into system prompt
- `barwise/.gitignore` -- add `.barwise/`

## Test coverage

- `response.test.ts`: under-limit text returned verbatim; over-limit text
  writes a file and returns preview + path + counts; content-addressed
  filename is stable across calls; explicit `outputPath` honored.
- `diagram` / `exportModel`: small output stays inline; large output
  spills to a path.
- `verbalize`: `summary` mode returns counts; `full` mode unchanged for
  small models and spills when large; `factType` filter unaffected.
- `describeDomain`: oversized model caps arrays and reports `truncation`;
  small model unchanged.
- Existing MCP and VS Code tests continue to pass.

## Success criteria

- No MCP tool returns more than `INLINE_BYTE_LIMIT` of inline text for a
  large model; the overflow is reachable via a returned file path.
- Small-model behavior is byte-for-byte unchanged.
- `analyze-domain` and `review-model` carry the context-hygiene
  guidance; `review-model` no longer references `generate_schema`.
- The `barwise-modeling` skill and the two sub-agents are present and
  well-formed.
- The full monorepo build and test suite pass; the VS Code package
  type-checks.
