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
barwise/docs/ARCHITECTURE.md, barwise/packages/mcp/tests/serverSpawn.test.ts

## Principle

`docs/adr/surface-capability-parity.md` makes the matrix in the root
`CLAUDE.md` the record of which surface reaches which capability, and
nothing compares it with the code. Twice a claim in it was false for
the life of the claim (the ADR's Context: barwise-988, and the 2026-08-20
audit). The registrations are exact and cheap to read: the CLI's
commander tree, the MCP server's `listTools`, and VS Code's
`contributes` block. So the check reads them, not their pinned copies,
and compares the matrix with them. This is the shadow-and-property rule
in the root `CLAUDE.md`: the pinned lists stand in for the registrations,
and they stop matching exactly when someone updates a list and not the
matrix.

## The reading this spec starts from (main at ad21dea9)

- The matrix has 22 rows of four kinds: whole commands (`merge`,
  `history`), command groups ("validate, verbalize, diagram, export,
  import, analyze"), subcommands (`project split`, `prompt eval`) and
  options (`--samples`, `--matching content`). Each row has three
  `yes`/`no` cells and a Divergence cell that starts `none`,
  `deliberate`, `deliberate (owner)` or `not yet`.
- CLI: `createProgram()` in `packages/cli/src/cli.ts` registers every
  command in `COMMANDS` when it is given no name, and the built
  `dist/cli.js` exports it. The subcommands and options of each command
  are on the commander tree.
- MCP: `createServer()` in `packages/mcp/src/server.ts`; a client over
  `InMemoryTransport` lists 19 tools with their input schemas
  (`serverTransport.test.ts` already does this).
- VS Code: `packages/vscode/package.json` declares 16
  `languageModelTools` (each with an `inputSchema`) and 12
  `contributes.commands`. Six of those commands are editor helpers
  (`highlightInDiagram`, `copyElementName`, `addToView`, `createView`,
  `newProject`, `setAnthropicApiKey`) that no matrix row is about.
- The pinned lists: `serverSpawn.test.ts` (MCP, `toEqual`, not tagged)
  and `toolRegistration.test.ts` (VS Code, `toEqual`, tagged
  `[adr:surface-capability-parity#pinned-tool-lists]`). `check:adr-tests`
  passes when any one tagged test passes, so the MCP test carries no
  weight for decision 4 today.
- CI builds before `test:coverage`, behind the docs-only guard.

## Scope

1. **A map from each matrix row to the registrations it is about.**
   `scripts/lib/capability-map.json` names, per row, the CLI path
   (`merge`, `project split`, `import transcript --samples`), the MCP
   tool or tool input (`merge_models`, `import_transcript.samples`) and
   the VS Code palette command, language-model tool or tool input, with
   `null` for a surface the row says it does not reach. It also lists
   the registrations no row is about (the six editor helpers), each with
   its reason. The row's text in the matrix is the key.
2. **`check:capability-matrix`** reads the matrix, the map and the
   registrations, and fails (exit 1) on:
   - a matrix row with no map entry, or a map entry with no row;
   - a cell that disagrees with the map: `yes` where the map names
     nothing for that surface, or `no` where it names something;
   - a name in the map that the surface does not register (a removed
     tool still marked `yes`);
   - a registration that no row and no exclusion names (a tool added to
     the code and its pinned list with the matrix unchanged, the case
     barwise-1005 describes);
   - a Divergence cell outside the vocabulary: `none` on a row with a
     `no`; `not yet` without a workstream (`WS<n>`) or an issue id;
     `deliberate` without a reason; any other first word.
     It refuses (exit 2) when a surface's registrations cannot be read
     (a missing build, a server that does not answer), and never prints
     OK then.
3. **Two halves, so a docs-only change is still checked.** The matrix
   against the map needs no build, so it runs in the unguarded static
   section of `ci.yml`. The map against the registrations needs the
   build, so it runs after `npm run build` behind the docs-only guard. A
   docs-only pull request cannot change the map (it lives under
   `scripts/`) or the registrations, so the static half covers it.
4. **Decision 3** (`vscode-yes-means`) is held by construction: the map's
   VS Code entries can name only a palette command or a language-model
   tool, which the check reads from `contributes`. A `yes` resting on a
   language-model tool needs no extra mark in the matrix, since the
   ADR's own qualifier (`barwise.enableMcpServer`) covers every such row.
5. **Decision 4** (`pinned-tool-lists`): tag the MCP test, and have the
   check require that each surface's pinned list equals what that
   surface registers. A pinned list that drifts from the registrations
   already fails its own test; what this adds is that deleting one of
   the two tests, or swapping `toEqual` for `arrayContaining`, fails
   the check, because the check reads the list out of each test's
   source and requires the `toEqual` form. See open decision 2 for the
   cheaper alternative.

Out of scope: whether a capability behaves the same on each surface
(rows record reach, barwise-1fr); parameter-level parity beyond the
option rows the matrix already has, which is `surface-mirroring.spec.md`
WS1 (`audit:surfaces`); VS Code's Import and Export pickers offering
only some formats (barwise-i22), a behaviour question decision 3 does
not ask.

## Alternatives considered

- **Static parsing of the source**, so the whole check runs without a
  build. The VS Code half is static already. The MCP tool names can be
  read by regex, but an option row needs the tool's input schema, which
  is Zod in source. A regex over Zod is the instrument that looks the
  same whether or not it can read its input. Rejected for the MCP and
  CLI halves.
- **Comparing the matrix with the pinned lists** instead of the
  registrations. Cheaper, and it is what the refactor plan wrote. But a
  pinned list is a copy, and the CLI has no pinned list of subcommands
  or options. Rejected.
- **Annotating the matrix in `CLAUDE.md`** with the registration names
  instead of a separate map. One file instead of two, but it puts
  tool ids in a table written for people, and the root `CLAUDE.md` is
  read every session. Rejected; the check holds the two copies together
  in both directions, which is what `must-agree-copies` asks.
- **Folding this into `audit:surfaces`** (surface-mirroring WS1). That
  workstream is a baseline of every option gap, which the owner has not
  scheduled. This check is the row-level half it needs anyway and can
  read the same registrations; WS1 can extend it.

## Workstreams (each independently shippable)

### 1. The check, the map, and CI

`check-capability-matrix.mjs` with `--static` (matrix against map) and
the full run (map against registrations); `capability-map.json` for all
22 rows; both wired into `ci.yml` per Scope 3. Tests plant each finding
red: a row deleted from the map, a `yes` flipped to `no`, a tool added
to a fake registration, a Divergence of `under review`, `not yet`
without a workstream, and the refusal on a missing `dist`. One probe
per decision held, each an edit the gate reads without a rebuild:
`matrix-records-reach` flips a `yes` to `no` in `CLAUDE.md`;
`matrix-same-commit` adds a `languageModelTools` entry to
`packages/vscode/package.json`, which the check reads from source. A
probe of an MCP or CLI source edit would read MISSED, because the full
run reads `dist`; that is recorded with the probes, not hidden. The
ADR's `Enforced-by` and
Consequences change in the same PR, and the gate is run on main before
it lands: any disagreement it finds today is fixed in the matrix or
the map, with the reason in the PR.

### 2. The pinned lists (provisional: open decision 2)

## Open decisions (for review)

1. **"Same commit" or "same pull request"** (decision 2). CI checks the
   head of a pull request and every push to main, so a pull request
   whose first commit adds a tool and whose last updates the matrix
   passes. Recommended: restate decision 2 as "a change to a surface's
   reach is not merged without the matrix agreeing", which is what the
   check holds. That rewords a decision, so it is the owner's call;
   until then the gap issue stays open for the per-commit half.
2. **Decision 4 once the matrix is checked.** The check compares the
   matrix with the registrations directly, so the pinned lists stop
   being the matrix's "executable form". Option A (recommended): keep
   them as change detectors, tag the MCP test, and have
   `check:adr-tests` require one passing tagged test per named file.
   Option B: retire decision 4 to prose, since a list that only says
   "something changed" protects nothing the check does not. Option C:
   WS2 as written in Scope 5. The owner decides.

## Risks and testing

- The map is a second copy of the matrix. The check fails on any
  disagreement in either direction, so it cannot drift silently.
- The full run imports built code. A stale `dist` is the CI build's,
  which runs in the same job before the check.
- Running the gate on main may find disagreements (for example, a row
  marked `yes` for a tool that was renamed). WS1 fixes each in the same
  PR and names it.

## Non-goals

- Checking behaviour, parameter shapes beyond the option rows, or user
  docs (the `gettingStartedDocs.test.ts` files check those names).
