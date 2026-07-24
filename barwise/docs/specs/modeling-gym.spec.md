# Modeling gym: deterministic practice-with-feedback for learning ORM

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-07-03
Last-updated: 2026-07-03
Tracking: Feature follow-up to the `docs/anki` learning deck (merged in
PR #253). No bd issue yet -- the bd binary is unavailable in this web
session; file one before the first implementation PR.

## Principle

The gym serves **composability** and **orthogonality**, the two primary
pillars.

Fact-based modeling is a skill, and skills are built by a tight
do-then-feedback loop, not by recall alone. The Anki deck (PR #253)
covers the atoms -- terminology, notation, the fixed phrasing of
constraints. It cannot teach judgment: looking at a domain and producing
a well-formed, well-constrained model. That gap is what the gym fills.

Barwise already ships every primitive the loop needs -- `validate`,
`verbalize`, `counterexample`, and population validation -- as pure,
deterministic core capabilities. The gym is their **composition**: an
exercise poses a domain brief, the learner writes an `.orm.yaml`, and the
evaluator runs those primitives to produce structured feedback. No new
modeling capability is invented; the value is in wiring existing ones
into a graded loop.

The design question is where that composition lives without violating
orthogonality. Pedagogy -- exercises, rubrics, scoring -- is a concern
distinct from the metamodel. Core knows nothing about "an exercise" or "a
passing score," and it should stay that way. So the evaluator and the
exercise catalog live one layer out, in a dedicated connector-style
package, exactly as `llm`, `code-analysis`, `dbt`, and `formats` keep
their concerns out of core.

## Should we build the evaluator as a new package? (resolved: yes)

Yes -- a new `@barwise/gym` package owns the evaluator and the exercise
catalog; core is untouched.

The evaluator is pure and deterministic (candidate model + exercise
rubric produces a feedback report), so determinism does not force it out
of core. But orthogonality does. Core's concern is the ORM metamodel and
its deterministic operations; grading a learner against a rubric is a
pedagogy concern with its own vocabulary -- exercise, check, hint, score
-- that core has no reason to carry. The project already isolates every
non-metamodel concern into its own package outside core: transcript
extraction in `llm`, code connectors in `code-analysis`, interop formats
in `formats`. The gym is another such concern and takes the same shape.

Two surfaces need the evaluator -- the CLI and the MCP server -- and a
third (VS Code) will later. Putting the evaluator in one package and
letting all three consume it is the composable choice; duplicating the
grading logic in each surface is the DRY violation the connector
convention exists to prevent.

The cost is one more node in the package graph. It is additive and
one-way (`gym` depends only on `core`), so it preserves the DAG and
breaks nothing.

## Should we grade by rubric or by diffing a reference model? (resolved: rubric)

Grade against a declarative **rubric of semantic checks**, not by diffing
the candidate against a canonical reference model.

There is no single correct ORM model for a domain. Role names, reading
direction, reference-mode choice, and whether a concept is a value type
or an entity type with a reference scheme all vary between equally valid
answers. `diffModels` matches elements by name and reports every such
difference as a delta -- so grading by reference-diff would flag correct
models as wrong on cosmetic grounds. It is the wrong instrument for a
grader.

The robust check is **semantic**, and Barwise already verbalizes and
population-validates, which are exactly the semantic surfaces. An exercise
therefore ships a rubric of small, declarative checks, each reusing a
primitive:

- `must_validate` -- the candidate has no structural errors
  (`ValidationEngine`).
- `requires_verbalization` -- a required FORML sentence appears in the
  candidate's verbalization output (`Verbalizer`). Robust to UUID and
  role-name choices because it compares meaning, not structure.
- `forbids_population` -- the candidate **rejects** a given population.
  This inverts the `counterexample` capability: the exercise names a
  constraint the reference model carries, the evaluator generates the
  population that constraint forbids via
  `generateCounterexampleForConstraint`, injects it into the candidate,
  and runs population validation. A candidate that accepts the population
  has failed to encode the constraint. The feedback is concrete: "your
  model allows [Order 1 / id 7] and [Order 2 / id 7], but each Order
  should have a unique id."
- `requires_element` -- a structural precondition (an entity type named
  X, a binary fact type between X and Y) via `query`. Used sparingly, to
  scaffold the brief.

A reference model still ships with each exercise, but as **guidance shown
after grading** (an optional `diffModels` view: "one valid answer differs
from yours here"), never as the grade itself.

The `forbids_population` check is the design's keystone, and it makes real
use of `generateCounterexampleForConstraint`, which is currently
unexposed through any surface. The exercise author points at a reference
constraint; the forbidden population is derived deterministically at
evaluation time, so exercises stay DRY (no hand-transcribed populations)
and cannot drift from the reference.

## Scope

In scope: a new `@barwise/gym` package (exercise schema + loader, the
evaluator, a seed catalog); a JSON Schema for the `.gym.yaml` format; a
CLI surface (`barwise gym list|show|check`); an MCP surface (`gym_list`,
`gym_check`); and a seed catalog of four to six graded exercises spanning
difficulty.

Out of scope, deferred and named:

- An LLM tutor that coaches interactively -- a non-deterministic outer
  concern that layers on top by calling `gym_check` (see Non-goals).
- VS Code integration -- a later workstream once the CLI/MCP surfaces
  settle.
- Progress tracking and spaced-repetition scheduling of exercises. The
  Anki deck owns SRS; the gym owns practice-with-feedback. Combining them
  is a later idea.
- Auto-generated exercises. The seed catalog is hand-authored; generation
  is a follow-up.

## Inventory

| Area                               | Change                                                                  | Verdict   |
| ---------------------------------- | ----------------------------------------------------------------------- | --------- |
| `packages/gym/src/exercise/`       | Exercise schema types and `.gym.yaml` loader                            | new       |
| `packages/gym/src/evaluate/`       | The evaluator and its four check runners (checks produce a `GymReport`) | new       |
| `packages/gym/exercises/`          | Seed catalog content (`*.gym.yaml` plus reference `*.orm.yaml`)         | new       |
| `packages/gym/schemas/`            | `gym-exercise.schema.json`                                              | new       |
| `@barwise/core`                    | Consumed only through existing subpath exports                          | untouched |
| `packages/cli/src/commands/gym.ts` | New `gym` command (list/show/check); add `@barwise/gym` dependency      | additive  |
| `packages/mcp/src/tools/gym.ts`    | New `gym_list`/`gym_check` tools; bump `SERVER_VERSION`; add dependency | additive  |
| `CLAUDE.md` dependency graph       | Add the `gym` node                                                      | doc       |

Nothing in core changes: the evaluator calls `ValidationEngine`,
`Verbalizer`, `generateCounterexampleForConstraint`, the population
validation rules, and `query` purely as a consumer, through their
published subpath exports.

## Target architecture

```
@barwise/core                        (unchanged)
  exposes: ValidationEngine, Verbalizer (/verbalization),
           counterexample (/counterexample), population validation rules,
           OrmYamlSerializer, query (/query)
  ^
  |--- @barwise/gym                   (new; depends on core only)
  |      exercise/    ExerciseSchema, loadExercise(.gym.yaml)
  |      evaluate/    evaluateCandidate(model, exercise) -> GymReport
  |                   runners: mustValidate, requiresVerbalization,
  |                            forbidsPopulation, requiresElement
  |      exercises/   seed catalog (*.gym.yaml + reference *.orm.yaml)
  |      schemas/     gym-exercise.schema.json
  |
  |--- @barwise/cli   barwise gym list|show|check    (consumes gym)
  |--- @barwise/mcp   gym_list, gym_check            (consumes gym)
```

The evaluator's contract:

```ts
interface GymExercise {
  id: string;
  title: string;
  difficulty: "intro" | "core" | "advanced";
  brief: string; // the domain prompt shown to the learner
  starter?: string; // optional partial .orm.yaml to begin from
  reference?: string; // path to one valid answer (guidance + counterexample source)
  checks: GymCheck[];
}

type GymCheck =
  | { kind: "must_validate"; }
  | { kind: "requires_verbalization"; sentence: string; hint?: string; }
  | { kind: "forbids_population"; referenceConstraint: string; hint?: string; }
  | { kind: "requires_element"; query: ElementQuery; hint?: string; };

interface GymReport {
  exerciseId: string;
  passed: boolean;
  results: CheckResult[]; // one per check, in authored order
  guidance?: ReferenceDiff; // optional post-grade diff vs reference
}

interface CheckResult {
  kind: GymCheck["kind"];
  passed: boolean;
  message: string; // concrete, learner-facing
  hint?: string; // shown only on failure
}
```

`evaluateCandidate` is pure and deterministic: the same model and
exercise produce an identical report, byte for byte.

## Alternatives considered

- **Evaluator in core (`@barwise/core/gym`).** Rejected on orthogonality.
  It is deterministic enough to live in core, but core's concern is the
  metamodel, not pedagogy; adding "exercise" and "score" to core's
  vocabulary couples it to a teaching concern it otherwise has no reason
  to know. The connector convention says a concern outside the metamodel
  lives outside core.
- **No new package -- orchestrate in the CLI, duplicate in MCP.** Rejected
  on composability and DRY. The grading logic is non-trivial and both
  surfaces (and later VS Code) need it identically. Parallel copies in
  `cli` and `mcp` is exactly the duplication the connector packages exist
  to avoid.
- **Grade by diffing a reference model.** Rejected (see the resolved
  question). Too many valid ORM forms; name-based `diffModels` flags
  cosmetic differences as errors. Reference-diff survives as optional
  post-grade guidance, not as the grade.
- **A `counterexample` satisfying-instance generator.** Considered for
  positive checks ("show a population your model should accept"). The
  current generator only produces violating populations; adding a
  satisfying-instance mode is a core change and out of scope. The
  `forbids_population` check covers the high-value case without it.

## Workstreams (each independently shippable)

### 1. `@barwise/gym` foundation: schema, loader, evaluator

The package with the exercise schema, the `.gym.yaml` loader, the
`evaluateCandidate` evaluator with all four check runners, and unit tests
using two seed exercises as fixtures. Smallest blast radius: a new leaf
package that nothing yet consumes, so it cannot break an existing
surface. Ships green on its own tests. This is the whole conceptual core
of the feature; the surfaces are thin wrappers.

The `forbids_population` runner is the subtle one: it calls
`generateCounterexampleForConstraint` on the named reference constraint to
get the forbidden `Population`, attaches that population to the candidate
model, runs the population validation rules, and passes the check iff the
rules report a violation (the candidate correctly rules the population
out). Grounding note: confirm the exact population-attachment and
population-validation entry points against
`packages/core/src/validation/rules/population/` before building this
runner; the exploration confirmed the inverse relationship but not the
call shape.

### 2. CLI surface: `barwise gym`

A `gym` command with `list` (catalog), `show <id>` (brief plus starter),
and `check <id> <candidate.orm.yaml>` (evaluate, print the report, exit 1
if not passed). Mirrors the existing `project` subcommand pattern and the
`--format text|json` convention. Adds the `@barwise/gym` dependency.

### 3. MCP surface: `gym_list`, `gym_check`

`gym_list` (no source; returns the catalog) and `gym_check` (source =
candidate model plus an `exercise` id; returns the report). Follows the
`register*Tool` plus pure `execute*` split, re-exports `execute*` from
`server.ts`, and bumps `SERVER_VERSION` with the version-sync test. Large
reports use `boundedTextResult`.

### 4. Seed catalog: four to six graded exercises

Hand-authored exercises spanning `intro` to `advanced`, each exercising
the check types: a many-to-one uniqueness drill, a mandatory-role drill,
an exclusion or exclusive-or drill, an objectification exercise, and a
small end-to-end domain. Each ships a brief, a reference model, and a
rubric. Depends on workstream 1 (the schema) but can land incrementally.

### 5. (later) VS Code integration and richer feedback

Out of this spec's scope; noted so the boundary is explicit. A gym view
in the extension, progressive hint reveal, and per-learner progress are
follow-ups once workstreams 1 through 4 are proven.

## API and migration impact

Additive only. No existing signature changes. New package `@barwise/gym`
(depends on `core`); `cli` and `mcp` each gain a dependency on it and new
command/tool surfaces. `SERVER_VERSION` bumps (workstream 3) with its sync
test. The `CLAUDE.md` dependency graph gains the `gym` node. No
serialization, validation, or verbalization behavior changes, so
downstream packages are unaffected except where they opt in.

## Open decisions

1. **Package name.** `@barwise/gym` (recommended -- short, memorable) vs
   `@barwise/practice` or `@barwise/exercises` (more literal). Trivial,
   but a package name is costly to change later.
2. **Where the exercise catalog lives.** Inside the package
   (`packages/gym/exercises/`, recommended -- the package owns its
   content, mirroring how `formats` owns its descriptors) vs top-level
   `examples/gym/` (more discoverable, but splits the concern across two
   locations). Recommendation: in-package, with the CLI able to load an
   external catalog directory via a flag later.
3. **One MCP tool or two.** `gym_list` plus `gym_check` (recommended --
   matches the one-verb-per-tool style) vs a single `gym` tool with a
   `mode`. Minor.
4. **Exercise file extension.** `.gym.yaml` (recommended -- parallels
   `.orm.yaml` and `.map.yaml`, and lets a schema bind by suffix) vs a
   plain `.yaml` in a known directory. Minor.

## Risks and testing

- **Risk: verbalization-string matching is brittle.** A
  `requires_verbalization` check compares against the exact FORML string
  the verbalizer emits. Mitigation: author the expected strings by
  running the reference model through `verbalize` (the same source of
  truth the Anki deck uses), and normalize whitespace before comparison.
  A drift test regenerates them, mirroring `examples/output/`.
- **Risk: population-injection API mismatch.** The `forbids_population`
  runner depends on the exact shape of population validation. Mitigation:
  workstream 1 grounds it against
  `packages/core/src/validation/rules/population/` before building, and a
  fixture exercise pins the behavior.
- **Testing:** unit tests per check runner (pass and fail cases);
  round-trip loader tests for `.gym.yaml`; a determinism test (same input
  produces a byte-identical report); CLI and MCP handler tests calling
  `execute*` and the command action directly, per each package's
  convention. Coverage target aligns with core's capability packages.

## Non-goals

- **An LLM tutor is not part of the gym.** The gym is deterministic. An
  interactive tutor is a separate, outer concern that consumes the gym: an
  LLM (in Claude, VS Code chat, and the like) calls `gym_check`, reads the
  structured report, and coaches. Keeping the grader deterministic is what
  lets the tutor stay honest -- the pass or fail is not the model's
  opinion. The tutor belongs in a later spec, layered on `mcp`.
- **Not a replacement for the Anki deck.** Recall (deck) and judgment
  (gym) are complementary; neither subsumes the other.
