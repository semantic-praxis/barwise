# The capability matrix, checked against what each surface registers

Status: Draft -- no workstream implemented
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 5), barwise-ym8.wfy,
barwise-ym8.3nm, barwise-ym8.0hi, barwise-ym8.0pq, barwise-1005, barwise-xpt
Touches: CLAUDE.md, +barwise/scripts/check-capability-matrix.mjs,
+barwise/scripts/lib/capability-map.json, barwise/scripts/tests/,
barwise/package.json, .github/workflows/ci.yml,
barwise/docs/adr/surface-capability-parity.md, barwise/docs/adr/probes.json,
barwise/docs/ARCHITECTURE.md, barwise/scripts/check-adr-tests.mjs

## Principle

`docs/adr/surface-capability-parity.md` makes the matrix in the root
`CLAUDE.md` the record of which surface reaches which capability, and
nothing compares it with the code. Twice a claim in it was false for
the life of the claim (the ADR's Context: barwise-988, and the 2026-08-20
audit). What each surface offers is exact and cheap to read: the CLI's
commander tree, the MCP server's `listTools`, and VS Code's
`contributes` block together with the commands the extension registers.
So the check reads those, not the pinned lists that copy them, and
compares the matrix with them. This is the shadow-and-property rule in
the root `CLAUDE.md`: the pinned lists stand in for the registrations,
and they part from the matrix exactly when someone updates a list and
not the matrix.

## The reading this spec starts from (main at ad21dea9)

