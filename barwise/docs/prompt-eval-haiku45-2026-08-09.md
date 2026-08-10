# Haiku 4.5 extraction: baseline, two variant rounds, and what it costs

Date: 2026-08-09
Suite: `@barwise/promptlab` seed suite 1.1.0, weights 0.02 / 0.10 /
0.05, scored through the production parse path
(`parseExtractionResponse` -> `enforceConformance` -> `parseDraftModel`
-> `ValidationEngine` -> `evaluateCandidate`)
Configs: Claude Haiku 4.5 on the default artifact (baseline), on
`haiku45-1`, and on `haiku45-2`
Channel: keyless subagent completions, deterministic local scoring;
same caveats as `docs/prompt-eval-remeasure-2026-08-09.md`. Nothing
written to `evals/history.jsonl` -- the keyed `barwise prompt eval`
gate remains the acceptance path.

## Verdict

Haiku 4.5 is usable for extraction once it has its own artifact. The
default prompt leaves it at 0.760 mean with two hard-failure modes;
`haiku45-1` lifts it to 0.916 (0.943 discounting one malformed-JSON
sample); `haiku45-2` closes the three remaining failure classes and
reaches 0.948 with no malformed payloads and six of seven cases at
0.97 or better. Nothing in either variant is a rubric workaround --
every added rule targets a defect visible in the payload itself. The
one failure that survives is a naming miss, not a modeling miss, and
most of what this suite recorded under that heading turns out to be a
scoring bug in the evaluator (see Findings).

## Sampling

This round used **n=5 per case** for the first variant, not the n=1 or
n=2 of earlier reports. That change came directly from the
sonnet5-3 finding that single-sample runs hide bimodal modes
(`docs/prompt-eval-sonnet5-3-2026-08-09.md`), and it paid for itself
immediately: three of the seven cases here have a spread of 0.20 or
more between their best and worst sample. Any conclusion drawn from
one draw per case would have been noise. `haiku45-2` was measured at
n=3, enough to confirm the targeted classes are gone without
re-litigating variance that n=5 already characterized.

## Baseline: Haiku 4.5 on the default artifact (n=2)

| Case                  | scores       | mean  |
| --------------------- | ------------ | ----- |
| order-management      | 0.900, 0.900 | 0.900 |
| university-enrollment | 0.700, 0.700 | 0.700 |
| clinic-appointments   | 0.483, 0.127 | 0.305 |
| employee-hierarchy    | 0.960, 1.000 | 0.980 |
| project-staffing      | 0.607, 0.980 | 0.794 |
| conference-reviews    | 0.950, 0.950 | 0.950 |
| freight-corrections   | 0.477, 0.910 | 0.693 |

Overall mean 0.760, worst sample 0.127. Two failure classes account
for almost all of the loss:

- **`min: 0` frequency constraints.** Haiku reached for a frequency
  constraint with a zero minimum whenever a transcript said something
  was optional ("an appointment can have at most one follow-up note").
  A zero minimum is not a valid frequency in the schema, so those
  samples took schema errors at 0.10 each. The correct encoding is an
  internal uniqueness constraint with no mandatory -- optionality is
  the absence of mandatory, not a zero floor.
- **Chronic under-constraint.** Fact types shipped with no internal
  uniqueness constraint at all, each drawing a
  `completeness/fact-type-without-uniqueness` warning at 0.05.

## haiku45-1: the two baseline classes, addressed (n=5)

`packages/llm/prompts/extraction.haiku45.prompt.yaml`, branched from
the sonnet5-3 lineage with two added rules: frequency `min` must be at
least 1 and never 0 (with the follow-up-note example spelled out), and
every fact type with two or more roles must carry an internal
uniqueness constraint.

| Case                  | scores                            | mean  |
| --------------------- | --------------------------------- | ----- |
| order-management      | 1.000, 0.950, 0.950, 1.000, 1.000 | 0.980 |
| university-enrollment | 0.750, 1.000, 1.000, 0.700, 1.000 | 0.890 |
| clinic-appointments   | 0.880, 1.000, 1.000, 1.000, 0.800 | 0.936 |
| employee-hierarchy    | 0.960, 1.000, 1.000, 1.000, 1.000 | 0.992 |
| project-staffing      | 0.000, 0.980, 0.980, 0.980, 0.980 | 0.784 |
| conference-reviews    | 1.000, 1.000, 1.000, 1.000, 1.000 | 1.000 |
| freight-corrections   | 0.960, 0.693, 0.960, 0.910, 0.643 | 0.833 |

Overall mean 0.916 across 35 samples; 0.943 over the 34 that parsed.
**Zero `min: 0` errors** in any sample -- the class is gone.

The 0.000 on project-staffing is a single malformed-JSON payload: a
bracket error mid-document at byte 6982, not a truncation. It is
substantially a keyless-channel artifact, because production
constrains the response with `buildResponseSchema` rather than asking
for free-form JSON; later batches added an explicit "ensure the JSON
is syntactically valid" instruction and it did not recur. One
malformed payload in 35 is the honest headline number for this
channel, and the reason both means are reported.

## The three residual classes, and why each is a prompt fix

Reading the n=5 diagnostics rather than the scores gave three
distinct, mechanically identifiable defects.

