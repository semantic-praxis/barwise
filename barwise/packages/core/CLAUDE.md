# @barwise/core

Platform-independent ORM 2 metamodel, validation, verbalization,
serialization, and relational mapping. This is the foundational package
of the Barwise monorepo -- every other package depends on it.

## Dependency Rule

This package has ZERO runtime dependencies on VS Code or any other
editor/platform API. It must remain consumable by CLI tools, CI
pipelines, and test harnesses without launching an editor.

Allowed runtime dependencies: `yaml`, `ajv`, and `effect`, pinned to an
exact version (`tests/effectVersion.test.ts` fails a range, and any other
workspace package that declares it at a different version). No others
without discussion: the list is `barwise/scripts/lib/external-deps.cjs`,
and `check:architecture` fails a runtime dependency it does not name
(`docs/adr/package-graph-authority.md#core-external-deps`). `effect` arrived with the decoders in `src/decode/`
(`docs/specs/effect-adoption.spec.md`, 1r, R1), and since R4 the 3.0
loader reads every file through them alone. The barrel exports the
serializer, which imports them, so loading core loads Effect, whether or
not a file is read (R4's S5 reading has the cost). `ajv` stays for the
2.0 reader, which validates against the frozen
`schemas/orm-model-2.0.schema.json` (Open decision 13). Core's barrel does
not export the decoders.

## Package Layout

```
src/
  model/          Metamodel classes (ObjectType, FactType, Role, Constraint, etc.)
  serialization/  YAML round-trip (.orm.yaml, .map.yaml, .orm-project.yaml)
  validation/     Rule-based validation engine and rule sets
  verbalization/  FORML verbalization of fact types and constraints
  mapping/        Relational mapper (ORM -> tables/columns/keys) and
                  constraint routing: what the schema realized, and what a
                  dialect adds as UNIQUE/CHECK or spills as a ConstraintSpec.
                  Format renderers live in their connectors
                  (docs/adr/connector-packages.md#format-in-its-connector).
  decode/         Effect Schemas and decoders for the 3.0 file format, with
                  the cross-field harness; the 3.0 loader reads files
                  through them alone (effect-adoption R4)
  diff/           Model diffing and three-way merge
  rename/         Renaming an element: renameInModel, and renameInProject with
                  its cascade into shadows, reference modes, definitions and
                  mapping files
  index.ts        Root public API: foundational only (model, serialization,
                  validation, format registry, import/export types)

schemas/          JSON Schema definitions (orm-model, context-mapping, orm-project)
tests/            Mirrors src/ structure; see testing section below
```

The capability modules are exposed as package subpath exports, not from
the root barrel: `@barwise/core/mapping`, `/diff`, `/verbalization`,
`/counterexample`, `/sql`, `/annotation`, `/lineage`, `/describe`,
`/query`, and `/rename`. Each has a `src/<name>/index.ts` barrel listed in
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

**Not `npx --yes @stryker-mutator/core@9 ... stryker run`.** It fails: Stryker's
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

- An element's id is a local name, never a random one
  (`docs/specs/iri-identity.spec.md`, decision 13). A model names what it
  is given: an object type or fact type from its name, a role
  `<fact type>.<role>`, a constraint, subtype fact or objectification
  from its sentence. An element built outside a model takes the same id
  from its name (`ModelElement`, `createObjectType`, `Population`'s
  `<fact type>.population`), and a constraint there keeps the id it is
  given or none. Core mints no random id and reads no clock:
  `generateId`, `setIdGenerator` and the UUIDv7 factory retired with
  WS6's 6b-4b, so an importer leaves ids to the model. `formatUuid`
  (`src/model/id.ts`) remains for `derivedId`'s v8.
- **A constraint id a file omits is derived, not minted.** On load,
  `serialization/derivedId.ts` gives an id-less constraint a UUIDv8 hashed
  from its fact type id and its content, so one unchanged file always loads
  to the same ids (`docs/specs/orm-format-3.spec.md`, WS2 and WS3). A
  constraint added in code is named by the model from its sentence, or
  left unnamed when the sentence cannot be built (decision 19); one built
  outside a model keeps the id it is given or has none, so `c.id` is never
  safe to assert. Do not move the derivation into `FactType`'s
  constructor: it runs per fact type and cannot see the ids the rest of
  the file states.
- **Where a constraint lives is decided by its kind, in one table.**
  `PLACEMENT` in `model/Constraint.ts` classifies every kind as internal
  (it lives in its fact type; every role is one of its roles) or external
  (it lives in the model; its roles may span fact types).
  `InternalConstraint`, `ExternalConstraint` and the
  two guards all derive from it. Read through `FactType.internalConstraints`,
  `OrmModel.constraints`, `OrmModel.constraintsTouching` (or
  `constraintsTouchingAny` for a view of several fact types, which says a
  constraint spanning two of them once, and `everyConstraint` for the whole
  model) and
  `OrmModel.getConstraint`. Since WS3c the model stores the external kinds
  (`OrmModel.addConstraint`); a fact type holds only its own, and a
  save writes format 4.0, which lists the external ones in
  `model.constraints`, as 3.0 did (`docs/specs/orm-format-3.spec.md`, WS3 and WS4). `FactType.addConstraint`
  and `FactTypeConfig.constraints` take the internal kinds only, pinned by
  `tests/types/constraintPlacement.test-d.ts`, and refuse an external one at
  run time as well, for a value whose type was asserted: one stored there
  would be invisible to every reader of the model's constraints. The 2.0
  loader is the one place that still sees both kinds under a fact type,
  and it splits them after deriving ids.
- **An entity names its preferred identifier; nothing infers it.** The
  model stores a constraint id per entity (`OrmModel.preferredIdentifierOf`,
  written as `preferred_identifier` since 3.0), and every reader asks
  `preferredIdentifiers(model)`, which keeps a reference only when
  `resolvePreferredIdentifier` says the constraint identifies that entity.
  The 2.0 `is_preferred` flag is read once, by `readDocument20` and the
  llm parser through `storePreferredFlags`; do not add a reader that
  looks for a flag, because no constraint carries one any more. A file
  below 3.0 is read by the 2.0 reader against the frozen
  `schemas/orm-model-2.0.schema.json`, a 3.0 file by the frozen 3.0
  decoders, and either is replayed into format 4.0's ids
  (`serialization/replay.ts`) and saved as 4.0. The model keeps the 3.x ids
  in memory (`priorIds`, `idFromPrior`) for diff and for a 3.x-era
  reference from another file (a tutorial step, a lineage export).
- **A held id is refused, not replaced.** The five id-keyed stores
  (object types, fact types, subtype facts, objectifications,
  populations) are `Map`s, and `set` overwrites without a word, so each
  `add*` checks first and throws `DuplicateIdError`, whatever
  `skipPlayerValidation` says: that option skips checks on what an element
  references, and this is a check on the store. Both readers convert it to
  a `DeserializationError`. Do not catch it to drop the second element; an
  importer that trips it was already losing one
  (`docs/specs/model-invariants.spec.md`, WS3). Merge's pre-checks ask
  `canAddSubtypeFact` and `canAddObjectifiedFactType`, which read the
  same refusal `add*` throws for the pair, rather than restating it; the
  id is the caller's to choose, as merge does when it takes a fresh one.
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
- JSON Schemas in `schemas/` are first-class artifacts, read by editors
  and by LLM clients through the MCP server. A 4.0 file is validated on
  load by the decoders in `src/decode/`, not by `orm-model.schema.json`, so
  the two are copies that must agree: each decoder has a drift test against
  the schema (`tests/decode/*SchemaDrift.test.ts`), until WS1b part C
  generates the file from the Schemas. Keep both in sync with the
  serializers. The frozen 2.0 schema still validates a 2.0 file on load;
  the frozen `orm-model-3.0.schema.json` keeps its own drift tests against
  the 3.0 decoders, which still read a 3.0 file.

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

Every other package in the monorepo depends on this one; `INTENDED`
in `barwise/scripts/lib/intended.cjs` is the authoritative list, and
the root CLAUDE.md graph is checked against it.

Changes to exported types or behavior in this package can break all
downstream packages. Run the full monorepo build (`npm run build` from
root) and test suite after changes to the public API.
