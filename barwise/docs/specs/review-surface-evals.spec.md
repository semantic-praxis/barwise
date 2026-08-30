# Review-surface evals: an artifact-driven review prompt scored on seeded defects

Status: Accepted (all decisions resolved 2026-08-24). Workstream 1
(the artifact seam in `reviewModel` and response validation)
implemented 2026-08-24; workstreams 2-4 open.
Workstream map: WS1 barwise-847 (closed; verified 2026-08-30 -- the
review options carry a `PromptArtifact` override, matching
`ProcessorOptions.artifact`). WS2 barwise-848 (open). WS3 and WS4 both
ride barwise-849 (open), which covers authoring the seed corpus,
baselining it and deciding whether to optimise.
Created: 2026-08-24
Last-updated: 2026-08-24
Tracking: barwise-847, barwise-848, barwise-849. Grounds workstream 5
of `docs/specs/prompt-optimization-harness.spec.md`, carried as
"provisional: not yet grounded" since 2026-08-08. Sibling:
`docs/specs/eval-split-stratification.spec.md`.

## Principle

Explicit over implicit, and a seam built for two that serves one.
`PromptSurface` is declared as `"extraction" | "review"`, `loadArtifact`
accepts both, and `resolveArtifact` is generic over the pair -- but
every artifact in `packages/llm/prompts/` declares `surface: extraction`
and `reviewModel` never calls the resolver. Its prompt is a string
literal returned by `buildReviewSystemPrompt()`. So the review surface
cannot be varied per model, cannot be versioned, cannot be hashed for
provenance, and cannot be evaluated. The type says two surfaces are
supported; one is.

That is the same shape as barwise-811 (`buildCodeExtractionPrompt` with
no call site) and it is the more expensive instance, because `review` is
the one LLM capability reachable from all three surfaces -- CLI, MCP,
and VS Code all call `reviewModel`. Everything the extraction lane
learned about prompt quality this month is unavailable to the surface
with the widest reach.

Composability supplies the fix. The extraction lane already has the
pieces: an artifact registry keyed on provider and model, a
deterministic scorer, a suite runner that reports dispersion, and a
payload-side check family (`PromptCheck`) that grades an array in a
response against declared expectations with a budget penalty for
volume. A review eval is that same shape pointed at a different array.
Nothing new is invented except the fixtures.

## Can the review surface be scored deterministically? (resolved: yes -- seeded defects, with a clean control)

Yes. The obstacle looks fatal at first: review output is advice, advice
is prose, and grading prose needs a judge -- which the harness rejects on
principle, because a score that moves when the judge moves is the
problem the whole lane exists to eliminate.

The obstacle dissolves once the question changes from _was this good
advice_ to _did it find the thing that is wrong_. Plant a known defect
in a fixture model and the correct answer is not a matter of opinion:
either a suggestion names that element in that category or none does.
`ReviewSuggestion` already carries `element` and `category`
(`reviewModel.ts:17-23`), so the payload has the two fields a match
needs, and the categories are already an enum of five.

Recall alone is winnable by volume -- a reviewer that flags every
element in every category finds every planted defect. The extraction
lane hit exactly this with `requires_ambiguity` and answered it with
`ambiguityBudget`, a per-case declared allowance with a per-excess
penalty. The same answer works here, and there is a second measure that
is cheaper still: **run the reviewer on the unmutated model**. Every
suggestion it makes there is a false positive by construction, needs no
authoring at all, and measures precision directly.

That control is an ordinary case with an empty defect list, not a
second mode, provided recall is defined as 1.0 when a case declares no
defects. Nothing to find, nothing missed -- so the control's score is
1.0 minus whatever it flagged beyond its budget, and it runs through
the same fold as everything else with no branch anywhere. Defining that
edge away in the scorer is cheaper than every consumer discovering it.

