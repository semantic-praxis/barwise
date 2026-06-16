# Decompose the population validation rules by constraint family

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-16
Last-updated: 2026-06-16
Tracking: REPO_REVIEW-2026-06-16.md finding A1 (god files;
populationValidation.ts -- the largest source file)

## Principle

`validation/rules/populationValidation.ts` is 1,074 lines holding
sixteen unrelated population checks -- mandatory, disjunctive mandatory,
dangling references, internal and external uniqueness, value, frequency,
the four set-comparison rules, their four cross-fact-type spanning
variants, and ring (with its acyclic sub-check) -- plus five shared
population helpers, in one module. This is an orthogonality gap: a change
to the ring traversal sits in the same file as external-uniqueness tuple
math, so the two cannot move or be reasoned about independently, and it
is the single file most likely to collide across unrelated rule edits. It
is the largest file in the repository and the lead instance of finding
A1.

Unlike the `ElkLayoutEngine` decomposition, this one does not unlock
hidden behavior: every check is already reachable through
`populationValidationRules` with plain models, and the counterexample
round-trip property exercises each rule across a hundred generated models.
So this split serves orthogonality (one constraint family per module) and
the file-size budget; it is not a testability fix, and the coverage
floors are unaffected.

## Should we keep `populationValidationRules`'s surface? (resolved: yes)

The public API does not move. `populationValidationRules` is the only
export of this file; `core/src/index.ts` re-exports it and
`ValidationEngine.ts` imports it from
`./rules/populationValidation.js`. Both stay byte-identical. The
decomposition is entirely internal to `validation/rules/`:
`populationValidation.ts` keeps `populationValidationRules` as a thin
orchestrator that calls the extracted family functions in the same
sequence, so the diagnostic order -- and thus every test and golden --
is preserved. The sixteen `check*` functions and five helpers are all
module-private today, so moving them breaks no importer; the family
modules export them only for the orchestrator (and each other) to call.

## Scope

In scope: split `validation/rules/populationValidation.ts` into one
module per constraint family under `validation/rules/population/`,
keeping `populationValidationRules` as the orchestrator; move the shared
population helpers into `population/shared.ts`; update the `CLAUDE.md`
and `ARCHITECTURE.md` layout listings.

Out of scope: any change to validation _behavior_ (diagnostics, rule
ids, messages, and order are identical), to the rule logic, or to the
public API. New per-module unit tests are deferred (the rules are
already covered through `populationValidationRules`; see Open
decisions). The other A1 god files (`DiagramPanel`, `import.ts`,
`ToolRegistration`, `ExtractionPrompt`) are separate findings, taken in
hotspot order by their own specs.

## Inventory

| Symbol (current `populationValidation.ts`)                               | Concern                            | Verdict                                |
| ------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------- |
| `populationValidationRules`                                              | orchestration + only public export | stays (thin orchestrator)              |
| `buildObjectUniverse`, `valuesPlayedInRole`                              | object/role population helpers     | move -> `population/shared.ts`         |
| `rolePlayerMap`, `tuplesForRoleSeq`, `makeCompositeKey`                  | role-player + tuple-key helpers    | move -> `population/shared.ts`         |
| `checkDanglingPopulationFactType`                                        | structural: population integrity   | move -> `population/structural.ts`     |
| `checkMandatoryViolations`, `checkDisjunctiveMandatoryViolations`        | mandatory participation            | move -> `population/mandatory.ts`      |
| `checkUniquenessViolations`, `checkExternalUniquenessViolations`         | internal + external uniqueness     | move -> `population/uniqueness.ts`     |
| `checkValueConstraintViolations`, `checkFrequencyViolations`             | single-role value domain + count   | move -> `population/valueFrequency.ts` |
| `checkExclusionViolations`, `checkExclusiveOrViolations`                 | set comparison (single fact type)  | move -> `population/setComparison.ts`  |
| `checkSubsetViolations`, `checkEqualityViolations`                       | set comparison (single fact type)  | move -> `population/setComparison.ts`  |
| `checkSpanningExclusionViolations`, `checkSpanningExclusiveOrViolations` | set comparison (cross fact type)   | move -> `population/spanning.ts`       |
| `checkSpanningSubsetViolations`, `checkSpanningEqualityViolations`       | set comparison (cross fact type)   | move -> `population/spanning.ts`       |
| `checkRingViolations`, `checkAcyclic`                                    | ring constraints + acyclicity      | move -> `population/ring.ts`           |

