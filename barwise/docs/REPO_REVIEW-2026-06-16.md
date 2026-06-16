# Repository Review -- 2026-06-16

Status: Method-driven assessment (architecture-analysis program, WS3)
Scope: Whole monorepo (10 packages), assessed against the design pillars
via the scenario catalog in `docs/architecture-scenarios.md`, the
reflexion and hotspot data from `npm run arch:triage`, and the now-live
fitness functions.

This is the first review run under the architecture-analysis program
(`docs/specs/architecture-analysis.spec.md`), and the cadence anchor for
future ones (every minor release). Unlike the June 2026 review, which was
a one-off manual reflexion, this one walks a fixed scenario catalog and
separates what the gates now prove from what still needs human judgment.

## Overall verdict

Architectural discipline is holding, and for the first time it is held
_mechanically_. The reflexion is clean -- every package imports only
within the intended one-way graph, and `core/src` is free of I/O, clocks,
randomness, and the LLM SDKs -- and those properties are no longer a
matter of reviewer vigilance: the `depcruise` and `check-core-purity`
gates fail any PR that breaks them. Twenty of the twenty-one scenarios in
the catalog pass; the lone _risk_ is S-ORTH-5 (one concern per module),
which the gates deliberately do not automate and which the god-file
inventory has flagged since June.

The standing concern that motivated this program -- that rapid change was
eroding discipline -- is answered: the two pillars most exposed to drift
(orthogonality, determinism in core) are now non-regressable. What
remains is not drift but known, deferred refactoring debt, and it is now
_safe_ to attempt: the behavioral test net landed since June (property
round-trip in `packages/core/tests/property/`, characterization goldens
in `packages/cli/tests/characterization/`).

## Scenario walk

Each scenario from `docs/architecture-scenarios.md`, with its status and
how it is guarded today. "gated" means a CI fitness function; "tested"
means a suite asserts it; "review" means this assessment is the guard.

| Scenario                                    | Status | Guard today                        |
| ------------------------------------------- | ------ | ---------------------------------- |
| S-ORTH-1 core has no internal deps          | pass   | gated -- depcruise `layer-core`    |
| S-ORTH-2 connectors import only core        | pass   | gated -- depcruise `layer-*`       |
| S-ORTH-3 no connector-to-connector edge     | pass   | gated -- depcruise                 |
| S-ORTH-4 no import cycles                   | pass   | gated -- depcruise `no-circular`   |
| S-ORTH-5 one concern per module             | risk   | review -- 16 files >600 lines (A1) |
| S-COMP-1 formats compose via registry       | pass   | depcruise + review                 |
| S-COMP-2 surfaces delegate, not reimplement | pass   | review -- holds                    |
| S-COMP-3 providers via factory              | pass   | review -- holds                    |
| S-COMP-4 narrow primitives over wide        | pass   | review                             |
| S-DET-1 no I/O in core                      | pass   | gated -- check-core-purity         |
| S-DET-2 no ambient randomness in core       | pass   | gated -- check-core-purity         |
| S-DET-3 no clock/env reads in core          | pass   | gated -- check-core-purity         |
| S-DET-4 repeatable output                   | pass   | tested -- property round-trip (T4) |
| S-DET-5 non-determinism one layer out       | pass   | review                             |
| S-EXPL-1 schemaVersion stamped              | pass   | tested + serializer                |
| S-EXPL-2 unknown versions rejected          | pass   | tested -- schemaVersion suite      |
| S-EXPL-3 cross-domain via context mapping   | pass   | validation suite                   |
| S-EXPL-4 data products declare domains      | pass   | validation suite                   |
| S-EXPL-5 formats register by name           | pass   | review -- connector packages       |
| S-DRY-1 dup removed only w/o coupling       | pass   | review + warn-only jscpd           |
| S-DRY-2 no abstraction that bends an iface  | pass   | review -- import seam tolerated    |

## Findings

### F1. God files -- now safe to refactor (S-ORTH-5)

- [ ] Priority: P2 -- the one open _risk_ in the scenario walk

Sixteen source files exceed 600 lines (`npm run filesize`). Size is a
smell, not a violation, so this is warn-only -- but crossed with change
frequency (the hotspot ranking below), four files concentrate both churn
and size, which is where the next expensive change lands.

| Commits | Lines | File                                              | Disposition                         |
| ------: | ----: | ------------------------------------------------- | ----------------------------------- |
|      23 |   908 | vscode/.../diagram/DiagramPanel.ts                | A1/A6 -- dissolve to DiagramSession |
|      13 |   896 | cli/src/commands/import.ts                        | A1 -- split 3 subcommands           |
|      22 |   318 | core/src/index.ts                                 | A3 -- subpath exports               |
|       6 |  1075 | core/.../validation/rules/populationValidation.ts | A1 -- decompose by rule             |
|       9 |   667 | core/.../serialization/OrmYamlSerializer.ts       | watch                               |
|       9 |   661 | vscode/src/mcp/ToolRegistration.ts                | A1 -- data-driven table             |
|       6 |   617 | llm/src/ExtractionPrompt.ts                       | A1 -- extract rules                 |
|      18 |   147 | diagram/.../layout/ElkLayoutEngine.ts             | DONE -- 1,812 -> 147                |

