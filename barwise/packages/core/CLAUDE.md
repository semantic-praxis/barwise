# @barwise/core

Platform-independent ORM 2 metamodel, validation, verbalization,
serialization, and relational mapping. This is the foundational package
of the Barwise monorepo -- every other package depends on it.

## Dependency Rule

This package has ZERO runtime dependencies on VS Code or any other
editor/platform API. It must remain consumable by CLI tools, CI
pipelines, and test harnesses without launching an editor.

Allowed runtime dependencies: `yaml`, `ajv`. No others without
discussion.

## Package Layout

```
src/
  model/          Metamodel classes (ObjectType, FactType, Role, Constraint, etc.)
  serialization/  YAML round-trip (.orm.yaml, .map.yaml, .orm-project.yaml)
  validation/     Rule-based validation engine and rule sets
  verbalization/  FORML verbalization of fact types and constraints
  mapping/        Relational mapper (ORM -> tables/columns/keys) and DDL renderer
  diff/           Model diffing and three-way merge
  index.ts        Root public API: foundational only (model, serialization,
                  validation, format registry, import/export types)

schemas/          JSON Schema definitions (orm-model, context-mapping, orm-project)
tests/            Mirrors src/ structure; see testing section below
```

The capability modules are exposed as package subpath exports, not from
the root barrel: `@barwise/core/mapping`, `/diff`, `/verbalization`,
`/counterexample`, `/sql`, `/annotation`, `/lineage`, `/describe`, and
`/query`. Each has a `src/<name>/index.ts` barrel listed in
`package.json` `exports`. Import a capability from its subpath; import
the metamodel, serializers, validation, and the format registry from the
root. (Spec: `docs/specs/archive/core-subpath-exports.spec.md`.)

## Commands

```sh
npx vitest run              # run tests
npx vitest run --coverage   # run tests with coverage
npx tsc --noEmit            # type-check only (no output)
```

Lint is run from the repo root: `npm run lint`.

**The mutation score is taken by hand, not by a dependency.**
`stryker.conf.json` and `vitest.mutation.config.ts` are committed so the
number is reproducible, but Stryker is deliberately NOT in
`package.json` -- it pulls 126 transitive packages for a tool run a few
times a year, which `docs/specs/supply-chain-hardening.spec.md` makes a
decision rather than a detail (`docs/specs/test-quality.spec.md`, Open
decision 1). Install it transiently and run it from this directory:

```sh
npm install --no-save @stryker-mutator/core@9 @stryker-mutator/vitest-runner@9  # from barwise/
npx stryker run                                    # from this directory
npx stryker run --mutate 'src/mapping/RelationalMapper.ts'   # one file
npm ci                                             # from barwise/, to restore
```

**Not `npx --yes @stryker-mutator/core@9 ... stryker run`**, which is
what this file used to say and what nobody had run. It fails: Stryker's
tsconfig preprocessor does a bare `import("typescript")`, and from an
npx cache directory that resolves to nothing --
`ERR_MODULE_NOT_FOUND: Cannot find package 'typescript'`, after
instrumenting every mutant. `--no-save` is the working form, and it
leaves `package.json` and `package-lock.json` untouched; `npm ci`
restores `node_modules`.

That matters for the open decision rather than being a detail of it. The
argument for staying off the dependency list was that `npx` made a
devDependency unnecessary, and it does not: the real alternative is a
transient install that resolves the 126 packages FRESH FROM THE REGISTRY
each time, outside the lock. Locked-and-listed against unlocked-and-
transient is a different trade-off from the one recorded, and
`docs/specs/supply-chain-hardening.spec.md` is the frame for it
(barwise-994).

Last taken 2026-09-10 over `src/diff` and `src/mapping`: 2,479 mutants,
**75.39%**, 16m12s at concurrency 4. The same files carry 99.5% line
coverage, which is the gap the score exists to show. `RelationalMapper.ts`
alone, re-measured after the barwise-993 triage kills: 468 mutants,
**79.91%**, up from 79.27% -- 90 survivors where there were 93. The separate
`vitest.mutation.config.ts` exists because Stryker sandboxes the working
directory and the shared root config cannot resolve `../../` from inside
a sandbox. It is listed in `knip.json`'s ignore for this package
because `stryker.conf.json` names it as a string rather than importing
it, so knip sees an unused file where there is a live edge.

## Key Conventions

- Every model element gets a UUID default id at creation via
  `generateId()` (`src/model/id.ts`): v4 `randomUUID()` unless a
  surface entry point installed the UUIDv7 generator (see
  `docs/specs/archive/uuid7-identifiers.spec.md`). Never add the `uuid` npm
  package; the v7 bit layout is core's pure `uuidv7FromParts`.
- Constraint types use discriminated unions with type guard functions
  (`isInternalUniqueness`, `isMandatoryRole`, etc.) rather than class
  hierarchies.
- `OrmModel` is the root aggregate for a single-domain model.
  `OrmProject` is the root aggregate for multi-domain projects.
- **A population declares whether it is a sample.** `Population.sample`
  (default false) separates a _significant_ population -- tuples a
  modeller chose to check a rule against, complete for its fact type --
  from an illustrative one. The semantics is one sentence: **a sample is
  positive evidence only.** It can satisfy a constraint but never
  creates the obligation that one be satisfied. Mechanically, sample
  instances are excluded from `buildObjectUniverse` and still counted by
  `valuesPlayedInRole`, which is the whole of the open-world story: the
  rules that fail on _absent_ data (mandatory, disjunctive mandatory,
  cardinality, spanning, join paths) all reach existence through that
  one function, while the rules that fail on data _present_ (uniqueness,
  exclusion, value and ring constraints) read populations directly and
  are untouched. Do not exclude samples from `valuesPlayedInRole` -- that
  inverts the asymmetry and makes the rule punish evidence for existing.
  LLM extraction marks its populations as samples; a transcript names
  far more entities than it gives complete facts about
  (`docs/specs/sample-populations.spec.md`).

  That split answers "does this rule need data to be PRESENT", and it is
  the wrong question for a partial population. A subset or equality
  constraint reads populations directly, so it is present-data, and it
  fires when the partner fact type is empty -- which is why counterexample
  generation splits on LOCALITY (does the rule reach a fact type this
  population left empty) rather than on this
  (`docs/specs/counterexample-stray-rules.spec.md`).
- Serialization round-trips must be lossless. Any new model field must
  have a corresponding serialization path and a round-trip test.
- JSON Schemas in `schemas/` are first-class artifacts used for file
  validation on load, editor autocomplete, and LLM output constraint.
  Keep them in sync with the serializers.

## Testing

- Framework: Vitest
- Test files live under `tests/`, mirroring `src/` structure.
- Use `ModelBuilder` (`tests/helpers/ModelBuilder.ts`) to construct
  test fixtures. It provides a fluent API for building models without
  boilerplate. Read and understand ModelBuilder before writing tests.
- Integration tests live under `tests/integration/` and exercise
  cross-module flows (round-trip, multi-file project, full pipeline).
- Coverage targets: model 95%+, validation 95%+, serialization 95%+,
  verbalization 90%+, mapping 90%+.

## Downstream Dependents

- `@barwise/diagram` -- imports model types to convert to graph layout
- `@barwise/llm` -- imports model types and serializers to produce draft models
- `barwise-vscode` -- imports everything (model, validation, verbalization,
  serialization, mapping)

Changes to exported types or behavior in this package can break all
downstream packages. Run the full monorepo build (`npm run build` from
root) and test suite after changes to the public API.
