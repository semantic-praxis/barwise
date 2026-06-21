# MCP `source` accepts a file object, not just a string

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-21
Last-updated: 2026-06-21
Tracking: barwise-8sq (feature); relates to barwise-5d7 (workspace
rename) and barwise-r4f (project wiring)

## Principle

This is an _explicit over implicit_ fix. Every MCP tool takes `source`
as a bare string and guesses what it is: `isFilePath` treats a newline as
"inline YAML," a `.yaml` suffix as "a path," an existing-on-disk string as
"a path," and everything else as inline content. The guess is wrong at
the edges -- a path that does not yet exist and lacks a `.yaml` suffix is
parsed as YAML and fails with a deserialization error, not a "file not
found"; a one-line inline model with no newline and no suffix is ambiguous.
A caller that _knows_ whether it holds a path or content has no way to say
so.

Letting `source` also be a structured file object -- `{ path }`,
`{ content }`, or `{ path, content }` -- lets the caller state intent
instead of relying on a heuristic. The string form stays, so nothing
breaks; the object form is the explicit path. This also serves
composability: the one shared resolver (`resolveSource` / `resolveModels`)
gains the object handling once and all eleven tools inherit it.

## Should we keep the string form? (resolved: yes)

Yes -- the string form stays as the back-compat default. Every existing
caller (the MCP zod schemas, the VS Code Language Model Tools, the test
suite) passes a string today, and the heuristic is correct in the common
cases (an `.orm.yaml` path, a multi-line inline model). Removing it would
be a breaking change for no gain. The object form is _added_ as the
explicit alternative; `source` becomes `string | FileObject`. A string is
still resolved by the heuristic; an object never is.

## Scope

In scope:

- A `SourceInput = string | { path?, content? }` type and its
  normalization in the shared resolver. `resolveSource`, `readSource`,
  `resolveModels`, and `isProjectSource` accept `SourceInput`.
- A single shared `sourceInputSchema` (zod) reused by all eleven
  source-taking tools, replacing the per-tool `z.string()`.
- Threading the resolved originating path (when known) to
  `boundedTextResult` so spill/lineage files still land next to the
  source file, not the cwd, when a `{ path }` object is used.

Out of scope (track as follow-ups):

- VS Code passing `{ path, content }` for an unsaved editor buffer (parse
  the live content, locate spill/lineage by the document path). Real value
  -- it is the motivating case for the combined object -- but it is VS Code
  wiring plus `package.json` LM-tool schema edits; its own issue.
- An in-memory project manifest (`{ content }` that is a manifest): a
  manifest references domain files by path, so assembling it from content
  alone is a separate, larger change. v1 requires a path for projects.

## Inventory

| Module                           | Current state                         | Verdict                                       |
| -------------------------------- | ------------------------------------- | --------------------------------------------- |
| `mcp/src/helpers/resolve.ts`     | `source: string` + `isFilePath` guess | Accept `SourceInput`; normalize once          |
| `mcp/src/helpers/response.ts`    | `spillDir(source?: string)`           | Take the resolved path string (unchanged sig) |
| `mcp/src/tools/*.ts` (11 tools)  | `source: z.string()`                  | Use shared `sourceInputSchema`; pass through  |
| `mcp/src/tools/index` exports    | `execute*(source: string, ...)`       | Widen to `SourceInput` (string still assigns) |
| `vscode/.../ToolRegistration.ts` | passes `source?: string`              | No change (string is in the union)            |
| `vscode/package.json` LM tools   | `"source": {"type": "string"}`        | No change now; object form is a follow-up     |

The CLI is untouched: its `<source>` is a filesystem path argument, not a
path-or-content string, so the file-object ambiguity does not arise there.

## Target architecture

```
SourceInput = string | { path?: string; content?: string }   // >=1 of path/content

normalizeSource(input): { path?: string; content?: string }
  "x.orm.yaml" (string)      -> { path: "x.orm.yaml" }   // via isFilePath
  "name: ...\n..." (string)  -> { content: "name: ..." } // via isFilePath
  { path }                   -> { path }                 // explicit, no guess
  { content }                -> { content }              // explicit, no guess
  { path, content }          -> { path, content }        // content parsed; path = location

resolveSource(input)  : read content ?? readFile(path), deserialize
resolveModels(input,d): isProjectSource(path) -> loadProject(path) [content n/a in v1]
                        else single model via resolveSource
isProjectSource(input): normalized.path ends with ".orm-project.yaml"

boundedTextResult(text, { source: normalized.path, ... })  // spill beside the file
```

## Workstreams (each independently shippable)

### 1. Resolver accepts `SourceInput`

Add the `SourceInput` type and a private `normalizeSource`. Rewrite
`resolveSource` / `readSource` / `resolveModels` / `isProjectSource` to
normalize first, then branch on `{ path?, content? }`. A project still
requires a path (a manifest resolves referenced files relative to it); a
`{ content }`-only manifest errors with a clear message. Unit-test the
resolver directly: each input shape, the project-needs-a-path error, and
that a bare string still flows through the old heuristic unchanged.

### 2. Tools accept the object and thread the path

Add a shared `sourceInputSchema` (zod union with a `.describe`) and reuse
it across all eleven tools, replacing `z.string()`. Widen each `execute*`
signature's `source` to `SourceInput`. Where a tool spills output
(`verbalize`, `export`, `diagram`), pass the normalized path to
`boundedTextResult` so spill/lineage still land beside the file. Extend
each tool's test with one object-form case; the existing string cases are
the back-compat guard.

## API and migration impact

- `@barwise/mcp` exports a new `SourceInput` type; `execute*` signatures
  widen `source` from `string` to `SourceInput`. A `string` argument still
  satisfies the union, so the VS Code Language Model Tools and every test
  compile and run unchanged.
- The MCP tool input schema for `source` becomes a `oneOf` (string or
  object). MCP clients that drive tools with an LLM see both forms; the
  `.describe` states when to use each. No client must change.
- No `core` change. No `.orm.yaml` / `.orm-project.yaml` format change.

## Open decisions (for review)

- **Combined `{ path, content }` semantics.** Recommend: parse `content`,
  use `path` only as the file's location (spill/lineage, project
  detection). This is the unsaved-editor-buffer case. The alternative --
  rejecting the combined form -- loses the one shape that motivates an
  object over two scalars.
- **Manifest as `{ content }`.** Recommend: v1 errors ("a project manifest
  requires a path"), since assembling a manifest from content alone means
  resolving its referenced files with no base directory. Tracked as a
  follow-up, not a silent partial behavior.
- **Sequencing with the `workspace/` rename (barwise-5d7).** Both touch
  `resolve.ts`. Recommend: land this feature first (it is the active
  request and the substantive change); the rename then sweeps the updated
  file as a pure move. The alternative (rename first) just renames a file
  about to change. Both land after PR #237 merges.

## Risks and testing

- The back-compat guard is the existing tool-test suite: every test passes
  a string and must stay green untouched. A regression there means the
  union changed string behavior, which it must not.
- The resolver gets direct unit tests for each input shape (the tools only
  spot-check one object case each), so the normalization is covered in one
  place rather than eleven.
- Spill-location regression: a `{ path }` object must spill beside the file
  exactly as the equivalent path string does -- assert the spill path in
  one tool test for both forms.
