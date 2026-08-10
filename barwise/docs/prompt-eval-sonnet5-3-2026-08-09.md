# sonnet5-3 verification: prompt slimming holds; a bimodal case surfaces

> **Correction (2026-08-09, after publication).** The
> university-enrollment failures this report attributes to a lost
> CourseOffering reification are not modeling failures. In all three
> failing samples the offering is fully reified; the model named it
> `Offering` and recorded `aliases: ["Course Offering"]`, and the
> evaluator's alias matching compares strings exactly, so the space in
> the alias defeats a rubric asking for `CourseOffering`. Under a
> normalized comparison every one of these samples passes and no
> passing sample changes. The scores below are real, but their stated
> cause is wrong, and the backlog item calling this "the sonnet5
> lineage's largest known failure mode" is withdrawn: the defect is in
> `learn/src/evaluate/nameResolution.ts`, not in the prompt. See
> `docs/prompt-eval-haiku45-2026-08-09.md`.

Date: 2026-08-09
Suite: `@barwise/promptlab` seed suite 1.1.0, weights 0.02 / 0.10 /
0.05, scored with the conformance identifier-population repair
(`docs/specs/conformance-population-repair.spec.md`) in the parse path
Config under test: Claude Sonnet 5 on sonnet5-3 (the sonnet5-2 prompt
with the identifier-population clause removed, now that code owns
that invariant)
Channel: keyless subagent completions, deterministic local scoring;
same caveats as `docs/prompt-eval-remeasure-2026-08-09.md`; nothing
written to `evals/history.jsonl`.

## Verdict

The slimming holds: every score difference between sonnet5-3 and
sonnet5-2 either is the designed repair trade-off (freight) or
reproduces identically under sonnet5-2 (a pre-existing bimodal
failure on university-enrollment that single-sample runs had never
caught). PR #299 merges; the keyed gate remains the acceptance path.

## Full-suite run (one sample per case)

| Case                  | sonnet5-3 | sonnet5-2 (prior run) |
| --------------------- | --------- | --------------------- |
| order-management      | 1.000     | 1.000                 |
| university-enrollment | 0.117     | 0.950                 |
| clinic-appointments   | 1.000     | 1.000                 |
| employee-hierarchy    | 1.000     | 1.000                 |
| project-staffing      | 0.837     | 0.980                 |
| conference-reviews    | 1.000     | 1.000                 |
| freight-corrections   | 0.910     | 0.950                 |

Three cases moved; each was investigated rather than averaged over.

## The three deltas, resolved

- **freight-corrections 0.950 -> 0.910 is the designed trade.** The
  slimmed prompt no longer tells the model to emit identifier
  populations, the model omitted them, and `enforceConformance`
  synthesized the entailed instances at two 0.02 corrections --
  instead of the 0.10-per-error validation damage the same omission
  cost before the repair existed. Zero validation errors; full rubric
  passing. Prompt tokens moved to code, score charge stays honest.
- **project-staffing 0.837 was variance.** The single run missed the
  acyclic ring; two re-samples under sonnet5-3 both captured it
  (0.980, 0.960). The ring miss also occurred under the default
  artifact earlier -- it is an occasional-mode failure, not a
  slimming effect.
- **university-enrollment 0.117 is a pre-existing bimodal mode, not a
  regression.** Across four sonnet5-3 samples, two scored 0.117 and
  two scored 0.950-1.000. (The 0.117 samples were described here as
  omitting CourseOffering entirely and modeling Student-Course
  directly. That is wrong -- see the correction above. They reify the
  offering under the name `Offering` with alias `"Course Offering"`,
  and the evaluator's exact-string alias match rejects it. The
  bimodality is real; its cause is the scorer.) The controlled
  comparison -- three fresh
  samples under unchanged sonnet5-2 -- reproduced the identical
  failure signature at one in three (0.117, 0.950, 0.950). The mode
  exists on both sides of the diff at statistically
  indistinguishable rates; the removed clause (population guidance,
  on a case with no populations) has no causal path to it.

## New findings for the backlog

- ~~**CourseOffering omission is the sonnet5 lineage's largest known
  failure mode**~~ **-- WITHDRAWN.** There is no omission. The samples
  reify the offering and name it `Offering`; the rubric asks for
  `CourseOffering`; `learn/src/evaluate/nameResolution.ts` compares
  aliases with `Array.includes`, so the space in the recorded alias
  `"Course Offering"` defeats the match. Under a normalized comparison
  every affected sample passes and no passing sample changes. The
  optimization target this bullet proposed -- sharpening
  objectification guidance -- would have been work against a defect
  that was never in the prompt. The real item is normalizing the
  evaluator's comparison, tracked in
  `docs/prompt-eval-haiku45-2026-08-09.md`.
- **Single-sample runs hide bimodal modes.** Every prior report drew
  one sample per case and never saw this. The harness already has
  the `repeat` parameter for exactly this; future keyed gate runs
  should use repeat >= 3 on cases whose scores gate a decision.
