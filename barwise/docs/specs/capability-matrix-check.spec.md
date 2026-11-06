# The capability matrix, checked against what each surface registers

Status: WS1 implemented 2026-11-06 (check:capability-matrix, full run and --static, with capability-map.json for all 22 rows and their cells; probes for matrix-records-reach, matrix-same-commit and vscode-yes-means CAUGHT; the gate agreed with main on its first run; code review dropped the stale-build refusal and made --static compare cells); WS2 planned (re-grounded 2026-11-06; plan review pending)
Created: 2026-11-06
Last-updated: 2026-11-06
Plan-reviewed: 8d9588bb (code-review, pr-review)
Tracking: barwise-ym8.gc9 (adr-refactor batch 5), barwise-ym8.wfy,
barwise-ym8.3nm, barwise-ym8.0hi, barwise-ym8.0pq, barwise-1005, barwise-xpt
Touches: CLAUDE.md, package.json, +barwise/scripts/check-capability-matrix.mjs,
+barwise/scripts/lib/capability-map.json, barwise/scripts/tests/,
+barwise/scripts/tests/check-capability-matrix.test.mjs,
barwise/package.json, .github/workflows/ci.yml, +barwise/docs/adr/tested-in.json, barwise/scripts/check-adr-tests.mjs,
barwise/scripts/lib/adr-facts.mjs, barwise/scripts/lib/adr-judge.mjs,
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
   missing `dist`, an empty listing of the extension's tracked source, or
   a server that does not answer. It never prints OK then. (WS1 first
   refused a `dist` older than its `src`; code review showed the
   packages build incrementally, so an up-to-date build can be older than
   a source file git rewrote, and the refusal would never clear. Dropped:
   CI and `ci:local` build before the check.)
3. **`--static`, a subset for docs-only changes.** The map also records
   each row's three cells. The rows and cells against the map, and the
   Divergence vocabulary, need no build, so `--static` runs them in the
   unguarded static section of `ci.yml`. The full run does everything
   `--static` does and then holds the map's cells to the registrations,
   after `npm run build` behind the docs-only guard. A docs-only pull
   request cannot change the map (it lives under `scripts/`) or the
   registrations, so a cell it flips disagrees with the map and
   `--static` fails it. (WS1 first checked only rows and labels there;
   code review showed a docs-only flip of a cell passed CI.) Only the full run is named in
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
  not answer". Rejected; the cost is that a local run reads whatever
  build is there, which CI and `ci:local` make first.
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
Divergence of `under review`, `not yet` without a workstream or on a
row with no `no`, a cell flipped in the matrix alone, and the refusals
on a missing `dist` and a missing matrix. Probes, all against the full
run and read without a rebuild: `matrix-records-reach` flips the
`migrate` row's MCP cell to `yes` in `CLAUDE.md`, leaving its
Divergence valid, so the vocabulary rule cannot be what catches it;
`matrix-same-commit` adds a `languageModelTools` entry to
`packages/vscode/package.json`; `vscode-yes-means` renames a contributed
palette command. A probe of an MCP or CLI source edit would read
MISSED, since the full run reads their build; that is stated here
rather than probed. The
ADR's `Enforced-by` and Consequences change in the same PR, and the
gate runs on main before it lands; any disagreement is fixed in the
same PR and named.

### 2. One pinned test per surface

Grounding (main at dd5af687): both report formats `check:adr-tests`
reads carry each test's source file, vitest as `testResults[].name` and
`test-tag-reporter.mjs` as `file`, both absolute; `readTestReports`
drops it today. The two tests decision 4 rests on are
`mcp/tests/serverSpawn.test.ts` and
`vscode/tests/unit/toolRegistration.test.ts`; the ADR names them only in
Consequences prose.

