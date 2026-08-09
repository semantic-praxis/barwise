# Model lint: make the deterministic quality tier catch what the evals caught

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-08-09
Last-updated: 2026-08-09
Tracking: follow-up to `docs/agent-eval-2026-08-09.md` and
`docs/prompt-eval-sonnet5-2026-08-08.md`; no bd issue yet (bd
unavailable in this session -- file one before the first
implementation PR).

## Principle

Determinism in the core. Barwise already has a deterministic model
linter -- `ValidationEngine`'s warning/info tiers (the
`completeness/*` family and friends) -- sitting alongside the
LLM-backed `review_model`. The prompt-eval work exposed two problems
with it. First, every quality loop discards the tier: the promptlab
scorer counts only error-severity diagnostics, and the extractor
subagent is instructed to note errors. Second, the tier is thin and
partly wrong: run at full severity over the four worst-scoring
baseline extractions, it produced one debatable warning and two false
positives, and zero diagnostics for the misses the rubrics caught.
The rubric machinery only works where a reference model exists (the
eval suite); on novel models the lint tier is the only deterministic
quality signal, so it should carry the checks that are codifiable
without intent.

The boundary matters: mandatory-ness ("every appointment has a
status") is intent, not structure -- no linter can infer it, which is
exactly why promptlab's reference-based rubrics and the LLM review
surface exist. This spec grows the lint tier only where the eval
evidence shows a deterministic check was possible.

## Evidence (from the 2026-08-08/09 eval runs)

- `completeness/missing-preferred-identifier` fired on Employee and
  Manager in both models' employee-hierarchy extractions -- false
  positives: both are subtypes inheriting identification through
  `provides_identification`, which the rule does not consult
  (`completenessWarnings.ts` checks each entity in isolation).
- Partial population instances (a "Department has DepartmentName"
  population whose instances carry only the DepartmentName value)
  produced a _misleading_ error -- a uniqueness violation between two
  instances whose constrained role values are both absent -- and
  several population checks silently skip incomplete instances
  entirely (`population/shared.ts:69`, `valueFrequency.ts:95` guard
  on every role value being present). The real defect, "instance
  missing a value for role X", is never named.
- Missing uniqueness constraints (the fan-out misses the
  `forbids_population` checks caught) are invisible unless the fact
  type has no constraints at all
  (`completeness/fact-type-without-constraints`); a fact type with a
  mandatory but no uniqueness sails through.

## Scope

In scope (all in `@barwise/core`'s validation rules, plus consumer
wiring):

- When an entity type reaches a preferred identifier through its
  subtype chain (a `provides_identification` path to an identified
  supertype), `missing-preferred-identifier` shall not fire on it.
- When a population instance lacks a value for one or more roles of
  its fact type, validation shall emit a diagnostic naming the
  instance and the unfilled role(s) (`population/incomplete-instance`).
- When a fact type carries at least one constraint but no internal
  uniqueness constraint, validation shall emit a warning
  (`completeness/fact-type-without-uniqueness`), reusing the
  elementarity rationale of `constraint/spanning-all-roles`.
- When a promptlab suite manifest declares a `validationWarning`
  weight, `scoreExtraction` shall subtract it per warning-severity
  diagnostic (default 0 -- absent from the manifest means today's
  behavior, so history rows stay comparable).

Out of scope, deferred and named:

- Intent-dependent checks (mandatory-ness, value-constraint
  completeness): they stay with the rubric and review surfaces.
- Any change to `review_model` or the LLM review prompt (harness
  workstream 5 owns that).
- The extractor agent's handling of warnings: covered by the audit's
  F2/F3 proposed diffs, adopted separately.
- A standalone `barwise lint` command: `validate` already prints all
  severities; presentation changes are not needed for the loops.

## Inventory

| Area                                                                  | Change                                                                     | Verdict   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| `core/src/validation/rules/completenessWarnings.ts`                   | Subtype-aware preferred-identifier check; new no-uniqueness rule           | modify    |
| `core/src/validation/rules/populationValidation.ts` (+ `population/`) | New incomplete-instance rule; existing skip-guards keep their semantics    | additive  |
| `promptlab/src/score/scoreExtraction.ts` + `evalcase` types/loader    | Optional `validationWarning` weight                                        | additive  |
| `promptlab/evals/suite.yaml`                                          | Unchanged in this spec (weight stays undeclared until a gated re-baseline) | untouched |
| `learn`, `llm`, `cli`, `mcp`                                          | No changes; they surface diagnostics as-is                                 | untouched |

## Workstreams (each independently shippable)

### 1. Fix the subtype false positive

Walk the subtype graph (via `provides_identification` links) before
flagging; add employee-hierarchy-shaped fixtures to the core tests.
Smallest blast radius, and it makes the info tier trustworthy enough
to surface anywhere.

### 2. `population/incomplete-instance`

Emit per-instance diagnostics for unfilled roles. Open decision on
severity below. The silent skip-guards in set-comparison and
frequency checks stay (they are correct once the incompleteness is
independently named).

### 3. `completeness/fact-type-without-uniqueness` (provisional: not yet grounded)

Warning-severity. Ground before building: check the seed references
and `docs/auction.orm.yaml` for legitimate uniqueness-free fact types
(unaries, objectified fact types) and carve those out rather than
special-casing after the fact.

### 4. Promptlab warning weight (provisional: not yet grounded)

Type, loader, scorer, and a pinned-score test with a suite that
declares the weight. Adopting a nonzero weight in the seed suite is a
separate, gated data change -- it re-baselines every score.

## Risks and testing

- **Risk: new warnings churn the checked-in score history.** Guard:
  the weight defaults to 0 and the seed suite does not declare it in
  this spec; adopting it is an explicit later commit.
- **Risk: workstream 3 false-positives on legitimate shapes.** Guard:
  the grounding pass over existing references; the rule ships only if
  the seed suite's answer keys stay warning-free.
- **Testing:** core rule tests with fixtures cut from the actual
  failing eval extractions (they are real, minimal reproductions);
  promptlab pinned-score tests extended for the weight.

## Open decisions (for review)

- **Severity of `population/incomplete-instance`.** Error makes the
  scorer punish it (0.10 each) and matches "an incomplete instance
  makes the model invalid"; warning keeps today's scores stable until
  the warning weight lands. Recommend: warning now, revisit with
  workstream 4.
- **Does a subtype-inherited identifier also satisfy
  `provides_identification: false` chains?** Recommend no -- an
  independent-identification subtype without its own identifier
  should still flag.
