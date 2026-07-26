# @barwise/learn

Learning artifacts for ORM, built on top of `@barwise/core`. Two
capabilities live here: the **modeling gym** (an exercise format and a
deterministic evaluator that grades a learner's candidate `.orm.yaml`
against a rubric of semantic checks) and the **tutorial** (a step
format, loader, and deterministic renderer that turns authored CSDP
walkthroughs plus model snapshots into the committed Markdown under
`docs/tutorial/`, with generated counterexample motivations).

Specs: `docs/specs/modeling-gym.spec.md`, `docs/specs/modeling-tutorial.spec.md`.

## Dependency Rule

Depends only on `@barwise/core` (via its published root and subpath
exports) and `yaml`. ZERO dependency on VS Code or any editor/platform
API. `@barwise/diagram` may be added later for the tutorial's per-step
SVGs. `@barwise/cli` (`barwise gym`) and `@barwise/mcp`
(`gym_list`/`gym_check`) consume this package; it must never depend on
either.

## Package Layout

```
src/
  exercise/       Exercise format: types (C1 transition front matter, C6
                  guidance fields), the pure parser (parseExercise), the fs
                  loader (loadExercise), and catalog discovery (catalog.ts)
  evaluate/       The evaluator (evaluateCandidate) and its check runners
    checks/       mustValidate, requiresVerbalization, requiresElement, forbidsPopulation
    populationMapping.ts   Maps a reference forbidden population onto a candidate
  deck/           Miss-card emission (learning-design C6): pure mapping of a
                  GymReport's failures to Anki tab-separated import rows
  tutorial/       Tutorial format: types, pure parser (parseTutorial), fs
                  loader (loadTutorial), and the deterministic renderTutorial
  index.ts        Public API barrel (single "." export)

schemas/          gym-exercise.schema.json (editor autocomplete for .gym.yaml)
exercises/        Seed catalog: *.gym.yaml plus reference *.orm.yaml
tutorials/        Tutorial sources: *.tutorial.yaml plus per-step model
                  snapshots; rendered to docs/tutorial/ by regen:tutorial
tests/            Vitest; tests/helpers/ModelBuilder.ts (copied from @barwise/core)
```

## Key Conventions

- **The evaluator is pure.** `evaluateCandidate(candidate, exercise,
  reference?)` takes already-loaded `OrmModel`s and returns a `GymReport`
  with no I/O. All filesystem access lives in `loadExercise`. The same
  inputs always produce a byte-identical report.
- **Grade by semantics, not by diffing a reference model.** Checks reason
  about the candidate's verbalization and the populations its constraints
  forbid. A domain has many valid ORM models, so structural diffing would
  flag correct answers.
- **`forbids_population` is the keystone.** It derives the population a
  reference constraint forbids (via core's
  `generateCounterexampleForConstraint`), maps it onto the candidate by
  object-type name and role position (`populationMapping.ts`), injects it,
  and requires the candidate's own constraints to reject it. The candidate
  is mutated transiently and restored -- it is left unchanged.
  - Supported constraint kinds: `internal_uniqueness`, `mandatory`,
    `value`, `frequency`, `ring`. External uniqueness and set-comparison
    constraints are not yet supported by this check.
- **The tutorial renderer is pure and honest.** `renderTutorial` is a
  pure function (version stamped via an option, no clocks); a
  "counterexample" step's hook is generated from its model snapshot, and
  the render fails if the named constraint already exists in the prior
  step's model or any snapshot has validation errors. A drift test
  compares `docs/tutorial/*.md` against a fresh render; regenerate
  intentionally with `npm run regen:tutorial` (repo root, after build).
- **Reference models double as exercise answer keys.** A well-formed
  exercise's reference model should pass its own rubric (there is a test
  for the seed exercise asserting exactly this).
- **Exercises declare a transition, not a difficulty.** The C1 front
  matter (`transition: {from, to}` on the proficiency scale plus
  `exitPerformance`) replaced the old three-value `difficulty` enum;
  the parser rejects `difficulty` with a migration message. Checks may
  carry `hint`, `diagnosis`, and `reading` (learning-design C6).
- **Miss-card emission is pure.** `buildMissCards(exercise, report)` and
  `renderMissCardFile` are deterministic (no clocks, no randomness);
  the file write and the session log live in the `barwise gym` CLI, at
  the edge, homed at `$XDG_STATE_HOME/barwise/`.

## Commands

```sh
npx vitest run              # run tests
npx vitest run --coverage   # tests with coverage
npx tsc --noEmit            # type-check
```

Lint and format run from the repo root (`npm run lint`, `npm run fmt`).