- **Where a decision names its files: `docs/adr/tested-in.json`**, a list
  of `{ decision, files, why }` rows beside `probes.json`, `files` as
  repository paths. Reading paths out of Consequences prose was the
  first form, and was dropped: prose names files for other reasons too,
  and a rule a reader cannot see from the text is the unknown unknown
  the header exists to remove. A header grammar change was the second,
  and was dropped as wider than one decision needs.
- **The rule**: for each row, every named file has a passing test that
  carries the decision's tag in its own title, read from the reports
  this run wrote. A file whose tagged tests all skipped is a refusal, as
  for a decision today; so is a file with no tagged test when any report
  was unreadable (the decision rule's branch, reused). With every report
  read, a file with no passed tagged test and at least one failed, or
  none at all, is a finding naming the file. A row whose decision is not
  a `tests` entry of its ADR, or whose file is not tracked, is a finding
  (a row that outlived its decision).
- **The readers** stay in `adr-facts.mjs` (the reader/judge split):
  `readTestedIn(root)` returns the rows and the tracked paths they name,
  or null when `tested-in.json` is missing, unparsable or not a list of
  `{ decision, files, why }` rows, which the gate turns into a refusal,
  never zero rows. The report readers keep each entry's file as a path
  relative to the **report's own directory** (`packages/<pkg>/` for a
  vitest report, `scripts/tests/` for a script report), taken from the
  part of the absolute path after that directory's last occurrence:
  plan review found turbo's shared cache restores a report written in
  another checkout, so its absolute prefix is not this root's. A null
  `file` (the tag reporter writes `d.file ?? null`) leaves the entry
  out of the per-file rule only.
- **The judge** returns per-file skips as their own count, and the gate's
  summary arithmetic reads it, so a per-file refusal is neither counted
  as an unproven decision nor counted twice with the decision rule.
- **One copy of the list**: CLAUDE.md's sentence naming the two pinned
  tests points at `tested-in.json` instead of restating the paths.
- **Planted red** in the gate's own tests (a temp tree with reports): one
  of two named files passing, a named file untagged, a stale row, an
  untracked path. No probe: probes plant a source edit and run a gate
  named in `Enforced-by`, and decision 4 is a `tests` entry.
- **Consequences** of surface-capability-parity name `tested-in.json`
  for decision 4, and barwise-ym8.0pq narrows to the `toEqual` form,
  which stays to review (open decision 2, option A).

## Open decisions (for review)

1. **"Same commit" or "same pull request"** (decision 2). **Resolved
   (owner, 2026-11-06): same pull request;** decision 2 is restated, and
   barwise-ym8.3nm closes. CI checks a
   pull request's head and every push to main, so a pull request whose
   first commit adds a tool and whose last updates the matrix passes.
   Recommended: restate decision 2 as "a change to a surface's reach is
   not merged without the matrix agreeing", which is what the check
   holds. It rewords a decision, so it is the owner's call; until then
   barwise-ym8.3nm stays open for the per-commit half.
2. **The pinned lists once the matrix is checked.** **Resolved
   (owner, 2026-11-06): option A, "for now";** WS2 builds the one-per-file rule.
   The check reads the
   registrations directly, so the pinned lists stop being the matrix's
   "executable form". Option A (recommended): keep them as change
   detectors, with WS2's one-per-file rule, and leave the `toEqual` form
   to review. Option B: retire decision 4 to prose. Option C: have the
   check also read each pinned list from its test source and require the
   `toEqual` form.
3. **What VS Code reach counts.** **Resolved (owner, 2026-11-06): the provider
   and the chat participant do not count;** decision 3 stands, and the
   ADR's Consequences say so. Decision 3 counts a palette command or
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
- The full run imports built code, so a developer who pulls and runs
  it without building reads the old build. CI and `ci:local` build
  first.
- Running the gate on main may find disagreements; WS1 fixes and names
  each.

## Non-goals

- Checking behaviour, parameter shapes beyond the option rows, or user
  docs (the `gettingStartedDocs.test.ts` files check those names).
