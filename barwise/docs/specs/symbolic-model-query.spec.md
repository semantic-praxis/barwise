# barwise: Symbolic Model Query API

## Problem

Today, the only structured way to interrogate an ORM model is
`describeDomain`, which produces large human-readable summaries keyed on
a single optional `focus`. It is a "dump everything related to X" tool,
not a question-answering tool.

When an AI chat agent needs a specific fact -- "is the Order role
mandatory?", "what fact types does Customer play in?", "how is Customer
connected to Product?" -- it has two bad options:

1. Call `describeDomain` and re-derive the answer from a large blob of
   text (token-expensive, and the LLM may misread the blob).
2. Guess from prior context (cheap, but unreliable).

There is no deterministic, narrow, composable query primitive. This
blocks:

- Making the chat agent cheaper and more trustworthy (structured queries
  instead of LLM re-derivation).
- Derivation rules, which need a formal query vocabulary over the model.

## Solution

Add a `src/query/` module to `@barwise/core` that provides a small
**symbolic query language** over an `OrmModel`:

- A discriminated-union `ModelQuery` type -- the formal, serializable
  query representation.
- A one-line text DSL (`parseQuery`) so the same queries can be typed on
  a CLI or passed as a string by an LLM.
- A deterministic evaluator (`queryModel`) returning a discriminated
  `QueryResult`.
- A human-readable formatter (`formatQueryResult`) for CLI output.

Every query is answered purely from the model -- no LLM, no I/O,
deterministic. The result is a typed structure, not prose.

This is surfaced as a `barwise query` CLI command, a `query_model` MCP
tool, and is wired into the `@barwise` chat participant so the agent
prefers deterministic queries over guessing.

## Design decisions

### Both a struct API and a text DSL

The struct (`ModelQuery`) is the formal artifact -- it is what a future
derivation-rule engine will compose and serialize. The text DSL is a
thin, lossless front-end (`parseQuery: string -> ModelQuery`) so the
query is also ergonomic to type and easy for an LLM to emit. CLI and MCP
accept the text form; programmatic callers can build the struct
directly.

### Deterministic, model-only

`queryModel` reads the in-memory `OrmModel` and nothing else. Element
lookups by name are case-insensitive. A well-formed query against an
absent element returns a `not-found` result rather than throwing -- only
a malformed query string throws (`QueryParseError`).

### Reuse the verbalizer

Fact-type readings and constraint phrasings come from the existing
`Verbalizer`, so query output stays consistent with `describe`,
`verbalize`, and the diagram.

### Scope: single `OrmModel`

Like `describeDomain`, queries operate on one `OrmModel`. Cross-domain
`OrmProject` queries are out of scope for this feature.

## Query language

A query is one line: a command keyword followed by arguments. Names
containing spaces are double-quoted.

| DSL                                   | `ModelQuery.kind`  | Answers                                       |
| ------------------------------------- | ------------------ | --------------------------------------------- |
| `entities [entity\|value]`            | `list-entities`    | All object types, optionally filtered by kind |
| `fact-types [<arity>]`                | `list-fact-types`  | All fact types, optionally filtered by arity  |
| `constraints [<type>]`                | `list-constraints` | All constraints, optionally filtered by type  |
| `entity <name>`                       | `entity`           | Full detail for one entity                    |
| `fact-type <name>`                    | `fact-type`        | Full detail for one fact type                 |
| `fact-types-of <entity>`              | `fact-types-of`    | Fact types an entity participates in          |
| `related-to <entity>`                 | `related-entities` | Entities sharing a fact type with the entity  |
| `constraints-of <name>`               | `constraints-of`   | Constraints touching an entity or fact type   |
| `subtypes-of <entity> [transitive]`   | `subtypes-of`      | Direct (or transitive) subtypes               |
| `supertypes-of <entity> [transitive]` | `supertypes-of`    | Direct (or transitive) supertypes             |
| `mandatory-roles [<entity>]`          | `mandatory-roles`  | Mandatory roles, optionally for one entity    |
| `path <entityA> <entityB>`            | `path`             | Shortest fact-type path between two entities  |
| `stats`                               | `model-stats`      | Element counts for the model                  |

## Types