The `Diagnostic` and model types are imported unchanged; each family
module imports the same types it imports today. No shared private
interface spans families: `shared.ts` owns the five helpers, and every
family module depends only on `shared.ts` and the model/diagnostic
types.

## Target architecture

```
validation/rules/
  populationValidation.ts   orchestrator: populationValidationRules --
                            the only file ValidationEngine + index import
  population/
    shared.ts               object/role universe, tuple-key helpers (pure)
    structural.ts           dangling population -> fact-type integrity
    mandatory.ts            mandatory + disjunctive mandatory
    uniqueness.ts           internal + external uniqueness
    valueFrequency.ts       value-constraint + frequency (single role)
    setComparison.ts        exclusion, exclusive-or, subset, equality
    spanning.ts             the four cross-fact-type spanning variants
    ring.ts                 ring + acyclic traversal

import direction (acyclic):
  populationValidation -> { structural, mandatory, uniqueness,
                            valueFrequency, setComparison, spanning, ring }
  each family module    -> { shared, model types, Diagnostic } only
  shared                -> { model types } only
```

## Workstreams (each independently shippable)

Ordered most-isolated first. Each is a single PR that keeps the full
monorepo suite green and changes nothing downstream. The decomposition
is a pure code move guarded by the existing population suite, so the
extraction lands as one reviewable diff rather than per-family
micro-PRs.

### 1. Extract the families and slim the orchestrator

Create `population/shared.ts` and the seven family modules, move each
function with its doc comment, and reduce `populationValidation.ts` to
`populationValidationRules` plus its imports -- calling the families in
the current order so diagnostics are emitted identically. The family
functions and helpers become named exports consumed by the orchestrator
(and `shared` by the families), so `knip` sees a consumer for each. No
test changes: every test imports `populationValidationRules` from the
unchanged path.

### 2. Refresh the layout docs

Update the `core/CLAUDE.md` package-layout note and the
`ARCHITECTURE.md` validation listing to show `rules/population/`, and
tick the populationValidation item under A1 in
`REPO_REVIEW-2026-06-16.md`. Mechanical and docs-only; separated so the
code move reviews on its own.

## API and migration impact

- No public export changes. `core/src/index.ts` and `ValidationEngine.ts`
  import `populationValidationRules` from the same path, unchanged.
- Blast radius is internal to `core/src/validation/rules/`. The one-way
  dependency graph means diagram, llm, cli, mcp, and vscode rebuild
  against an unchanged surface. Run the full monorepo build + test after
  WS1 to confirm.
- No test imports change: `CounterexampleGenerator.test.ts` and
  `crossFactTypeSpanning.test.ts` import `populationValidationRules` from
  the orchestrator path, which is stable.

## Open decisions (for review)

- **`structural.ts` for the single dangling check.** The
  dangling-population check is one short function and a distinct concern
  (a population referencing a missing fact type), not a constraint rule.
  Options: its own `structural.ts` (recommended -- keeps the families
  pure constraint checks) or fold it into the orchestrator. Recommend the
  small dedicated module over mixing concerns.
- **Group value with frequency.** `valueFrequency.ts` holds two distinct
  single-role checks. Options: one module (recommended -- both are small,
  single-role population checks) or split into `valueConstraint.ts` and
  `frequency.ts`. Recommend grouping to avoid two near-trivial modules;
  splitting later is cheap if either grows.
- **Per-module unit tests.** The rules are already covered through
  `populationValidationRules`, so direct per-family tests are additive,
  not required. Recommend deferring them to a follow-up rather than
  bundling new tests into a pure-move PR.

## Risks and testing

- Behavior must not change: identical diagnostics, rule ids, messages,
  and order. The guard is the population suite already in place --
  `populationIntegration`, `crossFactTypeSpanning`,
  `externalUniquenessPopulation`, `Population` and `ValidationEngine`
  tests, the counterexample round-trip property over a hundred seeds, and
  the CLI validate characterization goldens. All stay green at every
  step; none are modified.
- One PR per workstream, run through build, test, lint, knip, the
  dependency-direction and core-purity gates, and `dprint check`. The
  acyclic import direction above keeps the depcruise `no-circular` rule
  green.
- End-to-end: `validate:examples` runs the built CLI's validate path over
  the example corpus in CI, exercising the real rule set after the move.

## Non-goals

- No new or changed validation rule, diagnostic, or message.
- No change to the public API, `ValidationEngine`, or the counterexample
  generator.
- No coverage-floor change: the rules were already reachable and tested,
  so measured coverage is unaffected.