The residue this does not measure is real and should be named rather
than hidden: it says nothing about whether a suggestion's _rationale_ is
useful, well-aimed, or worth a reader's time. A prompt could pass every
case here and give advice nobody wants. That is the same trade the
extraction metric makes -- it grades structure, not prose -- and it is
the price of a number that does not move when a judge does.

## Scope

In scope:

- When `reviewModel` builds a system prompt, the system shall resolve a
  `surface: "review"` artifact from `builtinArtifacts` using the
  client's declared provider and model, falling back to the current
  literal text.
- When no review artifact matches, the system shall render a prompt
  byte-identical to what `buildReviewSystemPrompt()` returns today.
- When `parseReviewResponse` receives a suggestion whose `category` or
  `severity` is outside its declared enum, the system shall reject it
  rather than casting it into the typed result.
- When a review eval case declares a planted defect with an element and
  a category, the system shall count it found if at least one suggestion
  in that category names the element case-insensitively, either in its
  `element` field or, when that field is absent, in its `description`.
- When a suggestion names the declared element in neither field, the
  system shall not count it as finding that defect, whatever its
  category.
- When a payload reports more suggestions than a case's planted defects
  plus its declared budget, the system shall charge the declared
  per-excess weight.
- When a case declares no defects, the system shall treat its recall as
  1.0 and score it on the excess term alone, so a clean control is an
  ordinary case with an empty defect list rather than a second mode.
- When review cases are loaded, they shall come from a manifest separate
  from the extraction suite, carrying its own version and declaring
  `surface: review`.
- When `barwise prompt eval` is given a manifest, it shall read that
  manifest's declared surface to choose the scorer and the report shape,
  rather than taking a surface from a flag.

Out of scope, deferred and named:

- Optimizing the review prompt. This spec delivers the metric and the
  seam. A DSPy review program is not authorized here at all: workstream
  4 measures a baseline and reports whether there is headroom, and
  building the program is a separate decision made on that evidence.
- Grading the prose quality of a suggestion's `description` or
  `rationale`. Needs a judge; refused on the harness's standing
  principle.
- The `focus` parameter's behaviour. `serializeModelForReview` filters
  by substring on element names; whether that is the right filter is a
  separate question and no case here declares a focus.
- Agent-surface evals (harness workstream 6).
- Extraction-suite composition, specified in
  `docs/specs/eval-split-stratification.spec.md`.

## Inventory

| Area                                          | Current state                                                    | Verdict           |
| --------------------------------------------- | ---------------------------------------------------------------- | ----------------- |
| `packages/llm/src/review/reviewModel.ts`      | `buildReviewSystemPrompt()` returns a literal; no resolver call  | wire the seam     |
| `packages/llm/src/review/reviewModel.ts`      | `parseReviewResponse` casts `suggestions` without validating     | validate          |
| `packages/llm/src/prompt/artifacts/`          | Registry generic over both surfaces; `loadArtifact` accepts both | untouched         |
| `packages/llm/prompts/`                       | Two artifacts, both `surface: extraction`                        | add review seed   |
| `packages/llm/src/TranscriptProcessor.ts:116` | The resolution pattern to copy                                   | untouched         |
| `packages/promptlab/src/evalcase/`            | `EvalCase`, `PromptCheck`, `loadSuite`                           | add review kind   |
| `packages/promptlab/src/score/`               | `scoreExtraction`; budget-and-excess precedent                   | add `scoreReview` |
| `packages/promptlab/src/run/runSuite.ts`      | Cases x repeat through an `LlmClient`                            | generalize        |
| `packages/promptlab/evals/`                   | Ten extraction cases and their manifest                          | add sibling dir   |
| `packages/cli/src/commands/review.ts:67`      | Calls `reviewModel(model, client, {focus})`                      | untouched         |
| `packages/mcp/src/tools/review.ts:75`         | Same call                                                        | untouched         |
| `packages/vscode/.../ToolRegistration.ts:248` | Same call                                                        | untouched         |
| `@barwise/core` counterexample generator      | Derives forbidden populations for `forbids_population`           | untouched         |

