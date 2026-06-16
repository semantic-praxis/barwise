# Architecture snapshot -- June 2026

Status: WS2 output of the architecture-analysis program
(`docs/specs/architecture-analysis.spec.md`). Read-only measurement;
input to the WS3 deep assessment and to locking the spec's open
decisions. Generated with `scripts/arch-triage.mjs`.

## Headline

The two structural pillars hold today, mechanically verified. Every
package imports only within its intended set (no dependency-direction
divergence), and `core/src` is free of I/O, clocks, randomness, and the
LLM SDKs. **All six structural fitness-function scenarios pass now**, so
the Phase B gates (WS4 dependency direction, WS5 core purity) can land
**green on the first run** -- no cleanup pass is needed before turning
them on. That removes the last uncertainty behind the open decisions.

The behavioral signal is where the attention should go: change is
concentrated in a handful of large files (the REPO_REVIEW A1 god files),
and a small set of cross-package files change together along the
import/format seam.

## Method and caveats

- Source: `git log --no-merges --numstat` over `barwise/packages`. The
  container clone was shallow (128 commits); it was unshallowed to the
  full 498-commit history first, of which 100 non-merge commits touch
  `packages/`.
- _Hotspots_ rank still-present source files by change frequency times
  current line count. _Coupling_ counts files in different packages that
  changed in the same commit, capped at 25 files per commit so a
  sweeping refactor does not manufacture coupling. Degree is co-changes
  over the less-changed file's frequency.
- Reflexion is a static scan in `arch-triage.mjs`, not dependency-cruiser
  (the gate tool is a WS4 decision). It is intentionally dependency-free.
- This is a point-in-time snapshot. Re-run the script to refresh it.

## Reflexion: the structural pillars (S-ORTH-1..4, S-DET-1..3)

| Scenario                                  | Pillar        | Result today        |
| ----------------------------------------- | ------------- | ------------------- |
| S-ORTH-1 core depends on nothing internal | Orthogonality | pass                |
| S-ORTH-2 connectors depend only on core   | Orthogonality | pass                |
| S-ORTH-3 no connector-to-connector edge   | Orthogonality | pass                |
| S-ORTH-4 no import cycles                 | Orthogonality | pass (gated, madge) |
| S-DET-1 no I/O in core                    | Determinism   | pass                |
| S-DET-2 no ambient randomness in core     | Determinism   | pass                |
| S-DET-3 no clock/env reads in core        | Determinism   | pass                |

The core-purity result confirms the REPO_REVIEW #2 connector migration
held: the dbt importer is gone from `core/src/import/` (it now lives in
`@barwise/dbt`), and no `node:fs`, `process.env`, `new Date()`,
`Math.random`, or global `crypto.*` remains in core. The gates would
lock this in against regression rather than fix anything.

## Hotspots (change frequency x current size)

| Rank | Commits | Lines | Score | File                                               |
| ---: | ------: | ----: | ----: | -------------------------------------------------- |
|    1 |      23 |   908 | 20884 | vscode/src/diagram/DiagramPanel.ts                 |
|    2 |      13 |   896 | 11648 | cli/src/commands/import.ts                         |
|    3 |      22 |   318 |  6996 | core/src/index.ts                                  |
|    4 |       6 |  1075 |  6450 | core/src/validation/rules/populationValidation.ts  |
|    5 |       9 |   667 |  6003 | core/src/serialization/OrmYamlSerializer.ts        |
|    6 |       9 |   661 |  5949 | vscode/src/mcp/ToolRegistration.ts                 |
|    7 |      13 |   314 |  4082 | vscode/src/client/extension.ts                     |
|    8 |       6 |   617 |  3702 | llm/src/ExtractionPrompt.ts                        |
|    9 |       5 |   575 |  2875 | core/src/counterexample/CounterexampleGenerator.ts |
|   10 |       5 |   546 |  2730 | core/src/model/OrmModel.ts                         |
|   11 |      18 |   147 |  2646 | diagram/src/layout/ElkLayoutEngine.ts              |
|   12 |       3 |   769 |  2307 | core/src/verbalization/ConstraintVerbalizer.ts     |

Reading:

- **`DiagramPanel.ts` is the clear top hotspot** (23 changes, 908
  lines). This is precisely the file REPO_REVIEW A1/A6 says _not_ to
  refactor in place but to dissolve via the diagram-presentation-contract
  spec (move domain logic to a `DiagramSession` in `@barwise/diagram`).
  The history confirms the priority: it is where the next expensive
  change lands.
