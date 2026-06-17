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
root. (Spec: `docs/specs/core-subpath-exports.spec.md`.)

## Commands

```sh
npx vitest run              # run tests
npx vitest run --coverage   # run tests with coverage
npx tsc --noEmit            # type-check only (no output)
```

Lint is run from the repo root: `npm run lint`.

## Key Conventions

- Every model element has a UUID assigned at creation via
  `node:crypto.randomUUID()`. Never add the `uuid` npm package.
- Constraint types use discriminated unions with type guard functions
  (`isInternalUniqueness`, `isMandatoryRole`, etc.) rather than class
  hierarchies.
- `OrmModel` is the root aggregate for a single-domain model.
  `OrmProject` is the root aggregate for multi-domain projects.
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