The three call sites are untouched because the client already carries
the identity the resolver needs. `LlmClient` declares `provider` and
`model` precisely so a variant can be chosen before the call, which is
the documented reason those fields exist, and `TranscriptProcessor`
already resolves from the client rather than from its caller. Review can
do the same thing in the same place, so no caller learns anything new.
That claim is the one most worth re-checking before implementing: it is
an Inventory row promising no work, and those are the rows nobody
re-verifies.

`@barwise/core` has no model-mutation machinery -- `counterexample/` and
`diff/` are the closest things and neither seeds defects. The defective
fixtures are therefore authored, not generated; see Alternatives.

## Target architecture

```
@barwise/llm
  review/reviewModel.ts
    reviewModel(model, client, options)
      systemPrompt = options.artifact
                  ?? resolveArtifact(builtinArtifacts,
                       { surface: "review",
                         provider: client.provider,
                         model: client.model })
                  ?? REVIEW_DEFAULT           <- today's literal, unchanged
      parseReviewResponse                     <- now validates the two enums

@barwise/promptlab
  evalcase/
    ReviewEvalCase   { id, model, suggestionBudget?, defects[] }
    PlantedDefect    { element, category, hint? }
  score/
    scoreReview(payload, case, weights) -> ReviewCaseScore
      a defect is found when some suggestion in its category names the
      element case-insensitively, in `element` or -- when that field is
      absent -- in `description`; naming it nowhere matches nothing
      recall      = defects ? found / defects : 1.0    <- nothing to find, nothing missed
      excess      = max(0, suggestions - defects - budget)
      score       = recall - suggestionExcess * excess
      clamped at 0
  run/
    runSuite  generalized over surface; same repeat, same dispersion fold

evals/review/
  suite.yaml                          surface: review, own version, own weights
  customer-order.clean.orm.yaml       <- the shared base, and the control
  customer-order.control.eval.yaml    <- defects: []
  customer-order.naming.orm.yaml      <- base + one naming defect
  customer-order.naming.eval.yaml     ... and one pair per category, five in all
```

The pairing is the design. A defective fixture and its clean twin differ
only by the planted defects, so the control measures the reviewer's
false-positive rate against the same domain, the same size, and the same
serialization -- and a difference between the two cases cannot be
attributed to anything else.

## Alternatives considered

- **Generate defective fixtures by mechanical mutation** of a clean
  model (strip a definition, drop a uniqueness constraint, rename to
  `Data`). Attractive: the correct answer is derived rather than
  authored, so it cannot drift from the fixture. Rejected for now on
  coverage and cost -- four of the five categories mechanise cleanly and
  `normalization` does not (a missing subtype or a redundant fact type
  is a judgment about the domain, not an edit), so a new subsystem in
  `core` or `promptlab` would buy four-fifths of the corpus. Authored
  fixtures cover all five today. Revisit if the corpus grows past the
  point where hand-authoring is the bottleneck.
- **Score review with an LLM judge.** Rejected on the harness's
  standing principle, restated here because review is where the
  temptation is strongest: the output is prose, and a judge is the
  obvious tool. A judge that drifts between model releases makes every
  historical score unreadable, which is precisely the failure the
  deterministic scorer exists to prevent.
- **Reuse `EvalCase` with an optional `model` instead of `transcript`.**
  One type, one loader. Rejected on orthogonality: the two cases share
  no field except `id`, their scorers share no code, and their rubrics
  have no common vocabulary. A union whose arms overlap in one field is
  two types with a shared name, and every consumer would branch on which
  arm it got.
- **Put review cases in the extraction manifest with a `surface:`
  field.** Rejected: one `version:` cannot describe two metrics, and the
  version is the field a reader uses to decide whether two history rows
  compare. A review case added to the extraction suite would bump a
  version that says nothing about extraction.
- **Match a defect on element name alone, ignoring category.** Simpler
  and more forgiving. Rejected: it makes the five categories decorative,
  and a reviewer that flags `Customer` for naming when its defect is a
  missing definition would score as correct.
