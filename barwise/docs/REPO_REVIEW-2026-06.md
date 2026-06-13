# Repository Review -- June 2026

Status: Draft for review and prioritization
Scope: Architecture, testing, CI/tooling, documentation, and process
across the full monorepo (7 packages: core, diagram, llm, cli, mcp,
vscode, code-analysis).

Each item has a checkbox and a Priority field to fill in during
triage (e.g. P1/P2/P3, or "won't do"). Findings include file paths
so they can be turned directly into beads issues.

## Overall Verdict

This is a well-architected monorepo. The layering holds up under
scrutiny: core has no internal dependencies, the module dependency
graph is acyclic (verified -- no circular imports), CLI/MCP/VS Code
genuinely delegate to core rather than reimplementing logic, and the
format registry and LLM provider factory deliver the composability
that CLAUDE.md promises. Core is densely tested (~1,400 cases with
90%+ coverage thresholds) using round-trip tests rather than brittle
snapshots.

The issues below are mostly drift, gaps at the edges of the system,
and a few stated principles the code no longer fully honors. The
findings are consistent with a project that grew fast and well: the
architecture held, but documentation, CI duplication, and
edge-of-system testing did not keep pace.

## Top 5 (Highest Leverage)

### 1. Two sets of CI workflows exist, and one is dead

- [x] Priority: P1 -- resolved in this PR (June 2026 triage)

Resolution: deleted the dead nested `barwise/.github/` directory
entirely (both `ci.yml` and `release-vsix.yml`), leaving the root
`/.github/workflows/` as the single source of truth. This also
addresses the inner-`.github/` half of C2.

GitHub only executes workflows from the git root
(`/.github/workflows/`). That copy is the comprehensive one (build,
MCP bundle, publint, test, lint, knip, oxlint, madge circular check,
dprint fmt:check). The copy at `barwise/.github/workflows/ci.yml` is
never executed and has already drifted -- it only runs
build/test/lint. The stale copy actively misleads anyone reading the
repo (including automated reviewers).

Recommendation: delete `barwise/.github/workflows/` entirely, or
replace its contents with a README pointing at the root workflows.

### 2. Enforce the connector decision for I/O in core

- [ ] Priority: P2 (recommended) -- needs a spec before code; connector
      convention now documented in CLAUDE.md (June 2026 triage)

Decision context: I/O is done through format connectors registered
in the `FormatDescriptor` registry. The findings below are not a
question of whether the purity principle is right -- they are
pre-connector leftovers from early work that should be migrated to
the connector pattern. "Determinism in the core" (no I/O, no
clocks, no LLM in core) remains the design pillar; these violate
it:

- `core/src/lineage/manifest.ts` calls `readFileSync`,
  `writeFileSync`, and `mkdirSync`.
- `core/src/lineage/resolveArtifact.ts` does `fs.existsSync` and
  directory traversal.
- `core/src/import/DbtDialectDetector.ts` reads `process.env`
  (DBT_TARGET_TYPE) and looks up profiles.yml.
- Several dbt/sql importers (`DbtImportFormat.ts`,
  `DbtSqlCompiler.ts`, `SqlImportFormat.ts`,
  `DbtProjectImporter.ts`) and `serialization/ProjectLoader.ts`
  perform file I/O.

Recommendation:

- Migrate the leftovers to the connector pattern: route dbt/sql
  import I/O through their format connectors' boundary, move the
  lineage manifest read/write to the tool layer (CLI/MCP), and
  replace the `process.env` reads in DbtDialectDetector with an
  explicit option passed in by the caller.
- Document the connector convention. The term "connector" appears
  in the beads backlog (OWL/SHACL, PG-Schema, reference-ontology
  issues) but not in ARCHITECTURE.md or CLAUDE.md. Until the
  convention is written down where contributors will see it, new
  code will keep drifting the same way this leftover code did.
