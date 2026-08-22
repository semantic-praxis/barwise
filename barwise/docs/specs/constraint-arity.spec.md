# Conformance and validation disagreed about constraint arity

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-826. Found by the first dev-split run that completed
without truncation (barwise-818, barwise-821).

## Principle

Orthogonality, in its failure mode. `enforceConformance` and the
validation engine are separate modules by design, but they are not
independent: conformance exists to hand the parser something the
validator will accept. When the two hold different rules for the same
property, the pipeline produces models it already knows are invalid,
and neither module is wrong on its own terms.

Also **define errors out of existence**. A malformed constraint that
conformance can recognise should be removed there, once, rather than
becoming a validation error every caller downstream has to explain.

## What was measured

The first dev-split run after the output budget was fixed:

| Case                   | Score | Output tokens | Failure                               |
| ---------------------- | ----: | ------------- | ------------------------------------- |
| `vendor-onboarding`    | 0.023 | 12,604/41,640 | mandatory role unplayed (other)       |
| `subscription-billing` | 0.677 | 14,177/35,255 | exclusive-or over 1 role              |
| `incident-response`    | 0.000 | 10,509/31,700 | disjunctive mandatory over 1 role, x7 |

No truncation -- every case finished well inside its budget, which is
what the budget change was for. The remaining failures were ours.

`isValidArity` fell through to a permissive `>= 1` for
`disjunctive_mandatory`, `exclusion`, and `exclusive_or`, while
`validation/rules/constraintConsistency.ts` rejects exactly those three
below two roles. Conformance passed them; the validator then errored on
every one, at a 0.1 penalty each. Seven of them is 0.7, which is why
`incident-response` scored zero.

## Why remove rather than repair

A single-role disjunction is not a weaker constraint, it is a
contradiction in terms: there is nothing for the role to be disjoint
from. Two repairs were considered and rejected:

- **Convert to `mandatory`.** Semantically defensible for
  `disjunctive_mandatory` and `exclusive_or` over one role, and wrong
  in practice: it asserts a rule the extraction did not state. The
  model may have listed one role because it found one, not because it
  meant the role is mandatory -- and an invented mandatory constraint
  is exactly what produced `vendor-onboarding`'s separate failure.
- **Leave it and let the validator report it.** That is the status quo,
  and it charges 0.1 for a defect worth 0.02.

Removal matches what Check 5 already does for every other arity
mismatch, and the correction is recorded either way, so nothing is lost
silently.

## Scope

In scope:

- When a `disjunctive_mandatory`, `exclusion`, or `exclusive_or`
  constraint covers fewer than two roles, conformance shall remove it
  and record an arity correction.
- When such a constraint covers two or more, it shall survive
  untouched.
- The two modules' agreement shall be asserted end to end, not
  module-locally.

Out of scope, deferred and named:

- **`vendor-onboarding`'s mandatory-role violation.** A different
  defect: a mandatory constraint whose role is not played by a
  population instance the same extraction supplied. Conformance can see
  both halves and could reconcile them. Filed as barwise-827.
- **Re-tuning the payload ratio.** The run shows large transcripts need
  far less than the derived budget (see below). Recording the data is
  enough; changing the constant is not obviously right.

## The budget, now that it has been observed

The derivation over-provisions, by about three times, for exactly the
inputs it was built for:

| Case                   | Transcript | Output used | Budget | Observed ratio |
| ---------------------- | ---------: | ----------: | -----: | -------------: |
| `vendor-onboarding`    |   17,171 B |      12,604 | 41,640 |           2.94 |
| `subscription-billing` |   14,538 B |      14,177 | 35,255 |           3.90 |
| `incident-response`    |   13,072 B |      10,509 | 31,700 |           3.22 |

The seed cases ran 4.0 to 9.7. So the ratio **falls** as transcripts
grow -- longer sessions repeat themselves, and the extracted model does
not grow with them. A single constant cannot fit both ends, and the
calibration used the densest small case.

Left alone deliberately. The asymmetry argument that chose 9.7 still
holds: an under-budget run corrupts a measurement, an over-budget one
costs nothing, since providers bill generated tokens rather than
permitted ones. What the data does change is barwise-819's severity:
the largest real requirement observed is 14,177 tokens, which fits
inside gpt-4o's 16,384 ceiling. The concern that a derived budget would
be rejected outright is much smaller than it looked.

## Inventory

| Area                                      | Current state                | Verdict   |
| ----------------------------------------- | ---------------------------- | --------- |
| `llm/src/ExtractionConformance.ts`        | `>= 1` for the three types   | modify    |
| `core/.../rules/constraintConsistency.ts` | `>= 2`, and correct          | untouched |
| `llm/tests/ConstraintArity.test.ts`       | Nothing pinned the agreement | new test  |

## Risks and testing

- **Over-eager removal would delete valid constraints.** A real
  disjunction over two roles is the entire point of these types, so
  each is tested in both directions.
- **A module-local test would re-pin one side of the disagreement.**
  The invariant is a property of the pair: whatever survives
  conformance must not trip the validator's arity rule. That test runs
  the full path and uses `ValidationEngine`, the entry point
  `scoreExtraction` uses -- a different one could agree and still cost
  the score.
- Verified load-bearing: reverting the fix fails 7 of the 10 tests.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No prompt change. The extraction is asked for valid constraints; this
  is about what the pipeline does when it does not get them.
- No new constraint types, no change to the validator.