- **Skip the seam and evaluate the literal prompt.** Rejected: without
  the artifact seam there is nowhere to put a candidate, so a measured
  improvement could be recorded and never shipped. The seam is what
  makes the metric actionable rather than merely informative.

## Workstreams (each independently shippable)

### 1. Wire the artifact seam into `reviewModel` (code only)

Resolve a `surface: "review"` artifact from the client's declared
identity, defaulting to today's literal; validate `category` and
`severity` in `parseReviewResponse`. No behaviour change, because no
review artifact exists yet.

The acceptance criterion is a golden test asserting the default rendered
prompt is byte-identical to the current literal -- the same guard
workstream 1 of the harness spec used for extraction. The enum
validation is separable in principle and belongs here in practice: the
metric in workstream 2 matches on `category`, so an unvalidated category
is load-bearing the moment scoring exists, and a model answering
`category: "style"` would silently match nothing.

Smallest blast radius: one package, no data, no manifest, nothing
downstream recompiles.

### 2. `ReviewEvalCase` and `scoreReview` in `@barwise/promptlab` (code only)

Add the case type, the loader, and the scorer, with no fixtures beyond
what the unit tests build inline. Pure functions over canned payloads,
so the whole workstream is offline.

Depends on nothing in workstream 1 -- the scorer grades a payload and
does not care how the prompt was built -- so the two can land in either
order. Named second because the seam is the cheaper of the two to
review.

### 3. The seed corpus: paired fixtures and their rubrics (data; provisional: not yet grounded)

Two domains. Each gets one clean base model, five defective twins (one
per review category, each the base with a single edit), and one control
case scoring the clean base with an empty defect list -- twelve cases in
all. Four of the five categories are a mechanical edit to the base;
`normalization` is the one that needs a modelling judgment, since a
missing subtype or a redundant fact type is a claim about the domain
rather than a deletion.

Provisional because the number of planted defects a case can carry
before they interfere is unknown until the first pair runs -- a model
with a stripped definition and a dropped constraint on the same element
may draw one suggestion that names both, and whether that counts as one
find or two is a question the fixtures will answer rather than the
design. One defect per twin is the shape chosen partly to keep that
question small.

### 4. Baseline, then decide whether to optimize (needs a key)

Run the review suite for each supported provider/model pair at
repeat >= 5, record the baseline, and read the recall and excess figures
before writing any optimizer program. If the shipped literal already
finds nearly every planted defect, this lane is a regression detector
and not an optimization target, and saying so is a result. A DSPy review
program is authorized by this workstream's evidence, not by this spec.

## API and migration impact

- `@barwise/llm`: `ReviewOptions` gains an optional `artifact`, matching
  `processTranscript`'s shape. An addition; callers keep compiling.
- `reviewModel`'s behaviour changes for all three surfaces at once (CLI,
  MCP, VS Code) the moment a review artifact is added to
  `prompts/`. Until then the resolution is a no-op that returns the
  default. The capability matrix in the root `CLAUDE.md` marks `review`
  as reaching all three, so that row is the blast radius, and it needs
  no edit -- the reach does not change, only what it sends.
- `@barwise/promptlab` public API widens with `ReviewEvalCase`,
  `PlantedDefect`, `ReviewCaseScore`, and `scoreReview`. All additions.
- `packages/llm/prompts/` gains review artifacts, which are compiled
  into `builtins.generated.ts` by `npm run regen:builtins`. The drift
  test guards the regeneration.
- `@barwise/cli`: `barwise prompt eval` learns to read the manifest's
  declared surface and dispatch to the matching scorer and report shape.
  No new flag and no new subcommand; a manifest with no declared surface
  means extraction, which is what every existing manifest means today.
- `@barwise/core` and `@barwise/learn` are untouched.

## Decisions (resolved 2026-08-24)