- Note that `@barwise/code-analysis` is the existing template for
  this: it is a connector package outside core that registers its
  TypeScript/Java/Kotlin importers into the FormatDescriptor
  registry via `registerCodeFormats()`, keeping its I/O (LSP
  sessions, repo scanning) out of core entirely. Future language
  connectors (e.g. Python) and potentially the dbt/sql connectors
  can follow the same shape, which would resolve the core purity
  violations structurally rather than case by case.

### 3. Coverage thresholds are never enforced

- [ ] Priority: P2 (recommended)

core, diagram, and llm define vitest coverage thresholds
(statements 90/94/78 respectively), but CI runs `npm run test`,
which does not collect coverage -- so the thresholds never gate a
merge. cli, mcp, vscode, and code-analysis have no coverage
configuration at all (vscode's vitest.config.ts has no coverage
block).

Recommendation: run `test:coverage` in CI for packages that have
thresholds; add at least modest thresholds to cli, mcp,
code-analysis, and the vscode unit-test surface.

### 4. CLAUDE.md has materially drifted

- [x] Priority: P1 -- resolved in this PR (June 2026 triage)

Resolution: added `@barwise/code-analysis` to the dependency graph
(described as a connector package) and to the package-specific CLAUDE.md
list; replaced the stale "1,686 tests across 6 packages" with a
non-rotting "full test suite passing in CI across all 7 packages"
phrasing; and added `packages/code-analysis/src/` to the root `circular`
madge script. (`packages/code-analysis/CLAUDE.md` already existed.)

- The dependency graph (CLAUDE.md "Dependency Graph") omits
  `@barwise/code-analysis` entirely. Actual deps: cli, mcp, and
  vscode all depend on it. When adding it, describe it as a
  connector package (it registers code importers into the
  FormatDescriptor registry) so the graph also teaches the
  connector convention from item 2.
- "1,686 passing tests across 6 packages" is stale: there are 7
  packages and ~155 test files (~1,650+ cases and growing).
- The package-specific CLAUDE.md list omits code-analysis (and
  `packages/code-analysis/CLAUDE.md` should exist).
- The root `circular` script (`barwise/package.json`) omits
  `packages/code-analysis/src/` from the madge check.

Recommendation: fix all four; consider replacing hardcoded test
counts with a phrase that does not rot ("full suite passing in CI").

### 5. Decide the MCP package's publishing story

- [x] Priority: resolved (June 2026 triage)

`@barwise/mcp` was the only non-private package, with a
`prepublishOnly` bundle hook, repository metadata, and npm keywords
-- but no publish workflow existed anywhere (release-vsix.yml only
builds the VSIX).

Decision: keep it private for the time being; npm publishing is not
planned in the near term. The package is now marked
`"private": true` like the rest of the workspace. The
`prepublishOnly` hook and repository metadata are retained so that
un-privating it later is a one-line change.

## Architecture

### A1. Break up the god files

- [ ] Priority: P3 (recommended) -- none urgent; ElkLayoutEngine first

Worst offenders, in order:

- `diagram/src/layout/ElkLayoutEngine.ts` (1,812 lines) -- ELK
  interop, two-pass layout, collision resolution, subtype radial
  placement, and edge routing in one file. Suggested split:
  ElkInterop, EntityPlacementPass, FactTypePlacementPass,
  PostAdjustments, EdgeRouter, CollisionResolver. Unaffected by the
  React front-end decision: layout runs host-side for every front
  end (webview or local server), so this stays the top
  decomposition target.
- `llm/src/DraftModelParser.ts` (953) -- four-pass algorithm;
  decomposes naturally into one file per pass plus a provenance
  helper.
- `vscode/src/diagram/DiagramPanel.ts` (898) -- do NOT refactor in
  place. Executing `diagram-presentation-contract.spec.md`
  dissolves it: the diagram domain logic moves to a unit-testable
  `DiagramSession` in `@barwise/diagram` and DiagramPanel becomes a
  thin VS Code adapter. See A6.
- `cli/src/commands/import.ts` (808) -- three subcommands
  (transcript, model, batch) in one file.
- `vscode/src/mcp/ToolRegistration.ts` (671) -- 14 near-identical
  tool wrappers; could be data-driven from a metadata table.
