# Realistic eval transcripts: disagreement, correction, and unresolved questions as scored signal

Status: Accepted (workstream 1 implemented; see Implementation notes)
Created: 2026-08-20
Last-updated: 2026-08-20
Tracking: sibling to `docs/specs/eval-suite-hardening.spec.md`; parent
`docs/specs/prompt-optimization-harness.spec.md`. Saturation
re-confirmed by `docs/prompt-eval-haiku45-2026-08-09.md`. No bd issue
yet (bd unavailable in this session).

## Principle

Composability -- the suite is the shared metric every optimization lane
composes against, and it has saturated a second time. Hardening v1
diagnosed saturation as missing ORM constructs and answered with three
cases reaching ring, frequency, and objectification. That worked, and
then the ceiling returned: the haiku45-2 artifact scores 0.948 across
the seven cases with six of seven at 0.97 or above. Construct coverage
was not the whole of the headroom.

The remaining headroom is not in _which_ ORM constructs a case
exercises but in _how cleanly the transcript states them_. Every
transcript in the repository is a two-party interview in which a single
authoritative expert answers a facilitator in already-modeled prose.
`conference-reviews.transcript.md` says "Every review has exactly one
review score" and "The review score is always one of 1, 2, 3, 4, or 5":
a mandatory constraint and a value constraint, pre-formed, in the
speaker's own words. The largest transcript in the repository runs 130
turns and contains exactly one negation in its entire length. The suite
therefore measures transcription fidelity, and an extractor that
transcribes faithfully has nowhere left to improve.

Real working sessions do not behave this way. Two stakeholders
contradict each other and one of them is right. A term means different
things to different departments. Someone states a rule and revises it
twenty minutes later. A question gets asked, argued, and parked. Modeling
those sessions is a judgment task, and judgment is what the extraction
prompt is actually for -- the prompt already devotes a numbered section
to flagging ambiguity, and nothing in the suite has ever tested it.

This serves **explicit over implicit** as well: barwise already emits an
ambiguity list on every extraction, that list is already part of the
payload the scorer receives, and the scorer already throws it away.
Scoring it makes a shipped capability measurable instead of assumed.

## Should eval transcripts contain unresolved disagreement? (resolved: yes -- scored on the ambiguity list, not on the model)

Yes, and the mechanism already exists in the payload.

The objection to unresolved disagreement is that a rubric asserts a
single right answer, and a genuinely open question has none. That
objection holds only for rubrics that check the model. `ExtractionResponse`
carries an `ambiguities` array alongside the model elements
(`packages/llm/src/ExtractionPrompt.ts:65-79`), and section 7 of the
extraction prompt instructs a review pass that flags each uncertainty
with a description and source references. So an extraction has two
outputs, and the second one is where an unresolved disagreement belongs.

That splits transcript conflict into two scoreable kinds:

- **Resolved conflict.** A stakeholder states a rule, another corrects
  it, and the session settles. The rubric asserts the settled answer
  with the existing model checks. An extraction that models the
  retracted version fails `requires_element` or `forbids_population`
  exactly as it should. This needs no new machinery.
- **Unresolved conflict.** The session ends with the question open. The
  rubric asserts that the extraction _flagged_ it, against the
  ambiguity list. This needs a new check kind.

The new check kind belongs in `@barwise/promptlab`, not
`@barwise/learn`. `learn` grades an `OrmModel` produced by a human
learner; the ambiguity list is a property of an extraction payload,
which `learn` never sees and has no vocabulary for. Widening `GymCheck`
to carry a check that `evaluateCandidate` cannot run would put a
prompt-eval concern in a pedagogy package -- the same coupling the
harness spec rejected when it kept the whole harness out of `learn`.
promptlab defines its own `PromptCheck`, keeps `GymCheck` as a subset of
what a case may declare, and partitions in the scorer.

## Scope

In scope:

- A promptlab-native check vocabulary. When an eval case declares a
  check whose kind is not in the `GymCheck` union, the system shall
  evaluate it in `@barwise/promptlab` against the extraction payload
  and fold its result into the same `rubricPassed`/`rubricTotal`
  totals as the model checks.
