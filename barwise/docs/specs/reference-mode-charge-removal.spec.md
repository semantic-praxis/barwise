# Removing the conformance check that mirrored nothing

Status: Implemented
Created: 2026-08-23
Last-updated: 2026-08-23
Tracking: barwise-839. Surfaced by `correctionsByCategory`
(barwise-836) the moment that tally existed.

## Principle

Conformance has one job, stated in `packages/llm/CLAUDE.md`: mirror
every structural rule the validator enforces, so a rule with no
counterpart does not become a validation error the extraction could not
avoid. That is the whole argument for the module's existence, and it
runs in one direction -- from a validator rule to a conformance check.

`orphaned_reference_mode` ran in no direction. It was the only check in
the module with no validator counterpart, and it charged 0.02 for a
condition core does not consider a defect at all.

## The evidence

Four findings, each checked against source:

1. **No validator counterpart.** Nothing in
   `core/src/validation/rules/` mentions `referenceMode`. Every other
   check in `ExtractionConformance.ts` can name the rule it prevents.

2. **Core rates the nearest thing `info`, which costs zero.**
   `completeness/missing-preferred-identifier` fires on an entity with
   no explicit identifier and its message says the relational mapper
   will use a heuristic. Core's own position is that this is fine.
   Conformance charged 0.02 -- more than core charges for the closest
   real diagnostic.

3. **The parser manufactures a reference mode for every entity.**
   `parse/objectTypes.ts` does `ext.reference_mode ?? camelCase(name) +
   "_id"`, because `ObjectType` throws without one. A reference mode is
   mandatory, not optional metadata, so "has a reference mode" was
   never evidence of anything.

4. **It flagged what the notation is for.** In ORM 2,
   `Patient (medical_record_number)` _is_ the shorthand for the
   identifier fact type. The check asked the extraction to spell out
   the thing the notation abbreviates.

And the distributional evidence that started it: it fired **0 times
across 15 live dev runs** and **14 times across 7 hand-curated answer
keys**. Something that fires only on careful work and never on rough
work is not measuring quality.

## Why removal rather than a reweight or a new tier

The issue named three options. (a) The detection is right and the
prompt should be taught to emit identifier fact types -- rejected by
finding 4: there is nothing to teach, the notation already says it.
(b) Detect-only findings should not be charged but should still be
reported -- rejected by findings 1 and 2: a report of something core
rates `info` is noise, and the module is not a general advice channel.
(c) Removal -- what findings 1-4 support.

Reweighting was explicitly refused up front. Every recorded history row
priced this rule at 0.02, so changing the weight would silently
reinterpret the whole record, which is the failure barwise-836 exists
to prevent. Removing it has the same effect on comparability, which is
why the suite version moves (below) rather than the weight.

## Consequence, stated before it was agreed

All seven recorded answer keys move from 0.94-0.98 to **exactly
1.000**. That is arguably the point: hand-curated reference payloads
should score 1.0, and they did not, solely because of a check that
mirrored nothing.

Nine test pins move with them, and two collapse-floor tests that used
`0.999` as "above every achievable score" now need a floor above 1.0.

## The suite version moves to 1.3.0

1.3.0 changes no case, no weight and no floor. It marks a change
_outside_ the manifest that has the same consequence a case change
would: a mean recorded under 1.2.0 and one recorded under 1.3.0 measure
different things, because every payload scored under 1.2.0 carried a
charge that no longer exists.

The version is the field a reader uses to decide whether two history
rows can be compared, and after this they cannot. A bump that names no
case change is the honest signal; leaving it alone would make the
record quietly wrong. The manifest comment says so at the version line,
because that is where the question gets asked.

## Scope

In scope:

- Remove `checkOrphanedReferenceModes`, its call site, and
  `identifierFactTypeEntities`, which nothing else read.
- Keep a regression test asserting the charge does **not** happen,
  carrying the four findings, so reintroducing it fails a test rather
  than silently repricing the record.
- Re-pin the seven answer keys at 1.000 and the tests that depended on
  them being imperfect.
- Bump the suite to 1.3.0.

Out of scope, deferred and named:

- **`completeness/missing-preferred-identifier` itself.** Core's rule
  is fine as an `info`. This spec says nothing about it beyond using it
  as the comparison.
- **The other detect-only corrections.** `orphaned_reference_mode` was
  the only check that changed nothing and charged anyway; every other
  category removes or repairs something. If a second detect-only check
  ever appears, the "own tier" question comes back with it.

## Inventory

| Area                                             | Current state             | Verdict |
| ------------------------------------------------ | ------------------------- | ------- |
| `llm/src/ExtractionConformance.ts`               | Check 8 + its inputs      | remove  |
| `llm/tests/ExtractionConformance.test.ts`        | Two tests asserting it    | replace |
| `promptlab/tests/scoreExtraction.test.ts`        | Seven pins at 0.94-0.98   | re-pin  |
| `promptlab/tests/{runSuite,progress,truncation}` | Means and collapse floors | re-pin  |
| `promptlab/evals/suite.yaml`                     | version 1.2.0             | bump    |
| `core/.../rules/`                                | Correct; mentions none    | none    |

## Risks and testing

- **Two tests were leaning on an answer key being imperfect.** The
  weights-and-floor test needed three corrections to exist, and the
  penalties-reach-the-history-row test read the one correction every
  key happened to carry. Both now manufacture a penalty -- an exclusion
  constraint over a single role, which conformance removes and records.
  That is the honest form of both tests: they were always about the
  weights and the record, and leaning on an unrelated check made them
  hostage to it. **That is how this check came to be load-bearing
  without anyone choosing it**, which is the finding worth carrying
  forward from this change.
- **A floor of 0.999 no longer stands above every achievable score.**
  Two tests used it as a stand-in for a collapse. Both now use 1.001.
  A test that silently stops testing what it names is the failure mode
  barwise-840 was about.
- **Reintroduction.** The regression test asserts zero corrections on
  an entity with a reference mode and no identifier fact type, and
  carries the reasoning inline so the next reader does not re-derive
  the question and re-add the check.
- Full gate: `npm run build`, `test`, `lint` from `barwise/`.

## Non-goals

- No change to the scoring weights.
- No change to `constraintConsistency` or any core rule.
- No prompt change.