- **Mandatory constraints colliding with a partial example
  population** (freight-corrections, 2 of 5). Haiku asserted mandatory
  on `Shipment sits in Warehouse` -- which the transcript supports,
  "every shipment is in at least one warehouse" -- and separately
  recorded the worked example `S-100 contains P-77 in quantity 5`.
  Core reads sample populations closed-world, so S-100 existing
  without a warehouse is a `population/mandatory-violation` error. The
  three samples that scored 0.960 differ only in omitting the
  mandatory. The fix keeps the constraint and drops the population:
  the constraint is the business rule, the population is only an
  illustration.
- **Uniqueness skipped on plain attribute fact types**
  (university-enrollment, 2 of 5). The haiku45-1 rule said "every fact
  type with two or more roles", and Haiku applied it to identifier and
  relationship facts but read `Course has CourseTitle` and
  `Semester has SemesterStartDate` as too obvious to constrain. Naming
  attribute facts explicitly is the fix.
- **Binaries with only a forward reading** (clinic-appointments, 2 of
  5). `Appointment on Date`, `Appointment has FollowUpNote` and
  friends each drew a `structural/binary-missing-inverse-reading`
  warning. No deterministic layer can invert a reading -- "on Date" to
  "is the date of" is a language judgment -- so this belongs in the
  prompt.

None of these is repairable in code, which is the test applied since
`docs/specs/conformance-population-repair.spec.md`: the
identifier-population invariant moved to `enforceConformance` because
it is entailed by the payload; these three require judgment about
what the transcript means, so they stay in prompt text.

## haiku45-2: all three classes closed (n=3)

| Case                  | scores              | mean  |
| --------------------- | ------------------- | ----- |
| order-management      | 1.000, 1.000, 1.000 | 1.000 |
| university-enrollment | 1.000, 1.000, 0.167 | 0.722 |
| clinic-appointments   | 1.000, 1.000, 1.000 | 1.000 |
| employee-hierarchy    | 1.000, 0.960, 0.960 | 0.973 |
| project-staffing      | 0.980, 0.980, 0.960 | 0.973 |
| conference-reviews    | 1.000, 1.000, 1.000 | 1.000 |
| freight-corrections   | 0.960, 0.950, 1.000 | 0.970 |

Overall mean 0.948 across 21 samples, with no malformed payloads. Six
of the seven cases sit at 0.97 or better; discounting the single
CourseOffering sample discussed below, the mean is 0.988.

Each targeted class is gone rather than merely cheaper:

- freight-corrections no longer produces the mandatory/population
  collision in any sample -- the two 0.643/0.693 outliers are absent,
  and the case's worst sample is now 0.950;
- clinic-appointments carries zero
  `structural/binary-missing-inverse-reading` warnings across all
  three samples, up from four in the worst haiku45-1 sample;
- university-enrollment and every other case carry zero
  `completeness/fact-type-without-uniqueness` warnings.

The one remaining failure is a **naming miss on CourseOffering**: one
sample in three named the entity `Offering` rather than
`CourseOffering`, and the rubric matches by name, so five of six
checks failed at once. The offering is fully reified in that sample --
it carries `Offering is of Course`, `Offering belongs to Semester`,
`Offering is taught by Instructor`, and an offering identifier. What
the rubric scored as a missing concept is a missing string.

The transcript supports both names: line 3 says "course offerings",
and from line 7 the stakeholder shortens to "offering". The sample did
not record the fuller form as an alias, so nothing connected the two.
The fix is the compound-term alias rule -- keep the fuller stakeholder
term as the name, record the abbreviation as an alias -- not
objectification guidance, which was never the problem.

## Findings for the backlog

- **Core validates sample populations closed-world.** A mandatory
  constraint is checked against the object universe assembled from the
  populations, so a transcript that supplies a worked example for one
  fact type and none for another makes the _more complete_ extraction
  look invalid. The freight reference sidesteps this by expressing
  "at least one warehouse" as a frequency `min: 1` rather than a
  mandatory -- frequency is not population-checked. That asymmetry is
  worth a decision: either populations are partial illustrations and
  mandatory should not be checked against them, or they are complete
  states and frequency should be. Changing it moves answer-key pins,
  so it is the maintainer's call, filed rather than fixed.
- **The malformed-JSON rate is a channel property, not a model
  property.** Measuring through subagents rather than the constrained
  tool-use path leaves output-format failures in the sample. Any
  cross-tier comparison built on these numbers should report parsed
  and unparsed means separately, as this report does.
- **The evaluator's alias matching is exact-string, and that is a
  scoring bug.** `learn/src/evaluate/nameResolution.ts` compares
  aliases with `Array.includes`, so a candidate naming a type
  `Offering` with alias `"Course Offering"` fails a rubric asking for
  `CourseOffering` -- the space defeats the match. Every sonnet5
  "CourseOffering" failure on record is of exactly this shape and
  flips to passing under a normalized comparison (case-folded,
  separators stripped); no currently-passing sample changes. The
  earlier reading of these failures as lost objectification was wrong
  and is retracted in
  `docs/prompt-eval-sonnet5-3-2026-08-09.md`. Normalizing the
  comparison is a `@barwise/learn` fix that ships on its own.