- An ambiguity check. When a case declares
  `kind: requires_ambiguity` with a `matches` pattern, the system
  shall pass the check if at least one entry in the payload's
  `ambiguities` array matches, and fail it otherwise.
- An ambiguity-precision guard. When an extraction reports more
  ambiguities than the suite's declared `ambiguityBudget` for a case,
  the system shall apply the declared per-excess penalty, so that
  flagging everything cannot buy a passing score.
- Three new eval cases whose transcripts contain multi-party
  disagreement, at least one mid-session correction, at least one
  overloaded term, and at least one question left explicitly open.
- When the new cases load, the existing seven cases' scores shall be
  byte-identical to their current pinned values, so the suite version
  bump is additive and the score history stays comparable.

Out of scope, deferred and named:

- Rewriting the existing seven transcripts. They keep measuring what
  they measure; re-authoring them would re-baseline every recorded
  score and destroy the only history the suite has.
- Any transcript derived from client material. See Open decisions.
- The DSPy optimizer lane. It consumes this suite and is specified
  separately; this spec is its precondition, not part of it.
- Review-surface and agent-surface cases (harness workstreams 5 and 6).
- Scoring the _quality_ of an ambiguity's prose description. The check
  tests that the fork was noticed, not how well it was written; prose
  quality needs a judge, which the harness rejects on principle.

## Inventory

| Area                                       | Current state                                                  | Verdict   |
| ------------------------------------------ | -------------------------------------------------------------- | --------- |
| `packages/promptlab/src/score/`            | `scoreExtraction` parses the payload, then uses only the model | extend    |
| `packages/promptlab/src/evalcase/types.ts` | `EvalCase.checks` is `readonly GymCheck[]`                     | widen     |
| `packages/promptlab/evals/`                | Seven cases, all single-source interviews                      | add three |
| `packages/promptlab/evals/suite.yaml`      | Weights + declared case list; version 1.1.0                    | bump      |
| `packages/llm/src/ExtractionPrompt.ts`     | Already parses and exposes `ambiguities`                       | untouched |
| `packages/llm/src/prompt/systemPrompt.ts`  | Section 7 already instructs the ambiguity review pass          | untouched |
| `@barwise/learn`                           | `GymCheck`, `CheckResult`, `evaluateCandidate` consumed as-is  | untouched |
| `@barwise/core`                            | Validation and serialization consumed as-is                    | untouched |
| `packages/cli/src/commands/prompt.ts`      | Prints whatever `CaseScore` carries                            | untouched |
| `examples/transcripts/`                    | Longer, but the same single-source interview shape             | untouched |

`examples/transcripts/` looks like the obvious source for harder cases
and is not one. The files are longer, not more contested: the largest
is 130 turns of Facilitator and Domain Architect with a single "No,
optional." Their value here is as a style reference for the interview
format, not as material to lift.

## Target architecture

```
@barwise/learn                       (unchanged)
  GymCheck        must_validate | requires_verbalization
                  | requires_element | forbids_population
  evaluateCandidate(model, exercise, reference) -> GymReport
      ^ grades an OrmModel; knows nothing about extraction payloads

@barwise/promptlab                   (gains a second check family)
  evalcase/
    PromptCheck   requires_ambiguity (promptlab-native)
    EvalCase.checks: readonly (GymCheck | PromptCheck)[]
  score/
    scoreExtraction(payload, case, weights) -> CaseScore
      parse payload -> ExtractionResponse
        |-- model half     -> enforceConformance -> parseDraftModel
        |                     -> evaluateCandidate(GymCheck subset)
        |-- payload half   -> runPromptChecks(PromptCheck subset,
        |                        response.ambiguities)
        `-- fold: rubricPassed/rubricTotal over BOTH halves,
                  minus conformance/validation/ambiguity-excess penalties
```

The partition is the whole design: one payload, two graders, one
fraction. `evaluateCandidate` keeps its exact current contract, and the
`CaseScore` shape gains nothing but wider `results`.

```ts
/** promptlab-native checks, evaluated against the extraction payload. */
export type PromptCheck = {
  readonly kind: "requires_ambiguity";
  /** Case-insensitive substrings; an ambiguity matches if it contains all. */
  readonly matches: readonly string[];
  readonly hint?: string;
};