- The matrix has 22 rows of four kinds: whole commands (`merge`,
  `history`), command groups ("validate, verbalize, diagram, export,
  import, analyze"), subcommands (`project split`, `prompt eval`) and
  options (`--samples`, `--matching content`). Each row has three
  `yes`/`no` cells and a Divergence cell that starts `none`,
  `deliberate`, `deliberate (owner)` or `not yet`. Plan review mapped
  all 22 to registrations, and every cell agrees with the code under
  decision 3's definition of a VS Code `yes`.
- CLI: `createProgram()` in `packages/cli/src/cli.ts` registers every
  command in `COMMANDS` when it is given no name; the built
  `dist/cli.js` exports it, and the subcommands and options are on the
  commander tree.
- MCP: `createServer()` in `packages/mcp/src/server.ts`. Plan review
  listed all 19 tools with their input schemas from `dist/server.js`
  over `InMemoryTransport`, including `import_transcript.samples`,
  `export_model.options.surrogateKeys` and `diff_models.matching`. The
  existing `listTools` callers are `serverSpawn.test.ts` (stdio, against
  `dist/index.js`) and two tool tests.
- VS Code: `packages/vscode/package.json` declares 16
  `languageModelTools` (each with an `inputSchema`) and 12
  `contributes.commands`. Six commands are editor helpers no row is
  about (`highlightInDiagram`, `copyElementName`, `addToView`,
  `createView`, `newProject`, `setAnthropicApiKey`). It also declares
  two reach paths decision 3 does not name: `mcpServerDefinitionProviders`
  (`barwise.mcpServer`, which hands the whole bundled MCP server to the
  editor's chat while `barwise.enableMcpServer` is on) and a chat
  participant with 14 slash commands. Palette commands are registered in
  `src/client/extension.ts`; the language-model tools are tied to their
  declarations by `toolRegistration.test.ts` ("registers exactly what
  package.json declares"), and palette commands by nothing that runs in
  CI. `barwise.loadView` is registered and not contributed.
- The pinned lists: `serverSpawn.test.ts` (MCP) and
  `toolRegistration.test.ts` (VS Code) both assert the sorted list with
  `toEqual` and both carry `[adr:surface-capability-parity#pinned-tool-lists]`.
  `check:adr-tests` passes when any one tagged test passes, and nothing
  checks the `toEqual` form (barwise-ym8.0pq).
- CI builds before `test:coverage`, behind the docs-only guard.

## Scope

1. **A map from each matrix row to the names that would carry its
   reach on each surface.** `scripts/lib/capability-map.json` names,
   per row and per surface, the CLI path (`merge`, `project split`,
   `import transcript --samples`), the MCP tool or tool input
   (`merge_models`, `import_transcript.samples`) and the VS Code palette
   command, language-model tool or tool input
   (`barwise_import_transcript.samples`). A name is given for a surface
   the row marks `no` as well: it is what would mean reach there, so the
   check can see the gap close. A surface where no single name would
   carry it (`history` on MCP, which would arrive as a new tool) is
   `null`, and the unnamed-registration rule below covers it. The map
   also lists the registrations no row is about, each with its reason:
   the six editor helpers, and the two reach paths of open decision 3
   until the owner answers it. The row's text in the matrix is the key.
2. **`check:capability-matrix`** fails (exit 1) on:
   - a matrix row with no map entry, or a map entry with no row;
   - a cell that disagrees with the code: `yes` where the mapped name is
     not registered (or is `null`), `no` where it is;
   - a registration that no row and no exclusion names, at the level of
     a CLI command or subcommand, an MCP tool, a VS Code palette command
     or language-model tool, a chat participant command, or a
     contributed provider;
   - a VS Code palette command contributed and not registered in the
     extension source, or registered and neither contributed nor
     excluded (`barwise.loadView` is the one today, excluded with its
     reason);
   - a Divergence cell outside the vocabulary: `none` on a row with a
     `no`; `not yet` without a workstream (`WS<n>`) or an issue id;
     `deliberate` without a reason; any other first word.

   It refuses (exit 2) when a surface's registrations cannot be read: a
   missing `dist`, a `dist` older than its package's `src` (a stale local
   build), or a server that does not answer. It never prints OK then.
3. **`--static`, a subset for docs-only changes.** The rows against the
   map and the Divergence vocabulary need no build, so `--static` runs
   them in the unguarded static section of `ci.yml`. The full run does
   everything `--static` does and then reads the registrations, after
   `npm run build` behind the docs-only guard. A docs-only pull request
   cannot change the map (it lives under `scripts/`) or the
   registrations, so `--static` covers it. Only the full run is named in
   the ADR's `Enforced-by`, so every probe runs against a check that
   reads everything.
4. **Decision 3** (`vscode-yes-means`): the map's VS Code names can only
   be a palette command, a language-model tool or one of their inputs,
   and the check reads both from `contributes` and the palette
   registrations from the extension source. A `yes` on a language-model
   tool needs no mark in the matrix: the ADR's qualifier
   (`barwise.enableMcpServer`) covers every such row.
5. **Decision 4** (`pinned-tool-lists`): `check:adr-tests` learns to
   require a passing tagged test in each file a decision names, so
   deleting or untagging one surface's test fails. Whether the `toEqual`
   form is also checked is open decision 2.

Out of scope: whether a capability behaves the same on each surface
(rows record reach, barwise-1fr); parameter parity beyond the option
rows the matrix has, which is `surface-mirroring.spec.md` WS1
(`audit:surfaces`); VS Code's Import and Export pickers offering only
some formats (barwise-i22), a behaviour question.

## Alternatives considered

- **Static parsing of the source**, so the whole check runs without a
  build. The VS Code half is static already. MCP tool names could be
  read by regex, but an option row needs the input schema, which is Zod
  in source, and a regex over Zod is an instrument that looks the same
  whether or not it read its input. Rejected for the MCP and CLI halves.
- **A vitest test that imports `src`** (as the MCP tool tests do), so a
  source edit is seen without a build and probes of MCP and CLI edits
  are caught. It would report through `check:adr-tests` rather than an
  `npm` gate, so it would have no `--static` half for docs-only pull
  requests and no exit-2 refusal of its own; a test cannot be "could
  not answer". Rejected; the full run instead refuses a `dist` older
  than `src`, so a stale build is a refusal, not a wrong answer.
- **Comparing the matrix with the pinned lists**, which is what the
  refactor plan wrote. Cheaper, but a pinned list is a copy, and the CLI
  has no pinned list of subcommands or options. Rejected.
- **Annotating the matrix in `CLAUDE.md`** with registration names
  instead of a separate map. One file, but tool ids in a table written
  for people, in a file read every session. Rejected; the check holds
  the two copies together in both directions (`must-agree-copies`).
- **Folding this into `audit:surfaces`** (surface-mirroring WS1), a
  baseline of every option gap that is not scheduled. This check is the
  row-level half it needs anyway; WS1 can extend it.

## Workstreams (each independently shippable)

### 1. The check, the map, and CI

`check-capability-matrix.mjs` (full run and `--static`) and
`capability-map.json` for all 22 rows; both wired into `ci.yml` per
Scope 3. Tests plant each finding red: a row deleted from the map, a
cell flipped, an option added to a surface marked `no` (the
`not yet` row's gap closing unrecorded), a tool added to a fake
registration, a palette command contributed and not registered, a
Divergence of `under review`, `not yet` without a workstream, and the
refusals on a missing and a stale `dist`. Probes, both against the full
run and both read without a rebuild: `matrix-records-reach` flips a
`yes` to `no` in `CLAUDE.md`; `matrix-same-commit` adds a
`languageModelTools` entry to `packages/vscode/package.json`. A probe
of an MCP or CLI source edit makes `src` newer than `dist`, which the
check refuses; that is stated beside the probes rather than probed. The
ADR's `Enforced-by` and Consequences change in the same PR, and the
gate runs on main before it lands; any disagreement is fixed in the
same PR and named.

### 2. One pinned test per surface

`check:adr-tests` reads, for a decision whose Consequences or
`Enforced-by` names its test files, a passing tagged test in each.
Small; it closes the "any one tagged test" half of barwise-ym8.0pq.
The `toEqual` half waits on open decision 2.

## Open decisions (for review)

1. **"Same commit" or "same pull request"** (decision 2). CI checks a
   pull request's head and every push to main, so a pull request whose
   first commit adds a tool and whose last updates the matrix passes.
   Recommended: restate decision 2 as "a change to a surface's reach is
   not merged without the matrix agreeing", which is what the check
   holds. It rewords a decision, so it is the owner's call; until then
   barwise-ym8.3nm stays open for the per-commit half.
2. **The pinned lists once the matrix is checked.** The check reads the
   registrations directly, so the pinned lists stop being the matrix's
   "executable form". Option A (recommended): keep them as change
   detectors, with WS2's one-per-file rule, and leave the `toEqual` form
   to review. Option B: retire decision 4 to prose. Option C: have the
   check also read each pinned list from its test source and require the
   `toEqual` form.
3. **What VS Code reach counts.** Decision 3 counts a palette command or
   a language-model tool. The bundled MCP server provider also puts every
   MCP tool in the editor's chat, gym and `--samples` included, while
   the matrix reads `no` for them; and the chat participant offers 14
   slash commands. Recommended: keep decision 3 as written, so the
   column means what an extension user reaches without the MCP route,
   and add one Consequences line saying the provider makes MCP's column
   reachable from the editor's chat too. The alternative makes VS Code's
   column a superset of MCP's whenever the setting is on, which hides
   the gaps the surface-mirroring workstreams close. Until answered, the
   map excludes both paths with this reason.

## Risks and testing

- The map is a second copy of the matrix. The check fails on any
  disagreement in either direction.
- The full run imports built code and refuses a stale build, so a
  developer who pulls without building gets a refusal, not a pass.
- Running the gate on main may find disagreements; WS1 fixes and names
  each.

## Non-goals

- Checking behaviour, parameter shapes beyond the option rows, or user
  docs (the `gettingStartedDocs.test.ts` files check those names).