- `diagram/src/render/SvgRenderer.ts` (619) -- do NOT decompose;
  candidate for retirement under the React-first decision. See A6.
- `llm/src/ExtractionPrompt.ts` (561) -- consider extracting the
  constraint-inference rules.
- `vscode/src/commands/ImportTranscriptCommand.ts` (538) --
  orchestration + UI + merge logic; extract the merge logic.

None are urgent, but ElkLayoutEngine is where the next layout bug
will be expensive to fix.

### A2. No schema versioning / migration strategy

- [x] Priority: P2 -- resolved (spec: docs/specs/schema-versioning.spec.md)

Every `.orm.yaml` carries a `schemaVersion`, but the serializer
hardcodes `orm_version: "1.0"` and nothing checks or migrates
versions on read. Retrofitting migration after incompatible files
exist in the wild is much harder than adding a version check now.

Recommendation: at minimum, reject unknown versions with a clear
message; design the migration hook before the format needs to
change.

RESOLVED: a pure `serialization/schemaVersion.ts` holds the single
source of truth (`CURRENT_ORM_VERSION`), a migration registry
(`ORM_VERSION_MIGRATIONS`, empty today), and a pure planner
(`planMigration`/`applyMigrations`). `OrmYamlSerializer.deserialize`
now migrates an older document to the current version before schema
validation, and rejects an unsupported version with a clear message
(distinguishing "newer barwise" from "no migration path") instead of
the schema's cryptic `const` mismatch. The serializer stamps
`CURRENT_ORM_VERSION` on output. Versioning the project/mapping
formats can follow the same pattern when needed.

### A3. Slim the core barrel export

- [ ] Priority: P3 (recommended)

`core/src/index.ts` has ~81 exports mixing high-level APIs
(ValidationEngine) with internals (NormaParseError, SchemaValidator).
Consider subpath exports (`@barwise/core/validation`,
`@barwise/core/mapping`, ...) so consumers -- and knip -- can see
what is actually public.

### A4. Decouple the LLM SDKs

- [x] Priority: P2 -- resolved via lazy import (spec:
  docs/specs/llm-sdk-decoupling.spec.md)

`@barwise/llm` carries both `@anthropic-ai/sdk` and `openai` as hard
runtime dependencies even though the factory selects one provider at
runtime. Every downstream package (cli, mcp, vscode) inherits both.

Recommendation: lazy `import()` inside each provider implementation,
or optional peer dependencies.

RESOLVED: each provider now `import type`s its SDK and loads it via a
dynamic `import()` on first completion (constructing the client lazily
in a `getClient()` helper), so importing the package or the factory no
longer pulls either SDK into memory until a provider actually runs. The
SDKs stay regular `dependencies` because all packages are private and
unpublished -- peer/optional deps would only shift install, which gives
no realizable benefit here; the runtime saving is what mattered. Moving
to optional peer deps is a clean follow-up if the packages are ever
published.

### A5. Minor architecture items

- [ ] Priority: P3 (recommended)

- `mcp/src/server.ts` hardcodes `SERVER_VERSION = "1.5.0"`. A sync
  test guards it, but reading package.json at build/bundle time
  removes the error class entirely.
- `core/src/model/FactType.ts:67` uses the global
  `crypto.randomUUID()` while `ModelElement.ts` imports from
  `node:crypto`. Works on Node 20+, but should be consistent.
- Consider branded ID types
  (`type ElementId = string & { readonly __brand: unique symbol }`)
  since all cross-references are plain string IDs today.
- The format registry is a package-level singleton; tests must call
  `clearFormats()`. Acceptable, but worth noting if parallel test
  isolation ever becomes an issue.

### A6. Diagram stack: consolidate on the React renderer

- [ ] Priority: P2 (recommended) -- execute the presentation-contract spec first

Decision context (June 2026 triage): the front end is React, not
the legacy SVG-string panel. The webview-vs-local-server question
is open. Inventory of the original implementation in that light:

Keep (load-bearing for any front end):