/** Widened so a result can carry either family's kind. */
export interface PromptCheckResult {
  readonly kind: GymCheck["kind"] | PromptCheck["kind"];
  readonly passed: boolean;
  readonly message: string;
  readonly hint?: string;
}
```

`CaseScore.results` becomes `readonly PromptCheckResult[]`. Every
`CheckResult` from `@barwise/learn` already satisfies that shape, so
existing results flow through unchanged and the delta reports keep
working.

The suite manifest gains one weight, parsed alongside the existing
three in `loadSuite.ts:136-138`:

```yaml
version: 2.0.0
weights:
  conformanceCorrection: 0.02
  validationError: 0.1
  validationWarning: 0.05
  ambiguityExcess: 0.02 # per ambiguity beyond a case's budget
cases:
  - order-management.eval.yaml # ... the existing seven, unchanged
  - vendor-onboarding.eval.yaml # new
```

Each case file gains an optional `ambiguityBudget`, read by the same
loader that reads `checks`. Omitted means unbounded, which is what
every existing case means today, so the seven load unchanged:

```yaml
id: vendor-onboarding
transcript: vendor-onboarding.transcript.md
reference: vendor-onboarding.reference.orm.yaml
ambiguityBudget: 4
checks:
  - kind: must_validate
  - kind: requires_ambiguity
    matches: ["tier"]
    hint: Ops and Finance used "tier" for two different things; parked.
