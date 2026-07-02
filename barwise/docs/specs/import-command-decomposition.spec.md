# Decompose the import command into per-subcommand modules

Status: Implemented -- import.ts split into per-subcommand files (896 -> 43).
Created: 2026-06-16
Last-updated: 2026-06-24
Tracking: REPO_REVIEW-2026-06-16.md finding A1 (god files;
cli/src/commands/import.ts)

## Principle

`commands/import.ts` is 895 lines: a single `registerImportCommand`
registers seven subcommands -- `model`, `norma`, `dbt`, `sql`, the
`typescript`/`java`/`kotlin` code trio, `transcript`, and `batch` -- each
a self-contained ~75-200 line action closure, alongside the
slug/alternatives/diff helpers and the format-registration side effects.
This is an orthogonality gap: the LLM `transcript` extraction sits in the
same file as the NORMA XML reader and the batch summary-table renderer,
so the subcommands cannot move or be reasoned about independently, and
the file is second only to `DiagramPanel` on the A1 hotspot list.

Splitting it serves orthogonality (one subcommand per module), matching
the package's own stated convention that "each command is a separate
module that registers itself on a Commander program". The top-level
commands follow it; the import subcommands do not.

## Should we keep `registerImportCommand`'s surface? (resolved: yes)

The public surface does not move. `cli.ts` imports
`registerImportCommand`; two tests import `slugifyModel` and
`formatAlternativeFramings` from `commands/import.js`. All three stay
exported from that path: `registerImportCommand` remains the orchestrator,
and the two helpers are re-exported from their new `import/shared.js`
home, so no test import changes. The format-registration calls
(`registerStandardFormats`, `registerCodeFormats`, `registerDbtFormats`)
stay as load-time side effects in the orchestrator, preserving their
timing -- they run when `cli.ts` loads the module, before any subcommand
action fires.

## Scope

In scope: split `commands/import.ts` into one module per subcommand under
`commands/import/`, each exposing an `add<Name>Subcommand(importCmd)`
registrar; move the shared serializer and the slug/alternatives/diff
helpers into `import/shared.ts`; keep `registerImportCommand` as the
orchestrator that creates the `import` parent command and wires the
registrars in order; update the `CLAUDE.md` layout listing.

Out of scope: any change to command _behavior_ (flags, output, exit
codes, and stderr summaries are identical). The near-identical
serialize-then-summarize tail shared by the five format-based subcommands
is _not_ deduplicated here -- that is a DRY-secondary cleanup, and a pure
move keeps the decomposition behavior-preserving; a follow-up can extract
it. The other A1 god files are separate findings.

## Inventory

| Symbol (current `import.ts`)                | Concern                          | Verdict                             |
| ------------------------------------------- | -------------------------------- | ----------------------------------- |
| `registerImportCommand`                     | parent command + wiring          | stays (thin orchestrator)           |
| format registration calls (3)               | load-time format side effects    | stays (orchestrator)                |
| `model` subcommand                          | text-format import (DDL/OpenAPI) | move -> `import/model.ts`           |
| `norma` subcommand                          | NORMA XML import                 | move -> `import/norma.ts`           |
| `dbt` subcommand                            | dbt project import               | move -> `import/dbt.ts`             |
| `sql` subcommand                            | SQL file/dir import              | move -> `import/sql.ts`             |
| `typescript`/`java`/`kotlin` loop           | code project import              | move -> `import/code.ts`            |
| `transcript` subcommand                     | LLM extraction + merge           | move -> `import/transcript.ts`      |
| `batch` subcommand                          | multi-model batch run            | move -> `import/batch.ts`           |
| `serializer` const                          | shared serializer instance       | move -> `import/shared.ts`          |
| `slugifyModel`, `formatAlternativeFramings` | exported helpers                 | move -> `import/shared.ts` (re-exp) |
| `summarizeDiff`                             | private diff summary             | move -> `import/shared.ts`          |

The `io.js` helper import (`readFile`, `writeOutput`) moves with each
subcommand, its relative path deepening by one segment; the package
imports (`@barwise/core`, `@barwise/llm`, etc.) are unchanged.

## Target architecture

```
commands/
  import.ts             orchestrator: registerImportCommand + format
                        registration; re-exports the two public helpers
  import/
    shared.ts           serializer, slugifyModel, formatAlternativeFramings,
                        summarizeDiff (private)
    model.ts            addModelSubcommand
    norma.ts            addNormaSubcommand
    dbt.ts              addDbtSubcommand
    sql.ts              addSqlSubcommand
    code.ts             addCodeSubcommands (typescript/java/kotlin)
    transcript.ts       addTranscriptSubcommand
    batch.ts            addBatchSubcommand

import direction (acyclic):
  import.ts        -> { all subcommand modules, shared (re-export) }
  transcript, batch -> shared (serializer + helpers)
  model/norma/dbt/sql/code -> own local serializer; no shared dependency
```

## Workstreams (each independently shippable)

Ordered most-isolated first. Each is a single PR that keeps the full
suite green. The split is a pure code move guarded by the import tests
and the type-checker, so the extraction lands as one reviewable diff.

### 1. Extract the subcommands and slim the orchestrator

Create `import/shared.ts` and the seven subcommand modules, moving each
action closure verbatim into its registrar, and reduce `import.ts` to the
format registration, the re-export, and `registerImportCommand` calling
the registrars in the current order. No test changes: `slugifyModel` and
`formatAlternativeFramings` re-export from the unchanged path.

### 2. Refresh the layout docs

Update the `cli/CLAUDE.md` package-layout note to show `import/`, and
tick the import item under A1 in `REPO_REVIEW-2026-06-16.md`. Docs-only.

## API and migration impact

- No public export changes. `cli.ts` imports `registerImportCommand`
  unchanged; the two test-facing helpers re-export from the same path.
- Blast radius is internal to `@barwise/cli/src/commands/`. No other
  package sees a change.
- Format-registration timing is preserved: the calls stay in the
  orchestrator, which is the module `cli.ts` loads.

## Open decisions (for review)

- **Deduplicate the serialize/summary tail.** Five format-based
  subcommands repeat the same serialize-to-YAML, `writeOutput`, and
  stderr-summary block. Options: leave it (recommended -- pure move now,
  DRY is secondary, and a shared helper is a separate reviewable change)
  or extract a `writeImportedModel` helper into `shared.ts` in the same
  PR. Recommend deferring to keep this a behavior-preserving move.
- **Code trio as one module or three.** The `typescript`/`java`/`kotlin`
  subcommands share one registration loop. Options: one `code.ts`
  (recommended -- they are one loop over a language list) or a module
  each. Recommend keeping the single loop intact.

## Risks and testing

- Behavior must not change: identical flags, stderr summaries, output,
  and exit codes. The guard is `import.test.ts` (`slugifyModel`, and the
  `batch`/`transcript` error paths via `runCli`), `importAlternatives.ts`
  (`formatAlternativeFramings`), the type-checker (which catches any
  broken move), and the full `@barwise/cli` suite. Note: the
  characterization goldens cover validate/verbalize/export, not import,
  so the import tests plus `tsc` are the guard here.
- One PR per workstream, run through build, test, lint, knip, and
  `dprint check`. The acyclic import direction above keeps the cycle
  check green.

## Non-goals

- No new or changed subcommand, flag, output, or exit code.
- No deduplication of the shared import tail (separate DRY follow-up).
- No change to the importers themselves (they live in the connector
  packages); this only reorganizes the CLI wiring.
