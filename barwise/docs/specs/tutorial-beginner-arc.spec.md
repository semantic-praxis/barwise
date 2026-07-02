# Tutorial beginner arc: a deterministic puzzle judge and the articulation curriculum

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-07-01
Last-updated: 2026-07-01
Tracking: feature (gamified ORM tutorial); companion: `tutorial-mystery-arc.spec.md`

## Principle

Composability is the argument for building this at all. Every feedback
primitive a modeling tutorial needs already exists in core as a pure
function: verbalization (`Verbalizer.verbalizeModel`,
`core/src/verbalization/Verbalizer.ts`), population validation
(`populationValidationRules`,
`core/src/validation/rules/populationValidation.ts`), and
counterexample generation (`generateCounterexamples`,
`core/src/counterexample/CounterexampleGenerator.ts`). A tutorial is a
new composition of those primitives plus content, so it belongs in a
new package that depends only on core -- the same shape the connector
packages use for formats.

Determinism sets the second boundary. Grading must be a pure function
of (puzzle, attempt): same attempt, same verdict, no I/O, no LLM. The
judge therefore lives in the new package. Narration, hints, and
LLM-generated variety are host concerns and belong to the companion
mystery spec.

The curriculum itself targets the skill novices actually fail at:
articulating elementary facts (CSDP step 1), before any constraint
theory. The arc runs world-to-facts; the mystery arc runs
facts-to-laws.

## Should the tutorial be its own package? (resolved: yes, `@barwise/tutor`)

Core ships no curriculum for the same reason it ships no interop
format: the capability is a composition over core's public API, and
content churns on a different cadence than the metamodel. Placing the
puzzles in `cli` would force `mcp` to depend on `cli` to reuse them,
which the one-way dependency graph forbids. A new `@barwise/tutor`
package with core as its only internal dependency lets `cli`, `mcp`,
and later `vscode` host the same judge and the same content, exactly
as they share `@barwise/core` today.

## Anchors (grounding)

The design rests on four verified facts:

- `populationValidationRules(model): Diagnostic[]` checks sample
  populations against every constraint family and returns structured
  diagnostics with stable rule ids such as
  `population/uniqueness-violation`
  (`core/src/validation/rules/populationValidation.ts`,
  `core/src/validation/Diagnostic.ts`). This is the reject-with-reason
  primitive.
- `Verbalizer.verbalizeModel` is deterministic: output order follows
  model element order, segments carry a flattened `.text`
  (`core/src/verbalization/Verbalizer.ts`). This is the
  say-what-you-mean primitive.
- Populations are first-class in `.orm.yaml`
  (`core/src/model/Population.ts`,
  `core/src/serialization/yaml/population.ts`), so puzzle evidence is
  representable with existing serialization.
- `FactInstance.roleValues` is keyed by role UUID
  (`core/src/model/Population.ts`). A learner's model has fresh UUIDs,
  so puzzle evidence cannot ship as `Population` objects; the judge
  must bind name-keyed evidence to the attempt at judge time.
  `diffModels` already matches elements by name for the same reason
  (`core/src/diff/ModelDiff.ts`), so name binding has precedent.

One anchor was held and discarded: the structural query engine
(`core/src/query/types.ts`) was assumed usable for data-level checks.
Verified: all fourteen query kinds are structural and none reads
instances. The beginner judge never needed it; the mystery spec
records the reframe it forced there.

## Scope

In scope: the `@barwise/tutor` package (puzzle file format, JSON
schema, deterministic judge, evidence binding, progress reducer), the
prologue content pack (five chapters), a `barwise learn` CLI command,
and MCP tutor tools.

Out of scope: the mystery arc and everything LLM
(`tutorial-mystery-arc.spec.md`); a drill bank with spaced repetition
(follow-up spec once both arcs ship); the VS Code walkthrough; any
change to core.

## Inventory

| Area             | Current state                                 | Verdict                             |
| ---------------- | --------------------------------------------- | ----------------------------------- |
| `packages/tutor` | does not exist                                | new package: format, judge, content |
| `packages/core`  | primitives exist and suffice (see Anchors)    | unchanged                           |
| `packages/cli`   | 12 command modules, none tutorial             | adds `learn` command (workstream 3) |
| `packages/mcp`   | 14 tools, none tutorial or population-related | adds tutor tools (workstream 4)     |
| `docs/specs`     | no tutorial or learning spec exists           | this spec plus the companion        |

`packages/llm` looks adjacent but is untouched: this spec has no LLM
surface by design.

## Target architecture

```
@barwise/tutor            (deps: @barwise/core only; pure, deterministic)
  schemas/puzzle.schema.json   JSON Schema for .puzzle.yaml (ajv-validated on load)
  src/puzzle/                  puzzle types, .puzzle.yaml loader (yaml + ajv)
  src/judge/                   judge(puzzle, attempt) -> Verdict; evidence binding
  src/progress/                pure reducer advance(progress, verdict) -> progress
  content/prologue/            ch1 .. ch5 *.puzzle.yaml + canonical solutions

@barwise/cli   += src/commands/learn.ts   interactive loop; persists progress JSON
@barwise/mcp   += src/tools/tutor.ts      tutor_list_puzzles, tutor_get_puzzle,
                                          tutor_judge_attempt
```

Puzzle files follow the `.orm.yaml` conventions: YAML, a
`schemaVersion` field, ajv validation against a first-class JSON
Schema (explicit over implicit).

## Puzzle format and judge

Two puzzle kinds cover the arc:

- `choice`: options plus an answer key, for recognition puzzles
  (fact-or-noise, entity-vs-value). Judged by key lookup.
