# Review-surface evals: an artifact-driven review prompt scored on seeded defects

Status: Draft for review (design only -- no implementation in this PR)
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
  in the payload names that element in that category, case-insensitively.
- When a payload reports more suggestions than a case's planted defects
  plus its declared budget, the system shall charge the declared
  per-excess weight.
- When a case declares no defects, the system shall treat its recall as
  1.0 and score it on the excess term alone, so a clean control is an
  ordinary case with an empty defect list rather than a second mode.
- When review cases are loaded, they shall come from a manifest separate
  from the extraction suite, carrying its own version.

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
      found       = defects matched by (element, category), case-insensitive
      recall      = defects ? found / defects : 1.0    <- nothing to find, nothing missed
      excess      = max(0, suggestions - defects - budget)
      score       = recall - suggestionExcess * excess
      clamped at 0
  run/
    runSuite  generalized over surface; same repeat, same dispersion fold

evals/review/
  suite.yaml                    own version, own weights
  customer-order.clean.orm.yaml       <- the control: defects: []
  customer-order.defects.orm.yaml     <- same model, defects planted
  customer-order-definitions.eval.yaml
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

Author clean and defective model pairs covering all five review
categories, with a control case per pair. How many pairs, and whether
one model carries all five categories or one each, is an Open decision.

Provisional because the number of planted defects a case can carry
before they interfere is unknown until the first pair runs -- a model
with a stripped definition and a dropped constraint on the same element
may draw one suggestion that names both, and whether that counts as one
find or two is a question the fixtures will answer rather than the
design.

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
- `@barwise/cli` gains nothing required. `barwise prompt eval` selecting
  a review suite is desirable and is an Open decision, not a
  requirement.
- `@barwise/core` and `@barwise/learn` are untouched.

## Open decisions (for review)

- **How the corpus is shaped.** Recommend one clean base model per
  domain with a separate defective twin per category -- five defective
  fixtures and one control per domain -- so a recall figure can be read
  per category. The alternative, one defective model carrying all five,
  is a fifth of the authoring and yields a single blended recall number
  that cannot say which category the prompt is weak in. Recommend the
  former for two domains, which is ten defective fixtures plus two
  controls.
- **Whether excess is charged against a budget or reported alongside.**
  Recommend charging it, matching `ambiguityExcess`, so the search has
  one scalar to optimize. The alternative -- report recall and
  suggestion count as a pair and never combine them -- is more
  informative and hands every consumer the collapse decision, which is
  the shape `eval-split-stratification.spec.md` rejects for the
  extraction score.
- **Whether `barwise prompt eval` grows a `--suite` flag** to select the
  review manifest, or the review suite gets its own subcommand.
  Recommend the flag: the run mechanics, dispersion reporting, and
  history format are identical, and a second subcommand would duplicate
  all three. Cost: `prompt eval` grows a mode, and its output shape
  differs per mode.
- **Whether the review call should request prompt caching.** The
  extraction path sets `cacheSystemPrompt` and review does not. Once the
  review prompt is artifact-driven it is stable across calls, and an
  eval sweep makes many, so the break-even is comfortably cleared.
  Recommend enabling it in workstream 4 rather than workstream 1, so the
  golden byte-identity test in workstream 1 is not entangled with a
  request-shape change. Named because the Haiku 4.5 minimum cacheable
  length is 4,096 tokens and the review prompt is well under it, so this
  may buy nothing on the model the suite runs against -- measure before
  claiming it.
- **Whether a defect may be matched by a suggestion with no `element`.**
  `element` is optional in the schema, so a model-wide suggestion
  carries none. Recommend no: an unaddressed suggestion cannot be shown
  to have found a specific planted defect, and counting it would let a
  vague summary claim every find.

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
- No change to `ReviewSuggestion`'s five categories or three severities.
- No change to `serializeModelForReview` or to how `focus` filters.
- No change to `@barwise/core` or `@barwise/learn`.
- No optimizer program until workstream 4's baseline argues for one.
- No change to the extraction suite, its manifest, or its scorer.