```typescript
export type ModelQuery =
  | { kind: "list-entities"; entityKind?: "entity" | "value"; }
  | { kind: "list-fact-types"; arity?: number; }
  | { kind: "list-constraints"; constraintType?: string; }
  | { kind: "entity"; name: string; }
  | { kind: "fact-type"; name: string; }
  | { kind: "fact-types-of"; entity: string; }
  | { kind: "related-entities"; entity: string; }
  | { kind: "constraints-of"; name: string; }
  | { kind: "subtypes-of"; entity: string; transitive: boolean; }
  | { kind: "supertypes-of"; entity: string; transitive: boolean; }
  | { kind: "mandatory-roles"; entity?: string; }
  | { kind: "path"; from: string; to: string; }
  | { kind: "model-stats"; };

export type QueryResult =
  | { kind: "entities"; entities: readonly EntityRef[]; }
  | { kind: "fact-types"; factTypes: readonly FactTypeRef[]; }
  | { kind: "constraints"; constraints: readonly ConstraintRef[]; }
  | { kind: "roles"; roles: readonly RoleRef[]; }
  | { kind: "entity-detail"; detail: EntityDetail; }
  | { kind: "fact-type-detail"; detail: FactTypeDetail; }
  | {
    kind: "path";
    from: string;
    to: string;
    found: boolean;
    steps: readonly PathStep[];
  }
  | { kind: "stats"; stats: ModelStats; }
  | { kind: "not-found"; message: string; };

export class QueryParseError extends Error {}
```

`EntityRef`, `FactTypeRef`, `ConstraintRef`, `RoleRef`, `EntityDetail`,
`FactTypeDetail`, `ModelStats`, and `PathStep` are lightweight reference
records (ids + names + verbalized text).

## Public functions

```typescript
function parseQuery(text: string): ModelQuery; // throws QueryParseError
function queryModel(model: OrmModel, query: ModelQuery): QueryResult;
function runQuery(model: OrmModel, text: string): QueryResult; // parse + evaluate
function formatQueryResult(result: QueryResult): string;
```

## Files

### New files

- `packages/core/src/query/types.ts` -- query, result, ref types, error
- `packages/core/src/query/parse.ts` -- `parseQuery`
- `packages/core/src/query/evaluate.ts` -- `queryModel`
- `packages/core/src/query/format.ts` -- `formatQueryResult`
- `packages/core/src/query/index.ts` -- barrel + `runQuery`
- `packages/core/tests/query/parse.test.ts`
- `packages/core/tests/query/evaluate.test.ts`
- `packages/core/tests/query/format.test.ts`
- `packages/cli/src/commands/query.ts` -- `barwise query`
- `packages/cli/tests/commands/query.test.ts`
- `packages/mcp/src/tools/queryModel.ts` -- `query_model` tool
- `packages/mcp/tests/tools/queryModel.test.ts`

### Modified files

- `packages/core/src/index.ts` -- export query API
- `packages/cli/src/cli.ts` -- register `query` command
- `packages/mcp/src/tools/index.ts` -- register `query_model` tool
- `packages/mcp/src/server.ts` -- re-export `executeQueryModel`
- `packages/vscode/src/mcp/ToolRegistration.ts` -- wrap `query_model`
- `packages/vscode/package.json` -- declare `barwise_query_model` tool
- `packages/vscode/src/chat/chatPrompts.ts` -- prefer deterministic
  queries; add `/query` command
- `barwise/docs/CLI.md`, `barwise/docs/MCP.md` -- document the surface

## Test coverage

- `parseQuery`: every command, quoting, optional args, malformed input.
- `queryModel`: every query kind, including not-found, transitive
  subtype walks, and multi-hop path finding.
- `formatQueryResult`: each result kind renders without throwing.
- CLI: `barwise query` text and `--json` output, error exit codes.
- MCP: `query_model` returns structured JSON; parse errors surface.

## Success criteria

- `ModelQuery` / `QueryResult` are exported and documented.
- `barwise query <file> <query>` works for all 13 commands.
- `query_model` MCP tool is registered.
- The chat participant's system prompt directs it to use
  `barwise_query_model` for at least 5 deterministic question types
  (entities, fact types of an entity, constraints, connectivity, stats).
- The full monorepo build and test suite pass.