- **One clean base model per domain, one defective twin per category:**
  five defective fixtures and one control per domain, over two domains.
  The authoring cost is dominated by the clean base, which is shared,
  and each twin is that base with a single edit -- so this costs barely
  more than one defective model carrying all five categories, and it
  yields recall per category. That is the number that says what to fix:
  weak `normalization` recall and weak `definition` recall call for
  different prompt changes, and a blended figure cannot tell them apart.
- **Excess is charged, not reported alongside.** One scalar, matching
  `ambiguityExcess`. Reporting recall and suggestion count as a pair is
  more informative and hands every consumer the collapse decision, which
  is the shape `eval-split-stratification.spec.md` rejects for the same
  reason on the extraction score.
- **The manifest declares its own surface and `barwise prompt eval`
  reads it** -- no `--suite` flag and no second subcommand. A flag and a
  manifest can disagree about what a suite is; a manifest alone cannot.
  This also answers the objection against a flag, that one command would
  emit two JSON shapes: the shape becomes a property of the file the
  operator named rather than of a flag they might forget.
- **No prompt caching on the review call, for now.** Measured before
  deciding: the review system prompt is 2,609 characters, about 650
  tokens, and Haiku 4.5's minimum cacheable prefix is 4,096. A
  breakpoint there buys exactly nothing on the model the suite runs
  against; it would help only on a model with a lower minimum, such as
  Opus 5 at 512. Revisit if the review prompt grows past 4,096 tokens.
- **A defect is matched on `element` when the suggestion carries one,
  and otherwise on the defect's element name appearing in the
  suggestion's `description`. A suggestion that names the element
  nowhere matches nothing.** Strict field-only matching would score a
  model that names the element in prose as having missed the defect,
  which measures formatting rather than review quality; matching on
  category alone would let a vague summary claim every find. The line
  belongs where the element is actually named, in whichever field.

The one question these leave open belongs to workstream 3 and cannot be
answered from the design: how many planted defects a single fixture can
carry before they interfere. Until it is answered, plant at most one
defect per element.

## Risks and testing

- **Risk: the planted defects are the ones this prompt already finds.**
  Authoring fixtures against a prompt whose output you have read
  produces a corpus it passes. Guard: author each defective fixture
  from the review-category definitions in the prompt text, not from
  observed output, and treat a first baseline near 100% recall as a
  sign the corpus is too easy rather than as a result.
- **Risk: element-name matching is brittle.** A suggestion naming
  `Customer entity` rather than `Customer` fails a strict match.
  Guard: case-insensitive substring containment in the declared
  direction (the suggestion's `element` contains the declared name), and
  a unit test pinning both the match and a near-miss that must not
  match.
- **Risk: two planted defects on one element draw one suggestion.**
  Guard: workstream 3's grounding question, and until it is answered,
  plant at most one defect per element.
- **Risk: the clean control is not clean.** A fixture with a genuine
  modelling weakness makes every suggestion about it a false positive by
  fiat. Guard: the control must pass `barwise validate` with no
  diagnostics and be read through by someone other than its author.
- **Risk: wiring the seam changes behaviour before any artifact exists.**
  Guard: the byte-identity golden test, which is the acceptance
  criterion for workstream 1 and fails on any drift in the default.
- **Testing:** workstreams 1 through 3 are entirely offline. The scorer
  is pure and gets direct tests over hand-built payloads. Review calls
  in tests use mock clients with canned suggestion arrays, per the `llm`
  package convention. No live call enters CI.

## Non-goals

- No LLM in the scoring path, no judge, no network in any test.
- No `cacheSystemPrompt` on the review call. Decided on measurement,
  not deferred: at ~650 tokens the prompt is far below Haiku 4.5's
  4,096-token minimum cacheable prefix, so a breakpoint would be inert
  on the model the suite runs against.
- No change to `ReviewSuggestion`'s five categories or three severities.
- No change to `serializeModelForReview` or to how `focus` filters.
- No change to `@barwise/core` or `@barwise/learn`.
- No optimizer program until workstream 4's baseline argues for one.
- No change to the extraction suite, its manifest, or its scorer.
