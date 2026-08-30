# Licensed names: stop grading which of a domain's own words the model picked

Status: Accepted; workstreams 1 and 2 implemented (see Implementation
notes). Workstream 3 stays provisional: measure alias compliance
against the now-honest metric before editing the prompt.
Workstream map: WS1 and WS2 shipped under barwise-852 (closed) --
verified 2026-08-30 by the artifacts, `NameLicence` threaded through the
resolver in `packages/learn/src/evaluate/populationMapping.ts` and the
licence declared in `packages/promptlab/evals/university-enrollment.eval.yaml`.
WS3 is provisional and deliberately has no issue until the measurement
it waits on exists.
Created: 2026-08-26
Last-updated: 2026-08-27
Tracking: barwise-852. Evidence:
`docs/prompt-eval-2.0.0-haiku45-2026-08-26.md`. Sibling:
`docs/specs/eval-split-stratification.spec.md`, whose workstream 3 is
sized against dispersion this change corrects.

## Principle

Determinism in the core, and the metric that measures it. The eval
suite is the shared quantity every optimization lane composes against,
and on the recorded 2.0.0 baseline it charged 0.85 for a synonym while
letting a real structural difference pass unnoticed.

`university-enrollment` scored 0.154 on three of five samples and
exactly 1.000 on the other two. The two retained payloads differ, for
every check that failed, in one thing: the collapsed run named the
entity `Offering` and the surviving run named it `CourseOffering`. The
collapsed run carries `Offering is of Course`, `Offering is in
Semester`, `Offering is taught by Instructor`, each with the uniqueness
and mandatory constraints the two `forbids_population` checks guard, and
`Student enrolls in Offering`. Nothing the rubric asks about is missing.

Worse, the metric contradicts the prompt it grades.
`packages/llm/src/prompt/systemPrompt.ts:136` instructs: "if
stakeholders use different terms for what appears to be the same
concept ... **pick the most common term as the name** and list the
other(s) in the aliases array." In this transcript the Registrar says
bare "offering" nine times and "course offering" three -- including the
identification line the model cited for its reference mode. The
collapsed run obeyed that rule and was charged 0.85 for obeying.

And the case does not notice what it should. The run that scored 1.000
objectifies `Enrollment` and hangs `Enrollment has Grade` off it, where
the reference model has the ternary `Student receives LetterGrade for
CourseOffering`; the 0.154 run carries the reference's shape. The rubric
declares no grade check, so a genuine structural divergence is invisible
while a word costs 0.85.

This one case manufactures 89% of the suite's noise. Its 0.460 SD is
measuring vocabulary, and every mean that includes it inherits that.

## Where should a licensed name be declared? (resolved: once per concept, on the case)

Once per concept, in the case file, because both check families bottom
out in the same operation -- resolving a candidate object type against
another model's vocabulary -- and neither of them can be fixed from the
check that failed.

`requires_element` compares the rubric's own string against the
candidate (`checks/requiresElement.ts`, via
`getObjectTypeByNameOrAlias`). `forbids_population` never sees the
rubric's names for players at all: it looks the fact type up in the
reference (`checks/forbidsPopulation.ts:72`), derives a counterexample,
and then corresponds fact types by the **multiset of player names**
(`populationMapping.ts:46`, via `nameInVocabulary`).

So per-check alternatives -- `entity: [CourseOffering, Offering]` --
would rescue the three `requires_element` checks and leave both
`forbids_population` failures exactly where they are. The two helpers
are the seam, not the checks.

Both helpers already do most of this work. `normalizeForMatch`
(`nameResolution.ts:27`) folds case and strips `[\s\-_.]`, so `Course
Offering` and `course_offering` resolve today; both helpers already
consult candidate-side `aliases`. What is missing is a way for the
**case** to say that two words denote one concept, when the candidate
did not say so itself.

## Is `conference-reviews` the same defect? (resolved: no -- it is the suite working)

No. It fails on a real modelling fork, and the contrast is what makes
`university-enrollment` legible as an anomaly rather than a pattern.

