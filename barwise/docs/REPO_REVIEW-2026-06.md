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

- [ ] Priority: ___

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

- [ ] Priority: ___

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

- [ ] Priority: ___

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

- [ ] Priority: ___

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

- [ ] Priority: ___

Worst offenders, in order:

- `diagram/src/layout/ElkLayoutEngine.ts` (1,812 lines) -- ELK
  interop, two-pass layout, collision resolution, subtype radial
  placement, and edge routing in one file. Suggested split:
  ElkInterop, EntityPlacementPass, FactTypePlacementPass,
  PostAdjustments, EdgeRouter, CollisionResolver.
- `llm/src/DraftModelParser.ts` (953) -- four-pass algorithm;
  decomposes naturally into one file per pass plus a provenance
  helper.
- `vscode/src/diagram/DiagramPanel.ts` (898) -- extract the
  position/orientation override logic into its own module.
- `cli/src/commands/import.ts` (808) -- three subcommands
  (transcript, model, batch) in one file.
- `vscode/src/mcp/ToolRegistration.ts` (671) -- 14 near-identical
  tool wrappers; could be data-driven from a metadata table.
- `diagram/src/SvgRenderer.ts` (619) -- large but coherent; lowest
  priority of this list.
- `llm/src/ExtractionPrompt.ts` (561) -- consider extracting the
  constraint-inference rules.
- `vscode/src/commands/ImportTranscriptCommand.ts` (538) --
  orchestration + UI + merge logic; extract the merge logic.

None are urgent, but ElkLayoutEngine is where the next layout bug
will be expensive to fix.

### A2. No schema versioning / migration strategy

- [ ] Priority: ___

Every `.orm.yaml` carries a `schemaVersion`, but the serializer
hardcodes `orm_version: "1.0"` and nothing checks or migrates
versions on read. Retrofitting migration after incompatible files
exist in the wild is much harder than adding a version check now.

Recommendation: at minimum, reject unknown versions with a clear
message; design the migration hook before the format needs to
change.

### A3. Slim the core barrel export

- [ ] Priority: ___

`core/src/index.ts` has ~81 exports mixing high-level APIs
(ValidationEngine) with internals (NormaParseError, SchemaValidator).
Consider subpath exports (`@barwise/core/validation`,
`@barwise/core/mapping`, ...) so consumers -- and knip -- can see
what is actually public.

### A4. Decouple the LLM SDKs

- [ ] Priority: ___

`@barwise/llm` carries both `@anthropic-ai/sdk` and `openai` as hard
runtime dependencies even though the factory selects one provider at
runtime. Every downstream package (cli, mcp, vscode) inherits both.

Recommendation: lazy `import()` inside each provider implementation,
or optional peer dependencies.

### A5. Minor architecture items

- [ ] Priority: ___

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

## Testing

### T1. The webview React app has zero tests

- [ ] Priority: ___

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

- [ ] Priority: ___

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

- [ ] Priority: ___

`barwise/examples/` (auction-project, dbt-import, models,
transcripts) is not validated anywhere, so it will silently rot on
API changes. A CI step running `barwise validate` across the
examples doubles as the CLI binary smoke test from T2.

### T4. Add property-based round-trip tests

- [ ] Priority: ___

The YAML/DDL/NORMA round-trip suites are a real strength. They are
also the ideal seam for `fast-check`: generate random valid models
via the existing ModelBuilder helper and assert
serialize -> deserialize identity. This finds edge cases hand-written
fixtures miss.

### T5. SVG / diagram visual regression

- [ ] Priority: ___

SvgRenderer has structural tests (XML shape, escaping) but nothing
protects layout behavior. Pinned-SVG golden files, or screenshot
diffs for the webview, would catch layout regressions from ELK or
parameter changes.

## CI, Tooling, and Process

### C1. CI gaps

- [ ] Priority: ___

- Single Node version (20). engines says `>=20`; add 22 to a matrix.
- No `npm audit` (or equivalent) step.
- No dependabot/renovate configuration for dependency updates.
- No coverage reporting or artifact upload.

The pipeline is otherwise strong -- knip, madge, dprint, publint,
and the MCP bundle all gate merges, which is better than most repos.

### C2. The nested layout (`/barwise/barwise/`) is a recurring tax

- [ ] Priority: ___

It caused the husky workaround
(`"prepare": "cd .. && husky barwise/.husky"`), the
`working-directory: barwise` boilerplate in every workflow step, and
is plausibly how the duplicate `.github/` directory (Top 5 #1)
happened. Flattening is disruptive and may not be worth it; if the
nesting stays, at least remove the inner `.github/` so there is one
source of truth.

### C3. ESLint + oxlint both run in CI

- [ ] Priority: ___

Defensible (oxlint is nearly free), but verify the rule overlap is
not double-reporting. If oxlint never catches anything ESLint does
not, it is a candidate to drop.

### C4. Clean up docs/

- [ ] Priority: ___

Committed alongside current docs:

- `docs/Barwise.zip` (~2 MB binary)
- `docs/semantic_modeling_guidance.docx`
- `docs/MILESTONE3_*.md` (3 historical files)
- `docs/auction.orm` (~863 KB NORMA artifact, next to the YAML
  version)

Archive or delete. They dilute the genuinely good docs --
ARCHITECTURE.md and the 14 spec files are a real asset, and the
spec-before-development convention is clearly being followed.

### C5. Watch the alpha dependency

- [ ] Priority: ___

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