- `ModelToGraph`, `ElkLayoutEngine`, `DiagramGenerator`, and the
  `PositionedGraph` type. Layout runs host-side in Node regardless
  of front end (browser-side ELK was weighed and rejected in
  `diagram-ui-modernization.spec.md`), and `PositionedGraph` IS the
  presentation contract both front ends consume.
- The `diagram-presentation-contract.spec.md` plan (DiagramSession,
  DiagramPresentation, DiagramIntent). The local-server option
  makes this MORE important, not less: the session is exactly the
  seam a server front end attaches to. Webview vs server becomes a
  choice of thin adapter (postMessage vs HTTP/WebSocket), not an
  architecture fork. Execute this spec before any server work.

Retire (after consolidation):

- `diagram/src/render/SvgRenderer.ts` (619 lines). The repo now has
  two parallel renderers of the same `PositionedGraph`:
  SvgRenderer (static SVG for CLI `diagram`, MCP
  `generate_diagram`, vscode ShowDiagramCommand) and the React
  components (`webview/src/diagram/OrmDiagram.tsx`, 636 lines, the
  interactive editor). The modernization spec called the split
  deliberate, but it is a permanent parity tax: every notation
  change must be implemented twice. End state: one renderer --
  render static SVG headlessly from the same React components via
  `react-dom/server` `renderToStaticMarkup` (they are pure
  `PositionedGraph -> SVG`), and retire SvgRenderer.
- The legacy inline-HTML webview is already gone (Phase 0/1).
- `docs/Barwise.zip` design prototype has served its purpose
  (see C4).

Prerequisites for the consolidation:

- Move the React diagram components out of
  `packages/vscode/webview/` into a package with no VS Code
  coupling (e.g. `packages/diagram-ui`), since cli/mcp cannot
  depend on `barwise-vscode`. This revisits the modernization
  spec's "no new monorepo node" decision, which was made under a
  webview-only assumption; the local-server option also wants the
  React app hosted outside the extension.
- Unify theming: the webview themes via VS Code CSS variables, the
  static export needs concrete colors. There are currently two
  `theme.ts` files (`diagram/src/` and `vscode/webview/src/
  diagram/`) -- collapse to one with a palette parameter.
- Until consolidation: freeze SvgRenderer (no decomposition, no
  new notation features added to only one renderer).

## Testing

### T1. The webview React app has zero tests

- [ ] Priority: P2 (recommended) -- highest-risk untested surface

Ten-plus interactive components (DiagramCanvas, OrmDiagram,
Inspector, ContextBar, CommandPalette, ViewsMenu, TopBar,
BottomStrip, ...) shipped in the diagram modernization with no test
coverage. The webview message protocol
(`vscode/src/diagram/protocol.ts`) is also untested. This is the
highest-risk untested surface in the repo.

Recommendation: component tests (Testing Library) for the
message-protocol handling and state transitions first; rendering
details second.

### T2. Process boundaries are never exercised

- [ ] Priority: P2 (recommended)

- The CLI is tested via an in-process `runCli()` helper
  (`cli/tests/helpers/run.ts`), never by spawning the `barwise`
  binary -- shebang/entry-point regressions would not be caught.
- The MCP server's stdio JSON-RPC transport is untested; tool
  handlers are invoked directly.
- The LSP server providers are tested only with mocked connections.

Recommendation: one small smoke-test suite that spawns each real
binary (CLI, bundled MCP server) and runs a single command closes
all of these cheaply.

### T3. Validate examples/ in CI

- [ ] Priority: P2 (recommended) -- cheap; doubles as the CLI binary smoke test

`barwise/examples/` (auction-project, dbt-import, models,
transcripts) is not validated anywhere, so it will silently rot on
API changes. A CI step running `barwise validate` across the
examples doubles as the CLI binary smoke test from T2.

### T4. Add property-based round-trip tests

- [ ] Priority: P3 (recommended)

The YAML/DDL/NORMA round-trip suites are a real strength. They are
also the ideal seam for `fast-check`: generate random valid models
via the existing ModelBuilder helper and assert
serialize -> deserialize identity. This finds edge cases hand-written
fixtures miss.