Its two retained payloads differ structurally, not lexically. The 1.000
run carries the binary `Reviewer reviews Paper` and objectifies it into
`Review`. The 0.684 run has no fact type with players
`{Reviewer, Paper}` at all: it makes `Review` a standalone entity,
decomposes the relationship into `Reviewer conducts Review` and
`Review is of Paper`, and then needs an **external uniqueness spanning
both** to express "a given reviewer reviews a given paper at most once".

That is the associative-entity workaround from ER modelling, and it is
precisely what objectification removes -- a rule that is one internal
uniqueness on an objectified binary becomes a constraint straddling two
fact types. The transcript argues the other way explicitly: "the review
is the act of a particular reviewer reviewing a particular paper -- the
score hangs off that pairing, not off the paper alone."

So its sd of 0.158 is signal. Once this spec removes the synonym
variance from `university-enrollment`, that spread is a difference the
metric should be resolving, not noise to be tuned away. Leave the case
alone, and do not read its dispersion as a second instance of this bug.

## Scope

In scope:

- When an eval case or gym exercise declares that a set of names denotes
  one concept, the system shall resolve a candidate object type carrying
  any of those names against a rubric or reference name from the same
  set.
- When a candidate object type resolves through a licensed name, the
  system shall treat `requires_element` (both `entity` and
  `factTypeBetween` forms) and `forbids_population` player
  correspondence identically to an exact-name match.
- When a case declares no licensed names, the system shall resolve
  exactly as it does today.
- When `university-enrollment` declares `CourseOffering` and `Offering`
  as one concept, the recorded 0.154 payload shall score its full
  rubric.

Out of scope, deferred and named:

- **Making the extraction record aliases reliably.** Workstream 2; it is
  a prompt-compliance question, not a capability gap, and it cannot be
  measured against a metric that punishes the naming rule it comes with.
- **Fact-type reading synonyms.** Correspondence is by player names, so
  reading text does not affect a score. Out until a case fails on it.
- **Re-fitting `collapseFloor`.** It separated the two modes exactly as
  specified; nothing here is evidence against it.
- **Rewriting the transcript.** See Alternatives.

## Inventory

| Module                                            | Current state                                                | Verdict                     |
| ------------------------------------------------- | ------------------------------------------------------------ | --------------------------- |
| `learn/src/evaluate/nameResolution.ts`            | Candidate name + candidate aliases, exact then normalized    | widen: accept a licence set |
| `learn/src/evaluate/checks/requiresElement.ts`    | Calls `getObjectTypeByNameOrAlias` for both query forms      | thread the set through      |
| `learn/src/evaluate/populationMapping.ts`         | Corresponds fact types by player-name multiset               | thread the set through      |
| `learn/src/evaluate/checks/forbidsPopulation.ts`  | Reference lookup, counterexample, mapping                    | thread the set through      |
| `learn/src/exercise/types.ts`                     | `GymExercise` has no vocabulary field                        | add the field               |
| `learn/src/exercise/parseExercise.ts`             | Parses checks; `str(v, "factType")`                          | parse the new block         |
| `promptlab/src/score/scoreExtraction.ts`          | Adapts an eval case to `GymExercise` for `evaluateCandidate` | pass the block through      |
| `promptlab/evals/university-enrollment.eval.yaml` | Rubric names `CourseOffering` five times                     | declare the licence         |
| `learn/exercises/customer-order.gym.yaml`         | Two `requires_element` checks, no synonym problem            | untouched                   |
| `llm/src/prompt/systemPrompt.ts`                  | Instructs aliases at lines 51 and 136                        | workstream 2 only           |

The reference models are untouched on purpose, and that is a
conclusion rather than an omission -- see Alternatives.

## Target architecture

