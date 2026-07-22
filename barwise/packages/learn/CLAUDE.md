# @barwise/learn

Learning artifacts for ORM, built on top of `@barwise/core`. The first
capability is the **modeling gym**: an exercise format and a
deterministic evaluator that grades a learner's candidate `.orm.yaml`
against a rubric of semantic checks. The guided tutorial (a sibling
learning artifact) is planned to live here too.

Specs: `docs/specs/modeling-gym.spec.md`, `docs/specs/modeling-tutorial.spec.md`.

## Dependency Rule

Depends only on `@barwise/core` (via its published root and subpath
exports) and `yaml`. ZERO dependency on VS Code or any editor/platform
API. `@barwise/diagram` may be added later for the tutorial's per-step
SVGs. Nothing in the monorepo depends on this package; it is a leaf.

## Package Layout

```
src/
  exercise/       Exercise format: types, the pure parser (parseExercise),
                  and the fs loader (loadExercise, resolves reference/starter models)
  evaluate/       The evaluator (evaluateCandidate) and its check runners
    checks/       mustValidate, requiresVerbalization, requiresElement, forbidsPopulation
    populationMapping.ts   Maps a reference forbidden population onto a candidate
  index.ts        Public API barrel (single "." export)

schemas/          gym-exercise.schema.json (editor autocomplete for .gym.yaml)
exercises/        Seed catalog: *.gym.yaml plus reference *.orm.yaml
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
- **Reference models double as exercise answer keys.** A well-formed
  exercise's reference model should pass its own rubric (there is a test
  for the seed exercise asserting exactly this).

## Commands

```sh
npx vitest run              # run tests
npx vitest run --coverage   # tests with coverage
npx tsc --noEmit            # type-check
```

Lint and format run from the repo root (`npm run lint`, `npm run fmt`).
