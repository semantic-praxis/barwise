# `source` accepts a file object across interfaces, not just a string

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-21
Last-updated: 2026-06-21
Tracking: barwise-8sq (feature); relates to barwise-5d7 (workspace
rename) and barwise-r4f (project wiring)

## Principle

This is an _explicit over implicit_ fix. The shared resolver behind every
MCP tool (and, through them, the VS Code Language Model Tools) takes
`source` as a bare string and guesses what it is: `isFilePath` treats a
newline as "inline YAML," a `.yaml` suffix as "a path," an
existing-on-disk string as "a path," and everything else as inline
content. The guess is wrong at the edges -- a path that does not yet exist
and lacks a `.yaml` suffix is parsed as YAML and fails with a
deserialization error, not a "file not found"; a one-line inline model
with no newline and no suffix is ambiguous. A caller that _knows_ whether
it holds a path or content has no way to say so.

The cost is sharpest in VS Code. There the tool `source` is filled by the
language model, and Copilot routinely pastes the open file's YAML inline
as that string -- so barwise validates the model's transcription of the
file (stale, reflowed, or truncated), not the file. When `source` is left
empty the extension falls back to the open file's _path_ and reads it from
disk, so unsaved editor edits are invisible. Both failure modes are the
same gap: the caller cannot say "here is the path, and here is the live
content."

Letting `source` also be a structured file object -- `{ path }`,
`{ content }`, or `{ path, content }` -- lets each interface state intent
instead of relying on a heuristic. The string form stays, so nothing
breaks; the object form is the explicit path. This serves composability:
the one shared resolver gains the object handling once, the eleven tools
inherit it, and the VS Code wrapper becomes a deterministic consumer of
the combined `{ path, content }` shape rather than a pass-through for
whatever the model typed.

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
- VS Code resolving the open model to `{ path, content }` -- the document
  path plus its live buffer -- so tools act on exactly what the user sees,
  unsaved edits included, with no reliance on the model typing `source`.
  Includes the `package.json` LM-tool schema update to advertise the
  object form.

Out of scope (track as follow-ups):

- An in-memory project manifest (`{ content }` that is a manifest): a
  manifest references domain files by path, so assembling it from content
  alone is a separate, larger change. v1 requires a path for projects.

## Inventory

| Module                           | Current state                         | Verdict                                          |
| -------------------------------- | ------------------------------------- | ------------------------------------------------ |
| `mcp/src/helpers/resolve.ts`     | `source: string` + `isFilePath` guess | Accept `SourceInput`; normalize once             |
| `mcp/src/helpers/response.ts`    | `spillDir(source?: string)`           | Take the resolved path string (unchanged sig)    |
| `mcp/src/tools/*.ts` (11 tools)  | `source: z.string()`                  | Use shared `sourceInputSchema`; pass through     |
| `mcp/src/tools/index` exports    | `execute*(source: string, ...)`       | Widen to `SourceInput` (string still assigns)    |
| `vscode/.../openModel.ts`        | resolves the open model to a path     | Also return the live buffer: `{ path, content }` |
| `vscode/.../ToolRegistration.ts` | `resolveSourceParam` -> path string   | Return `SourceInput`; pass the object through    |
| `vscode/package.json` LM tools   | `"source": {"type": "string"}`        | Advertise string-or-object for `source`          |

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

VS Code: resolveSourceParam(llmSource)
  llm gave a path/content -> pass it through (object or string)
  else open .orm.yaml editor -> { path: doc.fsPath, content: doc.getText() }
  else open diagram only     -> { path: diagramModelPath }
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

### 3. VS Code resolves the open model to `{ path, content }`

Make `openModel.ts` return the active `.orm.yaml` editor's path _and_ its
live text (a diagram-only context stays `{ path }`); change
`resolveSourceParam` to yield a `SourceInput` and pass the object straight
into the `execute*` calls. An explicit path/content the model supplied
still wins. Advertise the object form in the `package.json` LM-tool
`source` schemas. This is the workstream that closes the user-visible
glitch: "validate the open file" parses the buffer on screen, not
Copilot's retyping of it or a stale copy on disk. Builds on WS2 (the
`execute*` signatures must accept `SourceInput` first).

## API and migration impact

- `@barwise/mcp` exports a new `SourceInput` type; `execute*` signatures
  widen `source` from `string` to `SourceInput`. A `string` argument still
  satisfies the union, so any caller that keeps passing strings compiles
  and runs unchanged.
- The MCP tool input schema for `source` becomes a `oneOf` (string or
  object). MCP clients that drive tools with an LLM see both forms; the
  `.describe` states when to use each. No client must change.
- VS Code is the one interface whose _behavior_ changes: the open-file
  case now parses the live buffer instead of the model's string or the
  on-disk copy. This is the intended fix, guarded by a wrapper test.
- No `core` change. No `.orm.yaml` / `.orm-project.yaml` format change.

## Open decisions (for review)

- **Combined `{ path, content }` semantics.** Resolved by WS3 making VS
  Code its first consumer: parse `content`, use `path` only as the file's
  location (spill/lineage, project detection). The alternative -- rejecting
  the combined form -- would leave the VS Code glitch unfixed, since the
  open-buffer case needs exactly path-plus-content.
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
- VS Code behavior change is the one intentional break in continuity: a
  wrapper test asserts the open-editor case resolves to `{ path, content }`
  with the live buffer text, and that an explicit model-supplied source
  still takes precedence.
