# must_validate stops banking a guaranteed point

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-08-29
Last-updated: 2026-08-29
Tracking: barwise-902

## Principle

**Explicit over implicit**, applied to what a score is made of. The
rubric fraction is the honest half of `scoreExtraction` -- a count of
authored checks that passed over checks that were asked. A check that
cannot fail on the pipeline's own output is not a measurement in that
count; it is a constant, and folding a constant into a fraction that
readers treat as "how much of the rubric did this candidate satisfy"
misreports every case that declares it.

The check itself is sound. What is wrong is its position: it is priced
as evidence when it is a guard.

## Should the validity check keep contributing to the rubric fraction? (resolved: no)

No, and the resolving observation is that an empty extraction scores
0.125. Feed `{}` to a case with eight checks and seven fail; the one
that passes is `must_validate`, because a model with nothing in it has
nothing to violate. The suite's clearest possible failure banks 12.5
points on the strength of a check asserting soundness.

That is not a quirk of the empty case. `must_validate` has never failed
on any real output: all 192 committed payloads from the two recorded
rounds re-score with zero post-correction validation errors, and eight
deliberate mutations of answer keys (every object type deleted, every
fact type deleted, both, a zero-role fact type, a duplicated object
type, every role player rewritten to a nonexistent type, a payload of
`{"object_types": "not an array"}`, and `{}`) all pass it.

The mechanism is `enforceConformance`, which runs ahead of validation in
both `scoreExtraction` and production's `TranscriptProcessor`. It repairs
or discards what would otherwise be an error, so the validator is handed
a model with nothing left to report. The complement is the proof the
pipeline is alive rather than inert: on the 115 payloads of the 1647
round, corrections fire on 61 and validation _warnings_ on 78. Only
errors are absent, because errors are what the corrector eliminates.

### Why not validate the pre-correction model instead

Because it charges the same defect twice, and this is measured rather
than argued. Re-scoring all 192 payloads with validation moved ahead of
`enforceConformance` yields 44 errors across 38 payloads -- and **all 38
of those payloads also produced conformance corrections, with no
exceptions**. The mapping is one-to-one by rule:

| Pre-correction error rule                        | Count | Correction on the same payload |
| ------------------------------------------------ | ----- | ------------------------------ |
| `constraint/disjunctive-mandatory-too-few-roles` | 24    | `arity_mismatch`               |
| `constraint/frequency-invalid-min`               | 12    | `invalid_bounds`               |
| `constraint/exclusive-or-too-few-roles`          | 6     | `arity_mismatch`               |
| `constraint/exclusion-too-few-roles`             | 2     | `arity_mismatch`               |

`weights.conformanceCorrection` already prices every one of these. Adding
`weights.validationError` on top would price the identical defect a
second time under a different name, and the reader fitting the two
weights would have no way to see it.

### Why the check stays anyway

Its reachable failure path is not structural -- conformance owns all of
that -- it is **semantic**: a payload whose populations contradict its
own constraints. A model that declares "each employee works in at most
one department" and then emits sample data putting one employee in two
produces `population/uniqueness-violation`, which
`severityForModality` reports at `error` for any alethic constraint.
Conformance does not touch it, and cannot: it has no way to know whether
the data or the rule is the mistaken half.

That path is live rather than hypothetical. 49 of 192 payloads (26%)
emit populations at all, carrying 140 instances after correction. The
check has been reading real sample data on a quarter of runs and finding
it self-consistent every time.

So `must_validate` guards a genuine extraction failure -- a model that
contradicts itself -- that nothing else in the rubric watches.
`forbids_population` asks a different question: whether the _reference_
population is rejected by the candidate's constraints, which is
agreement with an answer key, not internal coherence. Keeping the
assertion costs nothing once it stops paying out.

## Scope

In scope:

- When `scoreExtraction` computes `rubricPassed` and `rubricTotal`, the
  system shall exclude results whose `kind` is `must_validate`.
- When a `must_validate` check runs, the system shall continue to
  evaluate it and include its result in `CaseScore.results`, so delta
  reports and per-check output are unchanged.
- When a `must_validate` check fails, the system shall report the
  resulting errors through `validationErrors`, which
  `weights.validationError` prices as it does today.
- When an eval case declares no check other than `must_validate`, the
  suite loader shall refuse the case at load time, naming the file.
- When the suite's scoring semantics change, the system shall carry a
  new `version` in `evals/suite.yaml` (2.8.0 to 2.9.0) so recorded rows
  from either side are refused as incomparable by `compareRows`.

Out of scope:

- barwise-901 (`subscription-billing`'s `matches: [cancel]` false pass).
  A separate defect in a different check kind; fixing it here would
  bundle two score changes under one version bump and make neither
  attributable.
- Re-weighting `conformanceCorrection` or `validationError`. The values
  are untouched; only what `validationError` multiplies changes, and it
  changes from a term that is always zero to one that is usually zero.
- Any change to `enforceConformance` or to production's pipeline.

## Inventory

| Module                                   | Current state                                               | Verdict                                    |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `promptlab/src/score/scoreExtraction.ts` | `rubricTotal = results.length`, over every declared check   | filters `must_validate` out                |
| `promptlab/src/evalcase/loadSuite.ts`    | `case "must_validate": break` -- accepted, never validated  | refuses a case with no other check         |
| `promptlab/evals/suite.yaml`             | `version: 2.8.0`                                            | bumped to 2.9.0                            |
| `promptlab/evals/*.eval.yaml`            | 10 cases each declare one `must_validate`                   | untouched -- the check still runs          |
| `llm/src/ExtractionConformance.ts`       | repairs ahead of validation, in scorer and production alike | untouched                                  |
| `core/src/validation/`                   | 74 rules; population violations at `error` for alethic      | untouched                                  |
| `promptlab/src/score/promptChecks.ts`    | `PromptCheckResult` already carries `kind`                  | untouched -- the filter needs no new field |

`rubricPassed`/`rubricTotal` are exported on `CaseScore` and consumed by
the history writer and the delta report. Both read the pair as authored;
neither recomputes it, so the change reaches them without edits.

## Target architecture

```ts
// scoreExtraction.ts -- the rubric fraction, after
const results = orderAsAuthored(declared, report.results, promptResults);

// Every declared check still runs and still appears in `results`.
// Only the FRACTION excludes must_validate.
const scored = results.filter((r) => r.kind !== "must_validate");
const rubricTotal = scored.length; // loader guarantees >= 1
const rubricPassed = scored.filter((r) => r.passed).length;

const raw = rubricPassed / rubricTotal
  - weights.conformanceCorrection * rated(corrections.length)
  - weights.validationError * rated(validationErrors) // now reachable
  - weights.validationWarning * rated(validationWarnings)
  - weights.ambiguityExcess * excess;
```

## Alternatives considered

- **Delete `must_validate` from all 10 cases and drop
  `validationError` from the weights.** Simplest, and defensible on 192
  payloads of evidence. It loses the only check watching for a model
  that contradicts its own populations -- a path that is live on 26% of
  payloads and that nothing else covers. Rejected: the complaint is the
  free credit, and removing the credit does not require removing the
  guard.
- **Validate the pre-correction model.** Rejected on measurement, not
  taste: 38/38 double-charge against `conformanceCorrection`, table
  above.
- **Redefine it as "valid AND non-degenerate."** Gives it a failure path
  on its own terms, but the non-degeneracy half restates what the
  `requires_element` checks already measure, so it would re-charge a
  defect the rubric already prices -- the same double-count objection in
  a different place.
- **Keep it in the fraction and document the constant.** A comment is
  not a check, and CLAUDE.md is explicit that a finding is not closed by
  a document. It also leaves `{}` scoring 0.125.

## Workstreams (each independently shippable)

### 1. Refuse a case whose only check is `must_validate`

First because it is the precondition: once the fraction excludes
`must_validate`, such a case divides by zero. Loader-side, so the error
arrives when the suite is authored rather than when a run is scored.
Touches `loadSuite.ts` and the two loader tests that construct
single-check cases. No score changes.

### 2. Exclude `must_validate` from the rubric fraction, bump to 2.9.0

The change itself, plus the version bump in the same commit -- they are
one semantic change and splitting them would publish a scoring change
under a version that claims comparability. Touches `scoreExtraction.ts`,
`suite.yaml`, and the scorer tests that assert rubric fractions on cases
declaring `must_validate`.

### 3. Record the new baseline

Re-score the 192 committed payloads at 2.9.0 via `prompt rescore` and
record the shift in `docs/prompt-optimization-log.md`, so the next
reader can see what the bump cost each case rather than inferring it.
No code changes.

## API and migration impact

- `CaseScore.rubricPassed` / `rubricTotal` change meaning for the 10
  cases declaring `must_validate`: both drop by one on a passing case.
  The field names and types are unchanged.
- No public export changes. `promptlab` is consumed by `cli` only; the
  `prompt eval`, `prompt score`, `prompt rescore` and `prompt compare`
  surfaces are untouched.
- Recorded history rows written at 2.8.0 and earlier stay readable;
  `compareRows` already refuses a cross-version comparison, which is
  what the bump is for.

## Open decisions (for review)

- **What a case with only `must_validate` should do.** Recommended:
  refuse at load. The alternative -- score it 1.0, on the grounds that
  nothing was asked -- makes the emptiest possible rubric the highest
  scoring one, which is the defect this spec exists to remove. A third
  option, scoring it 0.0, punishes the case author for a suite mistake
  rather than telling them about it. Refusing is the only one that
  cannot be misread.

## Risks and testing

- **The 2.8.0 answer keys must still pass.** barwise-894 landed 43
  discriminating `forbids_population` checks at 2.8.0; this changes the
  denominator they sit in, not their outcomes. `npm run audit:rubric --
  --check` must stay green, and its baseline must not move.
- **The empty-payload case is the acceptance test.** `{}` scores 0.125
  today and must score 0.000 after. Worth an explicit test rather than
  an incidental one -- it is the finding stated as an assertion.
- **A `must_validate` failure must still cost.** Because the check has
  never failed on real output, a test has to construct the failing
  input: a payload whose population violates its own alethic uniqueness
  constraint. Without it the reachable path stays a claim in this
  document.
- Land 1 and 2 as separate PRs; run `npm run ci:local` after each.

## Non-goals

- No new check kinds, no change to any case's authored checks.
- No change to `enforceConformance`, to production extraction, or to
  the validator's rules or severities.
- No re-weighting. This spec changes what a weight multiplies, never
  what it is.