### T5. SVG / diagram visual regression

- [ ] Priority: P3 (recommended)

SvgRenderer has structural tests (XML shape, escaping) but nothing
protects layout behavior. Pinned-SVG golden files, or screenshot
diffs for the webview, would catch layout regressions from ELK or
parameter changes.

## CI, Tooling, and Process

### C1. CI gaps

- [x] Priority: P2 -- mostly resolved (June 2026 triage)

- Single Node version (20). engines says `>=20`; add 22 to a matrix.
  RESOLVED: CI now runs a `[20, 22]` Node matrix.
- No `npm audit` (or equivalent) step. RESOLVED: a non-blocking
  `npm audit --audit-level=high` step now reports advisories. It is
  `continue-on-error` because of an existing vulnerability backlog
  (mostly dev deps); tighten to blocking once that is cleared.
- No dependabot/renovate configuration for dependency updates.
  RESOLVED: `.github/dependabot.yml` covers npm (grouped) and the
  GitHub Actions used by the workflows.
- No coverage reporting or artifact upload. STILL OPEN: thresholds now
  gate (Top 5 #3) but coverage reports are not uploaded as artifacts.

The pipeline is otherwise strong -- knip, madge, dprint, publint,
and the MCP bundle all gate merges, which is better than most repos.

### C2. The nested layout (`/barwise/barwise/`) is a recurring tax

- [ ] Priority: P3 (recommended) -- flattening deferred; inner `.github/` removal done in Top 5 #1

It caused the husky workaround
(`"prepare": "cd .. && husky barwise/.husky"`), the
`working-directory: barwise` boilerplate in every workflow step, and
is plausibly how the duplicate `.github/` directory (Top 5 #1)
happened. Flattening is disruptive and may not be worth it; if the
nesting stays, at least remove the inner `.github/` so there is one
source of truth.

### C3. ESLint + oxlint both run in CI

- [ ] Priority: P3 (recommended)

Defensible (oxlint is nearly free), but verify the rule overlap is
not double-reporting. If oxlint never catches anything ESLint does
not, it is a candidate to drop.

### C4. Clean up docs/

- [x] Priority: P2 -- resolved (June 2026 triage)

RESOLVED: removed from the tree (all retrievable from git history); the
`Barwise.zip` reference in `diagram-ui-modernization.spec.md` was updated
to point at history. There were four `MILESTONE3_*.md` files, not three.

- `docs/Barwise.zip` (~2 MB binary)
- `docs/semantic_modeling_guidance.docx`
- `docs/MILESTONE3_*.md` (4 historical files)
- `docs/auction.orm` (~863 KB NORMA artifact, next to the YAML
  version)

Archive or delete. They dilute the genuinely good docs --
ARCHITECTURE.md and the 14 spec files are a real asset, and the
spec-before-development convention is clearly being followed.

### C5. Watch the alpha dependency

- [ ] Priority: P3 (recommended)

`@vscode/chat-extension-utils` in the vscode package is pre-1.0.
Pin it tightly and expect churn.

## What Is Working Well (Keep Doing It)

- One-way dependency graph with a (mostly) pure core.
- Stateless MCP tools and the `boundedTextResult` context-window
  discipline (`mcp/src/helpers/response.ts`).
- Shared ModelBuilder test helper instead of fixture duplication
  across packages.
- Explicit format registration over auto-discovery.
- Spec files preceding implementation (`docs/specs/`).
- Deliberate tolerance of small duplication (CLI `loadModel` vs MCP
  `resolveSource`) rather than a coupling abstraction -- the
  DRY-is-secondary principle applied correctly.

## Verification Notes

- The duplicate-CI finding was verified directly by diffing
  `/.github/workflows/ci.yml` against
  `barwise/.github/workflows/ci.yml`.
- A reviewer-flagged "missing crypto import / compilation error" in
  `FactType.ts` was a false alarm: it uses the Node 20+ global
  `crypto.randomUUID()`. Downgraded to a consistency note (A5).
- No circular dependencies exist among core's internal modules; all
  imports point toward `model`.