```
A case declares the licence once:

  # university-enrollment.eval.yaml
  vocabulary:
    - [CourseOffering, Offering]     # one concept, two words the transcript uses

  checks:
    - kind: requires_element
      element: { entity: CourseOffering }        # unchanged
    - kind: forbids_population
      factType: CourseOffering is of Course      # unchanged

The two resolution helpers gain the set; nothing else changes shape.

  getObjectTypeByNameOrAlias(model, name, licence?)
    exact name -> exact alias -> normalized name -> normalized alias
                -> licensed name (any word in `name`'s set)

  nameInVocabulary(objectType, vocabulary, licence?)
    ... -> a licensed word that IS in the vocabulary

Resolution order is append-only: a licence can only rescue a comparison
that would otherwise have failed, never redirect one that succeeded.
```

## Alternatives considered

- **Per-check alternatives (`entity: [CourseOffering, Offering]`).**
  The obvious shape, and it closes three of the five failures. It cannot
  reach `forbids_population`, whose player vocabulary comes from the
  reference model rather than from the check. Rejected on grounding.

- **Aliases on the reference model's object types.** Tempting because
  `ObjectType.aliases` already exists in core and `.orm.yaml`
  serializes it, so it needs no new format at all. It loses on the
  generation rule: references are generated from recorded payloads by
  `npm run regen:references`, and `referenceDrift.test.ts` fails when a
  committed reference stops matching a fresh render (barwise-856). A
  hand-added alias would be destroyed by the next regeneration, silently
  and without a symptom, since a reference is consumed for its
  constraints.

- **Rewriting the transcript to say "course offering" throughout.**
  Cheapest, and wrong. People shorten a term once they have defined it;
  that is what makes the transcript realistic, and
  `eval-transcript-realism.spec.md` exists to add such properties rather
  than remove them. It would also hide the defect instead of repairing
  it: the next transcript with two words for one concept reintroduces it.

- **Changing the prompt to prefer the fuller compound.** A one-line edit
  to `systemPrompt.ts:136`, and it would make this case's rubric fit.
  Rejected because it inverts the dependency: the metric would then
  grade vocabulary compliance rather than modelling, and a model naming
  the concept `Offering` -- which is what the domain's speakers call it,
  and what ORM's own use-the-domain's-language principle argues for --
  would still be correct and would still score 0.154.

## Workstreams (each independently shippable)

### 1. License names in the resolver (code, offline)

Widen `getObjectTypeByNameOrAlias` and `nameInVocabulary` to take an
optional licence set, thread it from `evaluateCandidate` through both
check families, add the `vocabulary` block to `GymExercise` and
`parseExercise`, and pass it through promptlab's exercise adapter.

First because it is pure, deterministic, and costs nothing to verify:
the acceptance criterion is that the recorded 0.154 payload, scored
against a case declaring the licence, passes its full rubric -- which
`barwise prompt score` answers offline from the payload already saved.

Mutation check: drop the licence from the case and confirm the score
returns to 0.154. A test that only asserts the passing direction would
also pass if the licence were ignored and the resolver had been loosened
to substring matching -- which must NOT happen, since it would match
`Course` to `CourseOffering`. Assert that pair stays distinct.

### 2. Declare the licence on `university-enrollment` (data)

One `vocabulary` entry. Separable from workstream 1 only in review
order; it is inert without it.

The suite bumps to **2.1.0**. No weight, floor, case or split changes,
but a score that was 0.154 becomes 1.000, so rows either side are not
comparable -- the same reasoning that bumped 1.3.0 for a conformance
check's removal.

`conference-reviews` needs no entry -- see the section above.

### 3. Make alias recording stick (prompt; provisional: not yet grounded)

The instruction exists twice (`systemPrompt.ts:51`, `:136`) and the
model followed the naming half while skipping the alias half in every
collapsed sample. So this is compliance, not capability: the schema
carries `aliases` (`responseSchema.ts:60`), the parser maps it
(`parse/objectTypes.ts:38`), and core stores it (`ObjectType.ts:107`).

Provisional because the mechanism is a prompt edit whose effect can only
be measured, and it must be measured after workstream 1 -- optimizing
toward alias recording against a metric that punishes the naming rule it
accompanies would fit the prompt to the bug.

Worth doing on its own merits regardless of this spec: an ORM model that
does not carry the domain's own words has lost something the transcript
gave it.

