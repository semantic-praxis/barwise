# Suite 2.0.0 baseline, haiku45-2, both splits (2026-08-26)

The first measurement of the rated suite
(`docs/specs/eval-split-stratification.spec.md`, workstream 1). Run by
the operator on a local key, per `docs/local-eval-runbook.md`, with
`--no-history`: these numbers ground the decisions in workstreams 2 and
3, they are not the committed baseline the re-split will be measured
against. `evals/history.jsonl` still does not exist, which is what keeps
the re-split cheap (barwise-846).

Artifact `haiku45-2@3edda4eff7e5` on `anthropic/claude-haiku-4-5`,
`repeat 5`, both splits. No truncations, no failed calls, cache reading
on every run.

## What it recorded

| Split     | Mean  | 95% margin | Resolvable gap | Worst |
| --------- | ----- | ---------- | -------------- | ----- |
| train (7) | 0.891 | 0.061      | 0.086          | 0.154 |
| dev (3)   | 0.965 | 0.016      | 0.022          | 0.883 |

Per case:

| Case                  | Split | Mean  | SD    | ok  | Quality       |
| --------------------- | ----- | ----- | ----- | --- | ------------- |
| order-management      | train | 0.993 | 0.011 | 5/5 | 0.993 ± 0.011 |
| university-enrollment | train | 0.496 | 0.460 | 2/5 | 1.000 ± 0.000 |
| clinic-appointments   | train | 0.985 | 0.010 | 5/5 | 0.985 ± 0.010 |
| employee-hierarchy    | train | 1.000 | 0.000 | 5/5 | 1.000 ± 0.000 |
| project-staffing      | train | 0.980 | 0.000 | 5/5 | 0.980 ± 0.000 |
| conference-reviews    | train | 0.845 | 0.158 | 5/5 | 0.845 ± 0.158 |
| freight-corrections   | train | 0.937 | 0.018 | 5/5 | 0.937 ± 0.018 |
| vendor-onboarding     | dev   | 0.976 | 0.023 | 5/5 | 0.976 ± 0.023 |
| subscription-billing  | dev   | 0.968 | 0.047 | 5/5 | 0.968 ± 0.047 |
| incident-response     | dev   | 0.952 | 0.012 | 5/5 | 0.952 ± 0.012 |

## The dev split is now the easier half, and that is barwise-845

Under 1.2.0 the dev mean was 0.631 and dev read as the hard half. Rating
the penalties inverted it: dev now scores 0.074 **above** train, with an
error bar a quarter as wide.

The mechanism is visible in the run output rather than inferred. **No
dev case failed a rubric check.** Every failure line printed in either
run belongs to `university-enrollment` or `conference-reviews`, both
train. The dev cases' sub-1.000 scores are entirely penalties --
`corrections=2.4`, `warnings=2.6`, `excessAmbiguity=1` -- not missing
content.

So the two halves still measure different quantities, and the 2.0.0
weights only changed which direction the difference points. Dev grades
element recall, which haiku has in full on all three cases; train grades
constraint semantics through `forbids_population`, which is where the
entire distribution lives. That is the confound barwise-845 exists to
close, now with a number on it.

## What it says about the case count (barwise-846, workstream 3)

The spec's rule was that if the dev error bar is comfortable at four or
five cases, the third new long transcript is not worth writing. It is
comfortable at **three**: ±0.016, resolvable 0.022.

**Do not bank that number.** Dev is tight precisely because its rubric
cannot produce the correlated failure this suite's variance is made of:
every large deviation here came from a `requires_element` plus
`forbids_population` block flipping together on one modelling decision.
Workstream 2 gives the dev cases exactly those checks, so dev's spread
should rise toward train's. Sizing the split against today's dev bar
would fit it to a rubric that is about to change.

What this run does establish: nothing here supports authoring three new
long transcripts on error-bar grounds. Re-measure dev dispersion after
workstream 2 lands, then choose.

## barwise-852 is a rubric bug: the case discriminates on a synonym

`university-enrollment`: `ok=2/5`, `quality=1.000 +/- 0.000`. When it
survives it scores **exactly 1.000 with zero spread**; when it does not,
0.167, 0.154, 0.160 with an identical failure list all three times --
three `requires_element` and two `forbids_population` checks on
`CourseOffering`, failing as one block. It accounts for 89% of the
suite's noise; without it the train resolvable gap falls from 0.086 to
roughly 0.03, and the other six cases average 0.957.

Reading the two retained payloads settles what that block is. It is not
a modelling failure and not a hard case. **The collapsed run models the
offering correctly and is failed for naming it `Offering`.**