Recommended order, highest leverage first:

- `DiagramPanel.ts` (top hotspot). Do _not_ refactor in place -- execute
  `diagram-presentation-contract.spec.md`: move the diagram domain logic
  to a unit-testable `DiagramSession` in `@barwise/diagram`, leaving the
  panel a thin VS Code adapter. The coupling table (below) shows
  `DiagramPanel` moving in lockstep with `core/model/DiagramLayout.ts`
  and `diagram/DiagramGenerator.ts`; the session is the seam that absorbs
  that.
- `cli/src/commands/import.ts`. Split the transcript/model/batch
  subcommands into one file each. Self-contained, and the new
  characterization goldens cover its output.
- `core/.../populationValidation.ts` (largest file). Decompose by rule
  family; the property round-trip and the existing validation suite
  guard the behavior.

`ElkLayoutEngine.ts` is the positive control: a former 1,812-line top god
file, now 147 lines after its decomposition spec. The method works; F1 is
the same method applied to the next offenders, each as its own spec.

### F2. Slim the core barrel (S-COMP-1, A3)

- [ ] Priority: P3

`core/src/index.ts` is the #3 hotspot (22 changes) despite being only 318
lines: every new public symbol edits this one file, and the coupling
table shows it dragging `cli export`, `cli import`, and `mcp importModel`
into its change sets. Subpath exports (`@barwise/core/format`,
`@barwise/core/validation`, ...) would let consumers import what they use
and stop the barrel from being a cross-package coupling point. This is
its own spec, not a quick edit.

### F3. Cross-package coupling -- healthy, watch the import seam

- [x] Priority: no action (S-DRY-2 working as intended)

The strongest cross-package coupling is `cli import` with `mcp
importModel` (8 co-changes, degree 0.73), both tracking
`core/format/formats.ts`. This is the deliberate CLI-vs-MCP parallel code
the June review endorsed under DRY-secondary: the two surfaces stay in
step by design, not through a shared coupling. The `jscpd` warn (1.93%
duplication, clones _within_ `DiagramPanel`/`ToolRegistration`, not
across packages) confirms there is no cross-package duplication pulling
toward an abstraction. No action -- this is the pillar applied correctly.

### F4. Carry-forward minors from June 2026

- [ ] C3 -- ESLint + oxlint both run in CI. Still defensible (oxlint is
      near-free); verify the rule overlap is not pure double-reporting.
      P3.
- [ ] C5 -- `@vscode/chat-extension-utils` is still `0.0.0-alpha.5`. Pin
      tightly and expect churn. P3.
- [ ] C2 -- the nested `barwise/barwise/` layout persists. Flattening
      remains disruptive and deferred; the inner `.github/` was already
      removed. P3, likely "won't do".
- [ ] T2 -- the MCP stdio JSON-RPC transport and the LSP providers are
      still tested only in-process / mocked. A spawn-the-server smoke
      test would close it cheaply. P2.

## What changed since June 2026

The June review's top-5 and most architecture items are resolved, and the
testing track advanced:

- Structural pillars are now _gated_, not just documented: `depcruise`
  (direction + cycles, replacing `madge`) and `check-core-purity` (S-DET)
  block merges; `filesize` and `jscpd` warn.
- The connector migration (#2) holds under measurement -- core ships no
  interop format; the dbt importer is gone from `core/src/import/`.
- Determinism is double-guarded: the purity gate plus the new
  property-based round-trip suite (T4).
- Characterization goldens give a behavioral net over CLI output -- the
  prerequisite that makes F1 safe.
- `ElkLayoutEngine` decomposition, schema versioning (A2), LLM SDK
  decoupling (A4), and the diagram renderer consolidation (A6) all
  landed.

## What is working well (keep doing it)

- The one-way graph and pure core, now mechanically enforced.
- Spec-before-code: every change above traces to a spec in `docs/specs/`.
- Deliberate tolerance of the CLI/MCP parallel code over a coupling
  abstraction -- DRY-secondary applied correctly.
- Explicit registration over auto-discovery; the connector convention is
  now documented and gated.

## Next (bd-issue candidates)

1. F1: one spec per god-file refactor, in hotspot order -- `DiagramPanel`
   (via the presentation-contract spec) first.
2. F2: a spec for core subpath exports.
3. T2: an MCP stdio smoke test.

The fitness functions hold the line between releases; this review is the
judgment layer on top, to be refreshed at the next minor release per the
cadence in `CLAUDE.md`.