## API and migration impact

- `@barwise/learn` public API widens: `GymExercise` gains an optional
  `vocabulary`, and both resolution helpers gain an optional parameter.
  Additions, so existing callers keep compiling and existing exercises
  keep parsing.
- `@barwise/promptlab` passes the block through its adapter; no
  signature it exports changes.
- No downstream package needs a change: the CLI, MCP and VS Code
  surfaces consume `evaluateCandidate`'s report, not its inputs.
- Suite manifest moves to 2.1.0 in workstream 2.

## Decisions (resolved 2026-08-27, as recommended)

- **Whether workstream 3 is a hand-edited variant or an optimizer run.**
  RESOLVED: the hand edit first, purely to price the gap -- if
  compliance is already high once the metric is honest, there is
  nothing to optimize. Still provisional; nothing has been measured yet.

- **Whether the licence is symmetric or directional.** RESOLVED:
  symmetric, with the parser rejecting a word that appears in two sets
  -- compared normalized, the same way resolution compares, so
  `Course Offering` and `CourseOffering` cannot be licensed apart.

- **Whether gym exercises get the field too.** RESOLVED: yes. They
  share `GymExercise`, so the field arrived with the type; the gym's
  CLAUDE.md now says so, and the exercise JSON schema carries the
  block for editor autocomplete.

## Risks and testing

- The resolution order must stay append-only. `tests/nameResolution`
  should pin that an exact match still wins over a licensed one, so a
  licence cannot silently redirect a comparison that already succeeded.
- `Course` must not resolve to `CourseOffering`. The licence makes
  synonymy explicit precisely so that matching never has to guess from
  substrings; assert the negative.
- The answer-key invariant is unaffected: the seven recorded payloads
  score 1.000 and declare no vocabulary, so workstream 1 must leave
  `tests/scoreExtraction.test.ts` byte-identical. That is the guard that
  the widening is inert where unused.
- Land as three PRs. After workstream 2, re-score both retained
  `university-enrollment` payloads offline; a paid re-run is not needed
  to know the case is fixed.

## Non-goals

- No change to `collapseFloor`, the weights, the splits, or the case
  list.
- No new check kind, and no change to what any existing check means.
- No substring, stemming, or edit-distance matching. Synonymy is
  declared, never inferred -- that is the whole point of the design.
- No transcript edits.

## Implementation notes

### Workstreams 1 and 2 (2026-08-27)

Shipped as specified, with one deviation and one substitution worth
recording.

- **One parser, not two.** The brief's inventory had `parseExercise`
  and promptlab's loader each learning the block. `parseVocabulary` is
  instead exported from `@barwise/learn` and called by both -- the
  validation rules (two-word minimum, one set per word, normalized
  collision detection) are exactly the kind of must-agree copy the
  duplication-drift-guards spec exists to prevent, and learn already
  sits below promptlab in the graph.

- **The acceptance payload is reconstructed, not replayed.** The 0.154
  payload the brief names was retained by `keepDiagnosticPayloads` in
  the operator's local run and is not checked in. The test builds its
  equivalent by renaming `CourseOffering` to `Offering` across the
  recorded answer key -- the eval writeup established that this one
  word is the entire difference -- and asserts both directions: 1.000
  with the licence declared, exactly 1/6 (only `must_validate`) with it
  stripped. The rename is whole-payload on purpose: the token appears
  in constraint role hints too, and renaming only some turns a
  vocabulary difference into a structural one (two orphaned
  constraints, two `invalid_role_player` corrections), which is a
  different payload than the one the collapse recorded.

- The append-only pin and the `Course`-versus-`CourseOffering` negative
  both live in `learn/tests/nameLicence.test.ts`; the suite bumped to
  2.1.0; the seven answer-key pins in `scoreExtraction.test.ts` are
  byte-identical to before, as required.

The offline re-score of the operator's retained payloads
(`barwise prompt score --case university-enrollment --extraction
<file>`) remains worth doing as confirmation, but the reconstruction
answers the acceptance criterion without it.