- **`cli/src/commands/import.ts`** (13 changes, 896 lines) is the
  second hotspot and an A1 target (three subcommands in one file). High
  churn _and_ high size is the combination worth splitting first.
- **`core/src/index.ts`** ranks third on 22 changes despite being only
  318 lines: the barrel is a churn magnet, exactly the cost A3
  (subpath exports) predicts. Every new public symbol edits this one
  file, and the coupling table below shows it dragging CLI and MCP along.
- **`ElkLayoutEngine.ts` has fallen to 147 lines** (was 1,812 at the
  REPO_REVIEW; 18 historical changes). The diagram-layout-decomposition
  spec worked: a former top god file is no longer one. This is the
  positive control -- the program's method already produced a measurable
  win here.

## Cross-package temporal coupling (orthogonality smell)

Files in different packages that change together. These do not violate
the dependency graph (the reflexion above is clean); they show where two
packages move in lockstep, which is where a future coupling violation
would first appear.

| Co | Degree | A                               | B                                  |
| -: | -----: | ------------------------------- | ---------------------------------- |
|  8 |   0.73 | cli/src/commands/import.ts      | mcp/src/tools/importModel.ts       |
|  6 |   0.55 | core/src/index.ts               | mcp/src/tools/importModel.ts       |
|  5 |   0.63 | cli/src/commands/export.ts      | core/src/index.ts                  |
|  5 |   0.63 | cli/src/commands/import.ts      | core/src/format/formats.ts         |
|  5 |   0.63 | core/src/format/formats.ts      | mcp/src/tools/importModel.ts       |
|  5 |   0.56 | diagram/src/DiagramGenerator.ts | vscode/src/diagram/DiagramPanel.ts |
|  3 |   1.00 | core/src/model/DiagramLayout.ts | vscode/src/diagram/DiagramPanel.ts |
|  3 |   0.75 | mcp/src/server.ts               | vscode/src/chat/chatPrompts.ts     |

Reading:

- **The import seam dominates.** `cli import` and `mcp importModel`
  change together most (co=8, degree 0.73), and both track
  `core/format/formats.ts`. This is the deliberate CLI-vs-MCP parallel
  code the REPO_REVIEW endorsed under DRY-secondary (S-DRY-2): the two
  surfaces stay in step by design, not through a shared coupling. The
  coupling is the _cost_ of that decision, made visible -- worth
  watching, not yet worth an abstraction that would couple the surfaces.
- **The barrel couples core to its consumers.** `core/index.ts` appears
  in three pairs (with `mcp importModel`, `cli export`). Subpath exports
  (A3) would let CLI and MCP import from `@barwise/core/format` etc. and
  stop dragging the whole barrel into their change sets.
- **`DiagramLayout.ts` (core) moves in lockstep with the vscode diagram
  surface** (degree 1.00 with `DiagramPanel.ts`). The presentation-
  contract refactor (A6) is the structural fix: a `DiagramSession` seam
  in `@barwise/diagram` would absorb these co-changes instead of routing
  every layout-model change through the vscode panel.
- Pairs referencing now-absent files (e.g. `core/src/import/
  DbtImportFormat.ts`, seen in raw output) are _historical_ -- they
  reflect the pre-connector layout before the #2 migration and are
  excluded above.

## What this settles for the open decisions

- **Conformance tool / timing (WS4, WS5).** Because the reflexion is
  already clean, the dependency-direction and core-purity gates can be
  added as _gating_ from the start rather than report-only-then-flip;
  there is nothing to burn down first. This strengthens the case for
  adopting dependency-cruiser now (it expresses all six passing
  scenarios plus the cycle check in one config) and retiring `madge`.
- **File-size budget (WS6).** The hotspot ranking, not a blanket size
  gate, is the right instrument: the four files worth acting on
  (`DiagramPanel`, `cli import`, the barrel, `populationValidation`) are
  already known A1/A3 findings with their own specs. Recommend keeping
  the budget warn-only or omitting it, and driving god-file work from
  this ranking instead.
- **DRY tooling.** The import-seam coupling is the worked example for
  S-DRY-2: a duplication detector would flag `cli import` vs
  `mcp importModel` and push toward exactly the surface-coupling the
  pillar forbids. Confirms the no-duplication-tool decision.

## Next

WS3 turns this snapshot, plus a walk of all 21 scenarios in
`docs/architecture-scenarios.md`, into the refreshed `REPO_REVIEW`. The
hotspot and coupling tables above are its prioritization input.