| Rubric check                                                 | What the collapsed run has                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `requires_element` entity `CourseOffering`                   | `Offering`, entity, `reference_mode: offering_id`                       |
| `factTypeBetween [Student, CourseOffering]`                  | `Student enrolls in Offering`                                           |
| `factTypeBetween [CourseOffering, Semester]`                 | `Offering is in Semester`                                               |
| `forbids_population CourseOffering is of Course` (IUC)       | `Offering is of Course`, IUC on the Offering role, mandatory            |
| `forbids_population Instructor teaches CourseOffering` (IUC) | `Offering is taught by Instructor`, IUC on the Offering role, mandatory |

Nothing structural is missing. `normalizeForMatch` folds case and strips
separators, so `Course Offering` and `course_offering` already resolve --
but it cannot match a head noun to a compound, and should not, since
that same rule would match `Course` to `CourseOffering`. The candidate
recorded no alias, so the resolution has nothing to work with.

**The transcript licenses the name it punishes.** The Registrar says
"course offering" three times and bare "offering" nine, including the
line the model cited for its reference mode: "Offerings get an offering
ID." The rubric demands the minority spelling, so the extraction that
followed the transcript's dominant vocabulary is the one that fails.

The clinching evidence that this case is not measuring modelling: the
run that scored **1.000** diverges from the reference on grades -- it
objectifies `Enrollment` and hangs `Enrollment has Grade` off it, where
the reference has the ternary `Student receives LetterGrade for
CourseOffering`. The **0.154** run has that ternary, with uniqueness on
`[Student, Offering]`, matching "a student gets at most one grade per
offering". The rubric declares no grade check, so a real structural
difference is invisible while a synonym costs 0.85.

`collapseFloor: 0.3` still did exactly what it was specified to do --
the two modes are reported apart and the quality mean is untouched -- so
the floor needs no re-fitting. What needs fixing is the rubric.

### What to do about it

Not a transcript rewrite. People shorten terms mid-conversation; that is
what makes the transcript realistic, and normalizing the vocabulary
would hide the defect rather than repair it.

The fix belongs where the mismatch is, in what a case is allowed to
declare: **let a rubric name the terms the domain licenses**, as
`entity: [CourseOffering, Offering]` and the same for
`forbids_population`'s `factType`. That is "explicit over implicit"
applied to the case author, who can see that the transcript offers two
words for one concept. It widens `ElementQuery` in `@barwise/learn` and
its parser.

A second change is worth making on its own merits and is not a
substitute: **have the extraction record the transcript's own terms as
aliases.** `getObjectTypeByNameOrAlias` already consults candidate
aliases, so an `Offering` carrying the alias `course offering` would
pass all five checks today. Capturing the domain's vocabulary is ORM's
job. But it is a behavioural ask of the model rather than a guarantee,
so the metric cannot rest on it.

Until one of those lands, this case's 0.460 SD is measuring word choice,
and every mean that includes it inherits that.

### The same check is owed to conference-reviews

`conference-reviews`, sd=0.158, three of five samples missing
`Reviewer reviews Paper` and failing its `requires_element` and
`forbids_population` together -- the identical shape. Its retained
payloads should be read before assuming it is a different problem.

## Operational notes

- **No truncation anywhere.** Train peaked at 9,956 of 16,384 output
  tokens, dev at 14,315 of 41,640. The per-case budget derived from
  transcript length has comfortable headroom at both sizes, and
  `--max-tokens` was not needed.
- **Caching worked on both runs**: 258,774 read against 4,796 written on
  train; 167,864 against 9,576 on dev. No cache warning fired.
- **12 payloads saved on train, 6 on dev** -- best and worst per case,
  which is what `keepDiagnosticPayloads` retains.

## Next

1. **barwise-845 is unblocked and needs no further calls.** Every dev
   sample passed its full rubric, so the saved payloads are usable
   answer keys; the sonnet dev arm's trigger condition (a best sample
   that cannot pass its own rubric) did not fire. Identify the best
   payload per case with `barwise prompt score --case <id> --extraction
<file>`, install it as `tests/fixtures/responses/<caseId>.json`, and
   run `npm run regen:references`.

   One thing to watch when pinning: the existing seven answer keys score
   exactly 1.000, and these three will pin below it -- `vendor-onboarding`
   reached 1.000, but `subscription-billing` topped out at 0.989 and
   `incident-response` at 0.960, on conformance corrections and
   validation warnings rather than any failed check.

2. barwise-852 is settled: the case discriminates on a synonym. File
   the rubric-alternatives change against `@barwise/learn`, and read the
   `conference-reviews` payloads for the same defect. Do not re-fit
   `collapseFloor` and do not rewrite the transcript.
3. Re-measure dev dispersion after step 1, then decide the case count.
4. The sonnet arms stay unrun. They answer the variant-versus-default
   comparison, which nothing above is waiting on.