- `build`: the learner submits a model (inline `.orm.yaml` source);
  judged by a small assertion vocabulary against core primitives.

Assertion vocabulary, EARS-phrased:

- When a `build` attempt is judged, the judge shall verbalize the
  attempt and report each `mustVerbalize` sentence that has no match
  in the flattened verbalization text (whitespace- and
  case-normalized).
- When a puzzle declares `mustAccept` evidence, the judge shall bind
  the evidence to the attempt and report every diagnostic that
  population validation raises against it.
- When a puzzle declares `mustReject` evidence, the judge shall
  report a miss unless population validation raises a diagnostic
  whose `ruleId` matches the expected rule id.
- When evidence cannot be bound to the attempt, the judge shall
  return a `cannot-record` verdict naming the unbound fact row --
  rendered to the learner as "your schema cannot record this fact."

Evidence binding: puzzle evidence is a list of fact rows keyed by
object type name (`{Person: "Voss", Room: "Vault"}`). The judge binds
a row to the attempt fact type whose role players' object type names
match the row's key sequence; when two fact types share a player
sequence, the puzzle's canonical reading disambiguates against the
attempt's readings. A puzzle whose binding is still ambiguous is
rejected at authoring time by the certification suite (workstream 2),
never surfaced to a learner.

`mustVerbalize` sentences are stored in the puzzle file and generated
from the puzzle's canonical solution at authoring time; the
certification suite regenerates them in CI and fails on drift, so a
verbalizer change cannot silently strand content.

## Curriculum map (prologue, five chapters)

The framing is a prequel to the mystery arc: the learner is a records
clerk filing facts about the institute; the records filed here become
the evidence corpus of the mystery season.

| Chapter | Skill                                                | Puzzle kinds  |
| ------- | ---------------------------------------------------- | ------------- |
| 1       | elementary facts; splitting compound sentences       | choice, build |
| 2       | entity vs value types; reference schemes             | choice, build |
| 3       | fact type readings, inverses, unaries                | build         |
| 4       | arity: one ternary vs two binaries, shown with data  | choice, build |
| 5       | uniqueness and mandatory in verbal form (the bridge) | choice        |

Chapter 4's demonstration (splitting a ternary loses information --
rejoining the halves fabricates facts) uses a small pure join helper
in `tutor` over bound populations; the spurious rows it produces are
the feedback.

## Workstreams (each independently shippable)

### 1. Package scaffold, puzzle format, judge

The `@barwise/tutor` package: types, schema, loader, judge, binding,
progress reducer, tests. Pure functions only; `yaml` and `ajv` as the
only external deps, matching core. No host wiring yet; ships with
fixture puzzles exercising every assertion and binding edge.

### 2. Prologue content pack and certification suite

The five chapters as `.puzzle.yaml` files with canonical solutions,
plus a certification test that (a) judges every canonical solution
against its own puzzle and requires a pass, (b) regenerates
`mustVerbalize` from the canonical solution and diffs, and
(c) rejects ambiguous evidence binding. Content quality still needs a
human read; the suite guards mechanics, not prose.

### 3. CLI `barwise learn`

An interactive command over workstreams 1-2: pick chapter, present
puzzle, accept an answer or a model file, print the verdict, persist
progress JSON in the CLI workspace directory. No new core surface.

### 4. MCP tutor tools (provisional: not yet grounded)

`tutor_list_puzzles`, `tutor_get_puzzle`, `tutor_judge_attempt`
following the existing tool conventions (`source` param handling,
text content results, direct-handler tests per
`packages/mcp/CLAUDE.md`). Stateless: progress stays client-side.
Grounding before implementation should confirm the tool-surface
conventions against `tool-surface-redesign.spec.md`.

## API and migration impact

- New workspace package `@barwise/tutor`; `cli` and `mcp` add it as a
  dependency. The dependency graph in the root CLAUDE.md gains one
  node (`tutor` depends on core only).
- No core export changes; no existing package's API moves.
- Turborepo picks the package up from the workspace glob; CI runs its
  vitest suite like any other package.

## Open decisions (for review)

- **Package name.** `tutor` vs `curriculum` vs `academy`. Recommend
  `tutor`: shortest accurate name, leaves `curriculum` free for a
  future content-only package if content outgrows the code.
- **Where progress persists.** Recommend: `tutor` exposes the pure
  reducer only; `cli` persists JSON in its workspace dir; `mcp` stays
  stateless. Keeps the package deterministic and hosts free to differ.
- **Stored vs derived `mustVerbalize`.** Recommend stored in the
  puzzle file with CI regeneration (explicit over implicit: a puzzle
  file is self-contained and reviewable without running the
  verbalizer).
- **Chapter 4 join helper location.** Recommend `tutor` (it is pure);
  the alternative -- precomputed spurious rows as content -- hides
  the mechanism the chapter exists to teach.

## Risks and testing

- Verbalizer drift breaking content: caught by the certification
  suite on every build, since `tutor` compiles against core.
- Binding ambiguity in authored content: caught at certification
  time; the learner-facing judge never guesses.
- The judge is the contract both arcs share; its tests are the
  regression floor for the mystery spec. Target core-level coverage
  (95%+) for `src/judge/`.
- Tripwire: if a chapter needs a puzzle kind beyond `choice` and
  `build`, or binding needs a third disambiguator beyond player
  names plus readings, the format is under-specified -- stop and
  revise this spec rather than special-casing content.

## Non-goals

- No LLM surface of any kind in this spec.
- No streaks, badges, leaderboards, or spaced repetition; progression
  is linear chapter order in v1.
- No change to core, no new core capability.
- No VS Code integration.