```

## Transcript authoring rules

The three new transcripts are authored, not lifted, because no existing
transcript has the property being tested. Each shall contain:

- **At least three speakers**, of whom at least two hold competing
  views grounded in different jobs -- an operations lead who knows what
  the system does and a compliance or finance lead who knows what
  policy requires. Disagreement between two people with different
  incentives is the realistic kind; disagreement between a facilitator
  and an expert is just a bad interview.
- **At least one resolved conflict**: a rule asserted, contested, and
  settled in-session, where the settled answer is what the rubric
  asserts and the asserted-then-retracted version is a plausible wrong
  extraction.
- **At least one mid-session correction** by a single speaker ("earlier
  I said every shipment has one carrier -- that is wrong for
  multi-leg").
- **At least one overloaded term** used in two senses by two speakers,
  where correct modeling separates them. This is the most common real
  failure and the least represented in the current suite: a single noun
  carrying a permission level in one department and a transaction scope
  in another, with nothing in the transcript announcing the collision.
- **At least one question left open**, argued and explicitly parked
  ("we'll take that to the steering group"), which the rubric asserts
  via `requires_ambiguity`.
- **No client-identifying material.** Domains are invented.

Realism has a floor as well as a ceiling: a transcript may be messy but
must remain _decidable_. Every model check a rubric asserts must be
supported by an unambiguous statement somewhere in the transcript, and
every conflict must be either explicitly settled or explicitly parked.
A conflict that is neither is an authoring bug, not a hard case -- it
makes the rubric a coin flip and the metric noise.

## Alternatives considered

- **Widen `GymCheck` in `@barwise/learn`.** One type, one runner, no
  partition. Rejected on orthogonality: `evaluateCandidate` takes an
  `OrmModel` and could never run the check, so `learn` would export
  vocabulary it cannot evaluate, and a pedagogy package would carry an
  extraction-payload concern. The harness spec already refused this
  coupling once.
- **Score ambiguities by count alone** ("a good extraction flags
  between two and five things"). Rejected: it rewards volume over
  aim, and a prompt can win it by padding. Matching a declared fork is
  what distinguishes noticing the right thing from noticing anything.
- **Put the disagreement in the rubric instead of the transcript** --
  keep clean transcripts and assert harder constraints. Rejected: it
  raises construct difficulty, which hardening v1 already did and which
  saturated again. The untested capability is judgment under conflicting
  testimony, and only the transcript can create that.
- **Lift `examples/transcripts/` wholesale.** Rejected on the evidence:
  they are single-source interviews, so they add length and cost
  without adding the property under test. Three of them remain useful as
  domain and style references.
- **Rewrite the existing seven for realism.** Rejected: it re-baselines
  every score in a history file that is the project's only longitudinal
  record, and it conflates two changes in one diff. Additive cases keep
  the old scores comparable.
- **An LLM judge for ambiguity quality.** Rejected on the harness's
  standing principle: a score that moves when the judge moves is the
  problem this whole lane exists to eliminate.

## Workstreams (each independently shippable)

### 1. The `PromptCheck` seam in `@barwise/promptlab`

Add `PromptCheck`, `PromptCheckResult`, and `runPromptChecks`; widen
`EvalCase.checks` and `CaseScore.results`; partition in
`scoreExtraction`; add `ambiguityExcess` to `SuiteWeights` with a
default of 0 when the manifest omits it. No new eval cases, so every
existing pinned score in `tests/scoreExtraction.test.ts` stays
byte-identical -- which is the acceptance criterion. Unit tests cover
the matcher, the budget penalty, and a case mixing both check families.

Smallest blast radius: code only, one package, no data change, no
suite version bump.

### 2. Three realistic transcripts and their rubrics

The data workstream: three `.transcript.md` files meeting the authoring
rules, their `.eval.yaml` rubrics mixing model checks with
`requires_ambiguity`, and generated `.reference.orm.yaml` files
(generated by running a recorded payload through
`parseExtractionFromJson`, per the package's standing rule that
references are never hand-written). Suite bumps to 2.0.0 and declares
ten cases.

Needs an extraction payload per case to generate the reference and pin
the answer key, which needs either a key or a session-model extraction
recorded by hand. Both paths are keyless-compatible: the payloads are
recorded artifacts, and the scorer that grades them makes no API call.

### 3. Re-baseline and record

Run `barwise prompt eval` over the ten-case suite for the default
artifact and both committed variants, at repeat >= 3, and write the
first entries `evals/history.jsonl` has ever carried. This is the
workstream that needs a key, and it is deliberately last: everything
before it is verifiable without one.

## API and migration impact

- `@barwise/promptlab` public API widens: `EvalCase.checks` and
  `CaseScore.results` accept more kinds. Both are widenings, so every
  existing caller keeps compiling.
- `@barwise/cli` needs no change: `barwise prompt score` and
  `prompt eval` print whatever `CaseScore` carries, and a wider `kind`
  union is transparent to the formatter. Verify the delta-report
  formatting still reads well with a non-gym kind in the list.
- `@barwise/learn`, `@barwise/llm`, and `@barwise/core` are untouched.
  Nothing downstream of promptlab exists except the CLI.
- The suite version moves 1.1.0 -> 2.0.0. History rows carry the suite
  version already, so pre-bump and post-bump means are distinguishable
  in the record; comparing across the bump is invalid and the delta
  report should say so.

## Open decisions (for review)

- **Client-derived material as policy.** The one client-derived
  transcript in `examples/` is excluded from this work by maintainer
  instruction. The remaining `examples/` transcripts are invented
  domains carrying no client identity, so they stay usable as style
  references. Recommend promoting the exclusion to a stated rule --
  eval content is checked in, published in the npm package, and read by
  anyone who clones the repo, so "no client-derived material in
  `evals/`" should be written down rather than remembered, and the
  existing client-derived example should be reviewed on the same
  standard. Alternative: handle it case by case and leave `examples/`
  as it stands.
- **How many new cases, and which domains.** Three is the recommendation
  -- enough to separate the three conflict kinds, few enough to author
  carefully. Domains are open; the constraint is that they be invented
  and mutually distinct. Fewer cases means faster authoring and a
  weaker signal; more means real authoring cost per case.
- **Ambiguity budget per case, or one suite-wide default.** Per-case is
  recommended (a genuinely messy transcript should tolerate more flags
  than a tidy one), at the cost of another authored number that can be
  tuned to flatter a result. Suite-wide is simpler and harder to game.
- **Whether `requires_ambiguity` matching is substring or structured.**
  Substring over the description is recommended for the first
  implementation: it is transparent to an author and needs no schema
  change. It is also brittle to rephrasing, which is the same
  fragility `requires_verbalization` carries and which the gym spec
  already advises using sparingly. A structured alternative -- matching
  on the ambiguity's source references rather than its prose -- is more
  robust and needs the payload's reference data to be reliable, which
  is unverified.
- **Whether the suite bump is 2.0.0 or 1.2.0.** Recommend 2.0.0: the
  check vocabulary widened, so a consumer pinned to the old shape is
  not guaranteed to load a new case file.

## Risks and testing

- **Risk: authored disagreement is unfair rather than hard.** A
  transcript where two speakers conflict and neither is marked correct
  makes its rubric arbitrary. Guard: the decidability floor in the
  authoring rules, plus a review pass in which someone other than the
  author models each transcript from the rubric alone and must reach
  the asserted answer.
- **Risk: the ambiguity check rewards noise.** A prompt that emits
  twenty ambiguities passes every `requires_ambiguity` check by
  coincidence. Guard: the `ambiguityBudget` penalty, and rubrics that
  match a specific fork rather than a topic.
- **Risk: substring matching overfits to one phrasing.** An optimizer
  can learn to emit the rubric's exact words. Guard: use short,
  content-bearing match terms (the overloaded noun, not a sentence),
  keep `requires_ambiguity` to one or two checks per case, and treat a
  suspicious jump in ambiguity scores as an overfit signal in the delta
  report.
- **Risk: the additive claim is wrong and existing scores move.**
  Guard: workstream 1 ships with no data change and the pinned scores
  in `tests/scoreExtraction.test.ts` as its acceptance criterion; any
  movement there fails the PR.
- **Risk: harder cases drop scores enough to look like a regression.**
  Expected and correct -- a 0.948 that falls to 0.80 on a ten-case
  suite is the metric working. Guard: the suite version in every
  history row, and a delta report that refuses to compare across a
  version bump.
- **Testing:** promptlab unit tests stay entirely on canned payloads;
  the new matcher and budget logic are pure functions and get direct
  tests. Each new case ships a recorded payload in
  `tests/fixtures/responses/` that passes its full rubric, per the
  package's answer-key invariant. No live call enters CI.

## Implementation notes

### Workstream 1 (2026-08-20)

Shipped as specified, with two additions the brief did not name and one
correction to what "additive" turned out to mean.

- **`CaseScore` gained `ambiguitiesReported` and `ambiguityExcess`.**
  The brief widened only `results`. Folding the excess penalty into
  `score` alone would have made it invisible in a delta report, which
  is not how the other penalties behave -- `conformanceCorrections` and
  `validationErrors` are both surfaced as counts beside the score. The
  two new counts follow that precedent.
- **Results are reassembled into authored order.** The partition runs
  two graders, so their results arrive grouped by family rather than in
  the order the case author wrote them. `CaseScore.results` is
  documented "in authored order (for delta reports)", so
  `orderAsAuthored` walks the declarations and shifts from the matching
  queue. Without it, a mixed rubric's delta report would read in an
  order matching nothing in the case file.
- **Two existing tests changed, and no pinned score did.** The
  acceptance criterion was that every pinned per-case score stay
  byte-identical, and all seven did. What changed was the shape of the
  weights object: `loadSuite.test.ts` asserts the parsed weights with
  `toEqual` and now sees `ambiguityExcess: 0`, and one hand-built
  weights literal in `scoreExtraction.test.ts` needed the new field or
  the arithmetic produced `NaN`. Both are consequences of adding a
  declared weight, the same edit `validationWarning` required when it
  was added.
- **`isPromptCheck` is a runtime export from `evalcase/types.ts`.** The
  file otherwise holds only types. The discriminator belongs beside the
  union it narrows, and moving it would separate the two.

The `NaN` above is worth remembering: `SuiteWeights` is a required-field
interface, so a programmatic caller that builds one by hand and misses a
weight gets a silent `NaN` score rather than a type error, since the
tests construct weights literals outside the loader's validation. The
loader itself defaults every optional weight, so only hand-built objects
are exposed.

## Non-goals

- No change to the scorer's determinism contract: same payload, case,
  and weights still give a byte-identical `CaseScore`.
- No change to `@barwise/learn`, the gym, or any learner-facing
  surface.
- No new CLI commands or flags.
- No judge, no LLM in the scoring path, no network in any test.
- No rewrite of the existing seven cases or their recorded scores.
