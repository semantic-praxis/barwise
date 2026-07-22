# Modeling tutorial: a motivated, CSDP-ordered path through ORM

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-07-03
Last-updated: 2026-07-03
Tracking: Feature follow-up to the `docs/anki` learning deck (PR #253)
and the modeling-gym spec (`docs/specs/modeling-gym.spec.md`, PR #254).
No bd issue yet -- the bd binary is unavailable in this web session;
file one before the first implementation PR.

## Principle

The tutorial serves **composability** and **determinism in the core**.

The best explanations do not list facts; they make the learner feel the
question before handing them the answer, and they show where each piece
leads. That is three moves: pose the problem first (motivation before
mechanics), say what the piece unlocks (a forward reference), and close
the loop when the payoff arrives (a backward reference). The Anki deck
(PR #253) deliberately strips this -- flashcards atomize and shuffle, and
that is correct for retention. So the pedagogy the deck cannot carry
needs its own artifact: a narrative spine.

ORM is unusually ready for it. The method already ships a motivated,
dependency-ordered sequence -- the **Conceptual Schema Design Procedure**
(CSDP), the seven steps around which Halpin & Morgan chapters 3-7 are
organized. Each step is provoked by a defect in the model-so-far and
unlocks the next. The tutorial is that sequence made concrete on one
worked model.

The decisive point is that Barwise can **generate the motivation** rather
than assert it. Core already exports `generateCounterexampleForConstraint`
(`@barwise/core/counterexample`), which returns the minimal population a
constraint forbids -- the deterministic inverse of population validation.
So the hook for a constraint step is not a hand-written "imagine if...";
it is the concrete population the current model still allows, computed
from the model. The tutorial invents no modeling capability. It
**composes** existing deterministic ones -- verbalize, counterexample,
validate, diagram -- into a motivated order, and bakes their output in so
it cannot drift from the tool. Pedagogy stays one layer out of core, as
in the gym.

## Should the tutorial be a document or a program? (resolved: a regenerable document first)

Build the tutorial as **authored narrative plus a deterministic render**
that bakes in generated motivation, committed as Markdown; an interactive
driver is a later, optional layer.

The irreducible core of the artifact is the narrative order and the
per-step motivation -- not a runtime. A step is: the model-so-far, the
counterexample it still allows (generated), the concept that fixes it,
and the links to what it builds on and unlocks. Rendered to committed
Markdown, that is readable anywhere, reviewable in git, and -- because the
motivation and verbalization are generated from the model snapshots and
regenerated on demand -- provably in sync with the tool. This is exactly
the `examples/output/` discipline (a model paired with its regenerated
`.verbalizations.txt` and `.diagnostics.txt`, refreshed by
`npm run regen:examples`), applied to a narrated sequence.

Interactivity -- the learner edits the model at each step and is checked
live -- is valuable but not the essence, and it is not free: it needs a
driver and a grader. The grader already has a home: the gym's evaluator
(`docs/specs/modeling-gym.spec.md`). So the interactive tutorial is a
_guided gym_ -- the same evaluator, walked in a fixed motivated order --
and it belongs in a later workstream that composes with the gym rather
than duplicating it.

## Scope

In scope:

- A tutorial **step format**: the schema for one narrated step (model
  snapshot, generated motivation, concept text, forward/backward links,
  deck and gym cross-links).
- One authored **worked tutorial** that walks the CSDP on a single small
  domain, roughly one step per CSDP sub-step.
- A deterministic **renderer/build** that regenerates each step's
  counterexample and verbalization from its model snapshot and renders
  the whole tutorial to committed Markdown, version-stamped, with a
  drift test -- mirroring `regen:examples`.
- Cross-links from each step to the relevant deck subdeck and (once it
  exists) a gym exercise.

Out of scope, deferred and named:

- The **interactive driver** (CLI `barwise tutorial` / MCP / VS Code)
  that walks steps and checks learner attempts. A later workstream; it
  composes with the gym's evaluator.
- Multiple tutorials / a curriculum of domains. One worked tutorial
  first; a second domain is a later content add.
- Authoring the gym itself -- that is `docs/specs/modeling-gym.spec.md`.
  This spec depends on it only for the interactive layer.

## Inventory

| Area                           | Change                                                             | Verdict   |
| ------------------------------ | ------------------------------------------------------------------ | --------- |
| tutorial step schema + loader  | The narrated-step format and its `.yaml` loader                    | new       |
| worked tutorial content        | One CSDP walkthrough: per-step model snapshots plus narrative      | new       |
| tutorial renderer/build        | Regenerate motivation + verbalization, render Markdown, drift test | new       |
| `docs/tutorial/`               | The committed rendered tutorial (generated artifact)               | new       |
| `@barwise/core/counterexample` | `generateCounterexampleForConstraint` consumed as-is               | untouched |
| `@barwise/core/verbalization`  | `Verbalizer` consumed as-is                                        | untouched |
| `@barwise/diagram`             | Optional per-step SVG of the model-so-far                          | consumed  |
| `@barwise/gym`                 | Its evaluator reused by the later interactive driver only          | untouched |

No core change: the build calls `generateCounterexampleForConstraint`,
`Verbalizer`, `ValidationEngine`, and (optionally) the diagram renderer
purely as a consumer, through published exports.

## Target architecture

```
@barwise/core                          (unchanged)
  exposes: generateCounterexampleForConstraint (/counterexample),
           Verbalizer (/verbalization), ValidationEngine
@barwise/diagram                       (unchanged; optional per-step SVG)
  ^
  |--- tutorial (home per Open decision 1)
  |      step schema:  TutorialStep, loadTutorial(.yaml)
  |      build:        renderTutorial(steps) -> Markdown
  |                    (per step: generate the motivating counterexample
  |                     from the prior model + this step's constraint,
  |                     verbalize the model-so-far, optionally diagram it)
  |      content:      one CSDP worked tutorial (model snapshots + prose)
  |      output:       docs/tutorial/*.md  (committed, regenerable)
  |
  |--- (later) interactive driver: CLI/MCP that walks the steps and
  |            checks attempts via the @barwise/gym evaluator
```

The step contract:

```ts
interface TutorialStep {
  id: string;
  csdpStep: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  title: string;
  // The model AFTER this step -- the state the learner reaches.
  model: string; // path to a .orm.yaml snapshot
  // How this step is motivated. For a constraint step, the hook is the
  // counterexample the PRIOR model allows and this step's constraint
  // forbids, generated at build time. For a non-constraint step
  // (e.g. stating elementary facts) the motivation is authored prose.
  motivation:
    | { kind: "counterexample"; constraintId: string; }
    | { kind: "prose"; text: string; };
  concept: string; // the teaching text, shown after the motivation
  buildsOn: string[]; // ids of steps this one depends on (backward refs)
  unlocks: string[]; // ids of steps this one enables (forward refs)
  deck?: string; // deck subdeck to drill this step, e.g. "ORM 2::Uniqueness"
  gym?: string; // gym exercise id to practice this step (later layer)
}
```

`renderTutorial` is pure and deterministic: same steps and snapshots
produce byte-identical Markdown. Each rendered step shows, in order: the
generated motivation (a forbidden population, verbalized), the concept,
the model-so-far (verbalization, and optionally an SVG), and callout
lines for `buildsOn` / `unlocks`.

## Alternatives considered

- **A hand-written prose tutorial.** Rejected on determinism. Hand-typed
  "imagine two orders with the same id" drifts from what the tool
  actually forbids the moment a verbalizer or the counterexample
  generator changes. Generating the motivation from the model is the
  whole point -- it is the same anti-drift discipline as the deck's
  tool-quoted answers and the gym's `forbids_population`.
- **Fold the tutorial into the deck.** Rejected: flashcards atomize by
  design; a motivated narrative is the opposite shape. The deck and the
  tutorial are complementary artifacts, not one.
- **Interactive-first (a runtime tutorial before a document).** Rejected
  as first step: it front-loads a driver and depends on the gym, which is
  itself unbuilt. The document carries the entire pedagogical payload;
  interactivity is an enhancement layered on later.
- **A second new package `@barwise/tutorial`.** Weighed against reusing
  `@barwise/gym` (see Open decision 1). The two share the
  counterexample-as-motivation mechanism, the model-snapshot step shape,
  and -- for interactivity -- the evaluator. A separate package re-imports
  all three; hosting both learning artifacts in one package keeps the
  concern together.

## Workstreams (each independently shippable)

### 1. Step format, renderer, and one worked tutorial

The step schema and `.yaml` loader, the deterministic `renderTutorial`
build, and one authored CSDP walkthrough on a small domain, rendered to
committed Markdown under `docs/tutorial/` with a drift test that fails if
the committed output does not match a fresh render (the `regen:examples`
pattern). Smallest blast radius: it consumes core as-is and adds no
surface; the deliverable is a readable, regenerable document. This is the
whole pedagogical payload.

The motivation generator is the crux: for a `counterexample` step, the
build takes the prior step's model, the constraint named by
`constraintId`, and calls `generateCounterexampleForConstraint`; the
returned `Counterexample` is verbalized as the hook ("nothing yet stops
[Order 1 / id 7] and [Order 2 / id 7]"). Grounding note: confirm the
`Counterexample` segment/population shape and how to verbalize it against
`packages/core/src/counterexample/` before building the renderer.

### 2. Cross-links to the deck and the gym

Populate each step's `deck` link (to the matching deck subdeck) and, once
the gym's seed catalog exists, its `gym` link (to an exercise that
practices the step). Renders as "drill this / practice this" callouts,
tying the three learning artifacts into one path. Depends on 1; the gym
link additionally depends on the gym's catalog.

### 3. (later) Interactive driver

A CLI/MCP driver that walks the steps: show the generated motivation,
present the model-so-far, invite the learner to make the step's change,
and check the attempt with the `@barwise/gym` evaluator before advancing.
The tutorial becomes a guided gym. Out of this spec's build scope; noted
so the boundary is explicit. Depends on the gym (spec #254) being built.

## API and migration impact

Additive only. No existing signatures change. The tutorial build consumes
`@barwise/core/counterexample`, `/verbalization`, and optionally
`@barwise/diagram`, all as-is. A new `regen:tutorial`-style script and a
drift test are added. The interactive driver (workstream 3) would later
depend on `@barwise/gym`. No serialization, validation, or verbalization
behavior changes, so downstream packages are unaffected.

## Open decisions

1. **Where the tutorial build and schema live.** Reuse `@barwise/gym` as
   the single learning package (recommended -- it already owns the
   counterexample-as-motivation mechanism and the model-snapshot step
   shape, and the interactive layer needs its evaluator) vs a new
   `@barwise/tutorial` package vs a content-only `docs/tutorial/` with a
   build script hosted in an existing package. Recommendation: host the
   schema and renderer in the gym package; if that package's name is felt
   to over-index on "gym", rename it to something covering both artifacts
   (e.g. `@barwise/learn`) while it is still unbuilt. This couples to
   Open decision 1 of the gym spec.
2. **The worked-tutorial domain.** Reuse an existing example domain
   (recommended -- e.g. a trimmed `order-management` from
   `examples/output/`, so the tutorial, the examples, and the gym share a
   vocabulary) vs a fresh domain chosen for teaching clarity. Reuse keeps
   the learner in one world across artifacts.
3. **Per-step diagrams.** Render an SVG of the model-so-far at each step
   via `@barwise/diagram` (recommended -- it makes the "the model visibly
   grows" progression literal, and reuses an existing capability) vs
   text-only verbalization (lighter, no diagram dependency in the build).
4. **Render target.** Commit the rendered Markdown under `docs/tutorial/`
   (recommended -- readable on GitHub, diffable, regenerable) vs generate
   on demand only. Committing matches `examples/output/`.

## Risks and testing

- **Risk: a generated counterexample reads awkwardly for a given
  constraint.** The verbalized forbidden population is only as clear as
  the counterexample generator's output for that constraint family.
  Mitigation: the step format allows an authored `prose` motivation as an
  escape hatch where the generated one does not teach well; prefer
  generated, fall back to authored, and note in the step which was used
  so the gap is visible rather than silent.
- **Risk: drift between the committed Markdown and the tool.** Mitigation:
  the drift test regenerates and compares, exactly as `examples/output/`
  does; CI fails if they diverge.
- **Testing:** unit tests for the step loader (round-trip) and the
  renderer (a fixed step sequence renders to expected Markdown); a
  determinism test (same input -> byte-identical output); the drift test
  over the committed tutorial. Coverage aligns with the core capability
  packages.

## Non-goals

- **Not a replacement for the book.** The tutorial motivates and
  sequences; Halpin & Morgan is where the method is taught in full, and
  the tutorial's steps cite it (the deck's `docs/halpin-morgan-3e-contents.md`
  mapping applies).
- **Not a replacement for the deck or the gym.** The three are one
  system: the tutorial motivates (why and in what order), the deck
  retains (the atoms), the gym applies (the judgment). Each cross-links
  the others; none subsumes them.
