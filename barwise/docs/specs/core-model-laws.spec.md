# Laws over a generated model: property-based tests for core

Status: WS1 and WS2 implemented (the arbitrary, the serialization law,
the merge law and the barwise-937 fix; see Implementation notes).
WS3-WS5 not implemented.
Created: 2026-09-07
Last-updated: 2026-09-07
Tracking: barwise-938 (this spec); barwise-937 (the merge defect its
grounding found); follow-ups barwise-939, -940, -941 (found while
implementing WS1 and WS2); REPO_REVIEW-2026-06.md T4; the deferral
recorded in `conformance-property.spec.md` ("the core arbitrary
question stays open until someone brings a property that earns it")

In one sentence: add fast-check to core, generate structurally valid
`OrmModel`s from a seeded arbitrary, and assert five laws the existing
fixture tests state only by example -- serialization is idempotent,
merging nothing changes nothing, every counterexample trips its rule,
a sample population never creates an obligation, and the mapper's
foreign keys close over its own tables.

Two terms, used throughout. A _law_ is a statement that must hold for
every model, not for the one a test author built; the test checks it
against hundreds of generated models and reports the smallest one that
breaks it. An _arbitrary_ is fast-check's name for a generator of such
models: seeded, so the same seed yields the same models every run.

## Principle

Property-based testing is the payoff of determinism in core. Every
function the laws cover is pure: same model in, same output out, no
clock, no I/O, one `randomUUID()` for identity plumbing that
`hashModel` canonicalises away. Property-based testing needs exactly
that and rarely gets it. The conformance-property spec made the same
argument for one pipeline in `llm` and deferred the core question until
a property earned it.

The property that earns it arrived while grounding this spec. Merging
a model with itself and accepting nothing is the one merge where
nothing may change, so any change is loss; today it drops every
subtype fact and population the model carries (barwise-937). Nothing
in the suite sees this, for the same reason nothing saw barwise-927
(merge dropped six fields), barwise-934 (diff compared four fields
short) or barwise-931 (the mapper truncated composite keys to one
column). Each test asserts what its author put in the fixture, and
each defect is an omission: code that copies a model field by field or
kind by kind and misses some. A law over a generated model asserts
what must hold of every model, so an omission fails on the first model
that exercises it. Four such defects in this zone in two days (all
four fixes dated 2026-09-06), one still open, is the evidence trail.

This is also the formal-methods answer for this project: the
smallest method that reaches the defect class this repository actually
has. TLA+ and model checking exist for concurrent state machines and
core has none. Alloy would fit the validator as an oracle and is
deferred (see Alternatives). The recommendation Hillel Wayne (formal
methods consultant, on The Pragmatic Engineer podcast, 2026-07-29)
gives most teams -- property-based testing, then stop -- is the one
that fits.

## Should the laws wait for the sealed-record refactor? (resolved: no)

`core-branching-load.spec.md` proposes a builder, field tables, and a
typed diff. Those refactors need acceptance tests that say what must
not change, and fixtures cannot say it. The laws are those tests: land
them first against today's `OrmModel`, and each refactor keeps them
green. If the builder lands first, the arbitrary retargets it (Risks
and testing); the laws do not move. That spec's workstreams are
referred to by name here, never by number, because this spec numbers
its own.

## Scope

In scope, stated as requirements:

- When the suite runs, the system shall generate `OrmModel`s carrying
  no `structural/*` diagnostic from a seeded fast-check arbitrary under
  `packages/core/tests/arbitraries/`, with a fixed seed and run count
  so the verdict is the same on every run.
- When a generated model `m` is serialized, deserialized and serialized
  again, the system shall produce the same YAML text as the first
  serialization, and `hashModel` of the deserialized model shall equal
  `hashModel(m)`.
- When a generated model is deserialized from its own serialization,
  `toObjectTypeConfig` and `toFactTypeConfig` of every element shall
  deep-equal the originals' projections, ids aside, after the
  serializer's own normalisation (an empty `note`, `independent: false`,
  `sample: false` and a derivation's default storage all read back as
  absent). The hash alone cannot see this: `hashModel` hashes what the
  serializer writes, so a config field the serializer forgets is
  invisible to it. The projections are typed `Complete<Config>`, so the
  compiler makes them enumerate every field, and this clause fails the
  day a field is added to a config and not to its serializer.
- When a generated model is diffed against itself, every delta shall
  have kind `unchanged`; and when it is merged with itself over those
  deltas with an empty accepted set, the merged model's `hashModel`
  shall equal the original's.
- When `generateCounterexamples` runs over a generated model, each
  counterexample's forbidden populations, added to the model alone,
  shall produce a diagnostic with the rule id mapped from the
  counterexample's constraint type.
- When a sample population is added to a generated model, the set of
  diagnostics from the absent-data rules shall not grow. A sample is
  positive evidence only: it can satisfy a constraint but never creates
  the obligation that one be satisfied. The absent-data rules are the
  ones that create obligations, which in code means the rules that read
  `buildObjectUniverse` (mandatory, disjunctive mandatory, cardinality,
  the spanning set-comparison rules, join paths).
- When `RelationalMapper.map` runs over a generated model, it shall
  not throw, and every foreign key shall name an existing table whose
  primary key columns equal the key's referenced columns, in order and
  in count.
- When a property fails, the output shall carry the seed and the
  shrunk model, so one recorded value reproduces it.

Out of scope, deliberately:

- The `llm` extraction-response arbitrary. That is
  `conformance-property.spec.md`, unimplemented and untouched here; it
  generates malformed responses, this generates valid models, and the
  two share nothing but the dependency.
- Verbalizer totality, query, describe, lineage and DDL-render laws.
  Each is a candidate for a later workstream once the arbitrary exists;
  none has a defect trail yet.
- An Alloy or SMT oracle for the validator (Alternatives).
- Changing what `diffModels` reports for subtype facts, objectified
  fact types, populations and layouts, beyond what fixing barwise-937
  requires (Open decisions).

## Inventory

| Module                                                       | Current state                                                          | Verdict                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `core/package.json`                                          | devDependencies: vitest, coverage                                      | adds `fast-check` (WS1)                                   |
| `core/tests/arbitraries/model.ts`                            | does not exist                                                         | new: `arbOrmModel` and its parts (WS1)                    |
| `core/tests/laws/serialization.law.test.ts`                  | does not exist                                                         | new (WS1)                                                 |
| `core/tests/laws/merge.law.test.ts`                          | does not exist                                                         | new, red until barwise-937 is fixed (WS2)                 |
| `core/src/diff/ModelMerge.ts`, `ModelDiff.ts`                | three element kinds; drops the rest                                    | fixed per the open decision (WS2)                         |
| `core/tests/laws/counterexample.law.test.ts`                 | does not exist                                                         | new (WS3)                                                 |
| `core/tests/counterexample/CounterexampleGenerator.test.ts`  | one hand-built model-wide round trip; `RULE_BY_TYPE` at 486            | stays; `RULE_BY_TYPE` moves to a shared test helper (WS3) |
| `core/tests/laws/sample.law.test.ts`                         | does not exist                                                         | new (WS4)                                                 |
| `core/tests/laws/mapper.law.test.ts`                         | does not exist                                                         | new (WS5)                                                 |
| `core/src/lineage/manifest.ts` (`hashModel`)                 | id-insensitive content hash                                            | untouched; the laws' equality                             |
| `core/src/serialization/OrmYamlSerializer.ts`, `yaml/*.ts`   | `serialize` / `deserialize`; per-element field lists                   | untouched; the projection clause is their drift guard     |
| `core/src/model/ObjectType.ts`, `FactType.ts` (`to*Config`)  | `Complete<Config>` projections (barwise-927)                           | untouched; the projection clause reads them               |
| `core/src/counterexample/*`, `validation/rules/population/*` | pure over the model                                                    | untouched                                                 |
| `core/src/mapping/RelationalMapper.ts`                       | no throw sites; FK columns fixed in c185df6                            | untouched                                                 |
| `core/tests/integration/roundTrip.test.ts`                   | fixture round trips                                                    | stays: readable record of named cases                     |
| `core/tests/property/roundTrip.property.test.ts`             | 100 seeded models from a hand-rolled PRNG; a third `RULE_BY_TYPE` copy | both halves are subsumed; retires in WS3 (see below)      |
| `core/tests/helpers/randomModel.ts`                          | mulberry32 generator: binaries only, no populations, no subtypes       | retires with the test above (WS3)                         |
| `core/vitest.config.ts`                                      | `tests/**/*.test.ts`, 30s timeout                                      | untouched; `.law.test.ts` matches the glob                |

Nothing outside core changes. The `llm` package's own property spec
stays independent; `cli`, `mcp` and `vscode` call `mergeAndValidate`
and gain the barwise-937 fix through the build, with no signature
change.

## Target architecture

```ts
// core/tests/arbitraries/model.ts (test code only)

/** Seeded, size-bounded, structurally valid by construction: built
 *  through OrmModel's own add* methods (which refuse an entity type
 *  without a reference mode and a reading without its placeholders),
 *  then filtered by structuralRules so no generated model carries a
 *  structural/* error. Reaches every element kind and every constraint
 *  kind, and every optional field barwise-927 and -934 dropped. */
export function arbOrmModel(): fc.Arbitrary<OrmModel>;

/** A population whose tuples type-check against one of the model's
 *  fact types; `sample` is the caller's choice. */
export function arbPopulationFor(
  model: OrmModel,
): fc.Arbitrary<PopulationConfig>;

export const SEED = 20260907;
export const RUNS = 250;

// core/tests/laws/merge.law.test.ts

it("merging nothing changes nothing", () => {
  fc.assert(
    fc.property(arbOrmModel(), (m) => {
      const { deltas } = diffModels(m, m);
      expect(deltas.every((d) => d.kind === "unchanged")).toBe(true);
      const merged = mergeModels(m, m, deltas, new Set());
      expect(hashModel(merged)).toBe(hashModel(m));
    }),
    { seed: SEED, numRuns: RUNS },
  );
});
```

The equality is `hashModel` throughout. YAML constraints carry no id
(`core-branching-load.spec.md`, inventory), so parse-of-serialize is
not object identity and never will be; `hashModel` already exists to
say "same content, whatever the ids", and the laws inherit that
definition rather than inventing a second one.

## Alternatives considered

- **Extend the fixtures.** Add a subtype fact and a population to the
  merge fixture. This closes barwise-937 and reopens the pattern the
  last four fixes followed: each closed one instance and left the
  class. The mapper's composite-key defect needed an objectified
  supertype, which no fixture had thought to include.
- **An Alloy translation as a validator oracle.** ORM populations
  under constraints are relational logic, Alloy's native domain, and a
  solver could find satisfying and violating populations to compare
  against the validator and the counterexample generator. It would
  live outside core (a solver is I/O and not deterministic) in the
  shape of the optimizer lane. Deferred: it needs an `.orm.yaml` to
  Alloy translation before it tests anything, and the laws here reach
  the defect class that has actually occurred at a fraction of the
  cost. Revisit if the validator's pairwise `constraintConsistency`
  rules accumulate their own escape trail.
- **TLA+ for the VS Code extension or MCP server.** No shared mutable
  state across concurrent actors was found; `checkStaleness` is
  check-then-act but single-process. Not pursued.
- **Generate through `ModelBuilder`.** The builder's fluent API names
  elements by string and mints deterministic ids, which is convenient
  for authored tests and a second layer to shrink through for
  generated ones. The arbitrary builds through `OrmModel` directly and
  shrinks on the config objects it passes.
- **A shared arbitraries package.** Rejected by the conformance spec
  until a second consumer exists; the core arbitrary generates models,
  not responses, so it is not that consumer either.

## Workstreams (each independently shippable)

### 1. The arbitrary and the serialization law

Add `fast-check` to core's devDependencies. Build `arbOrmModel` under
`core/tests/arbitraries/model.ts`: object types of both kinds with
every optional field, fact types of arity one to three with readings
carrying the right placeholders, constraints of every kind the model
admits, subtype facts, objectified fact types, populations both
significant and sample, definitions and a diagram layout, all with
small size bounds. Ship the serialization law with it, both clauses (text idempotence
and projection equality), so the generator is exercised by a law from
its first commit. The projection clause needs a normaliser in the test
that applies the serializer's own conflations to the original config
before comparing; keep it beside the arbitrary, and keep it to the
four conflations named under Scope, so a fifth one added to the
serializer fails the law instead of being absorbed.

Acceptance, in EARS form: when the generator runs for the fixed
count, the system shall have produced at least one model with an
objectified supertype, one with an `independent` object type, one with
a ternary fact type, and one with a sample population. This is the
coverage guard: a generator that never reaches the shapes the recorded
defects lived in has proved nothing. Record the counts in the test as
assertions, not as a comment. The mutation checks (revert a recorded
fix locally, expect the law to go red) belong to the workstreams whose
laws they exercise: WS2 for barwise-927, WS5 for barwise-931.

The workstream ships `arbModelPlan` (generation) and `buildModel`
(construction) as separate exports, so retargeting the sealed-record
builder touches one function.

### 2. The merge law, red first, and the barwise-937 fix

Land the merge law failing, then the fix in the same PR. The law
states the whole requirement: merging nothing changes nothing. The fix
shape is the first open decision. Acceptance is a mutation check, run
once by hand and recorded in the PR body, never committed: when the
`toObjectTypeConfig` projection is locally reverted to the
pre-barwise-927 hand-copied literal, the merge law shall fail within
the fixed run count (the assertion-audit skill's "mutation kill").
Add the accept-all law only if it holds after the fix; it is drafted
below as provisional.

Provisional: when every `added` and `modified` delta is accepted and
every `removed` delta is accepted, `diffModels(merged, incoming)` shall
report only `unchanged` deltas. Grounding needed: whether `mergeModels`
keeping `existing.name` and `domainContext` makes this false by
construction, in which case the law compares element sets only.

### 3. The counterexample law

Generalise the model-wide round-trip test in
`CounterexampleGenerator.test.ts` to generated models. Move
`RULE_BY_TYPE` to a helper both tests import so it is one copy. The
existing test stays as the readable record of a constraint-rich model;
the law asserts the same thing over every model the generator reaches.

### 4. The sample-population law

For a generated model and a generated sample population over one of
its fact types: the diagnostics whose rule ids are in the absent-data
set (defined under Scope) must not grow. The set as written in the
test is a copy that must agree with which rules read
`buildObjectUniverse`, so it is guarded per the second open decision,
in this workstream.

### 5. The mapper laws

Totality: `map` does not throw on any generated model. Referential
closure: every foreign key's `referencedTable` names a table in the
schema, its `referencedColumns` equal that table's primary key
`columnNames` in order, and its `columnNames` has the same length.
Column names are unique within each table. The composite-key defect
barwise-931 fixed is a one-line violation of the second clause; the
mutation check for this workstream reverts c185df6's
`appendForeignKeyColumns` locally, once, and expects the law to fail.

## API and migration impact

- No public API changes. One new devDependency, `fast-check`, in core
  only; under the no-trivial-dependencies rule it qualifies as ajv and
  yaml do (generation, shrinking and seed management are not in Node
  core).
- WS2 changes the behaviour of `mergeModels` for every caller: subtype
  facts, objectified fact types, populations and layouts survive a
  merge. `cli`, `mcp` and `vscode` need no code change. Run the full
  monorepo build and test after WS2 (the stale-dist trap).
- Coverage thresholds are unaffected: the laws add tests, not source.

## Open decisions (for review)

- **Shape of the barwise-937 fix.** Option A: `mergeModels` carries the
  four missing element kinds through from `existing` unchanged, and
  `diffModels` stays at three kinds. Minimal, no data loss, and an
  incoming model's new subtype facts still never merge in; that gap
  is filed as a follow-up. Option B: `diffModels` emits deltas for all
  seven kinds and `mergeModels` applies them, which is the typed diff
  `core-branching-load.spec.md` proposes and a much larger change.
  Recommend A now, with the follow-up issue naming B, so the merge law
  goes green in one PR and the typed diff inherits a law instead of a
  fixture.
- **Guarding the absent-data rule set (WS4).** The set of rules that
  call `buildObjectUniverse` is restated in the test. Option A: derive
  it, by having each rule module export a marker the test reads.
  Option B: enumerate it in the test and register the pair in
  `parity.manifest.json`. Option C: assert the stronger law instead,
  that adding a sample population adds no diagnostic at all, and
  generate sample tuples that satisfy every present-data constraint,
  which is expensive. Recommend B: one manifest row, no production
  marker, and the parity check fails when a rule starts or stops
  reading the universe.
- **Seed and run count.** Adopt the conformance spec's resolved
  policy: fixed seed, 250 runs, both named constants, lowered only on
  a measured CI regression. Listed here so the reviewer can object,
  not because it is open.

## Risks and testing

- A generator that is too tame passes every law and proves nothing.
  WS1's coverage assertions and the two manual mutation checks (WS2
  for 927, WS5 for 931) are the guard; the
  generator earns trust on recorded defects before it is trusted on
  unknown ones.
- Shrinking a large model on failure can stall CI. Every collection
  arbitrary carries a small upper bound; the recorded defects all
  reproduce in models of three object types and two fact types.
- The merge law is red on its first run against today's `mergeModels`
  (barwise-937). WS2 lands the law and the fix together so main never
  carries a red law.
- If the sealed-record builder from `core-branching-load.spec.md`
  lands before this spec's WS1, the arbitrary targets the builder
  instead of `OrmModel.add*`; the laws are unchanged.
- If a law fails on a case the reviewer judges correct behaviour, the
  law is wrong, not the code: rewrite the law and record why in this
  spec.
- The serializer's field lists (`yaml/objectType.ts`, `yaml/factType.ts`,
  `yaml/population.ts`) are copies of the config interfaces with no
  parity entry and no test comparing them. The projection clause of the
  serialization law is the drift guard this spec supplies; until WS1
  lands, a field added to a config and missed by its serializer is
  dropped on save with nothing failing.
- The full existing suite stays green through every workstream;
  no fixture test is removed. Each workstream is one PR, followed by
  `npm run build` and `npm run test` from `barwise/`.

## Implementation notes

### WS1 (2026-09-07)

- **The generator avoids unnamed conflations rather than normalising
  them.** The serializer collapses more defaults to absence than the
  four Scope names: `isPreferred: false`, `modality: "alethic"`,
  `isFormal: false`, an empty `ranges` array, and `minInclusive: true`
  all read back as absent. Normalising those too would have made the
  law blind to five more places a field can be dropped, so the
  generator emits only the non-default half of each, and the four the
  spec names are the only ones `normalise.ts` knows about. A fifth
  conflation added to the serializer fails the law.
- **The `sample: false` conflation is asserted directly.** It lives on
  `Population`, which neither `toObjectTypeConfig` nor
  `toFactTypeConfig` reaches, so the projection clause cannot see it.
  The law asserts it on the round-tripped populations instead, which
  keeps the fourth rule live rather than dead in the normaliser.
- **A frequency constraint's `min` is lifted to 1, not dropped.** The
  first run of the law reported a generated zero failing
  deserialization, as designed. The generator is not choosing between
  two readings: every layer but the TypeScript type rejects zero. The
  JSON Schema requires `minimum: 1`, `constraintConsistency` reports
  `constraint/frequency-invalid-min` as an error, and barwise-830
  settled the semantics already -- "at least 0" is no constraint at
  all, because the population rule counts only the value-tuples that
  appear and every such count is at least 1. A zero minimum does not
  express an optional role; optionality is the absence of a mandatory
  constraint, an orthogonal axis, and `0..1` and `1..1` are the same
  frequency. So the generator emits valid models, which is its job.
  The divergence is nonetheless a real defect -- a min-0 model
  serializes and then fails to load, so barwise writes a file it
  cannot read -- and per this spec's own non-goal it is filed rather
  than fixed here: barwise-942, p3, since the validator and
  conformance cover every production path. Whether the floor is
  Halpin's rule or a tooling default this project carried is
  barwise-q82, open, and it governs which side the fix moves.
- **Re-grounding found an Inventory omission**, not a moved `main`:
  `tests/property/roundTrip.property.test.ts` already asserted the
  serialization round trip and the counterexample round trip over 100
  models from a hand-rolled mulberry32 generator
  (`tests/helpers/randomModel.ts`). Both halves are subsumed -- the
  serialization half by WS1, the counterexample half by WS3 -- and both
  are left standing until WS3 retires them together with the third
  `RULE_BY_TYPE` copy they carry. WS1 therefore lands a duplicate
  round-trip assertion on purpose, over a strictly stronger generator.

### WS2 (2026-09-07)

- **Option A, as recommended.** `mergeModels` carries subtype facts,
  objectified fact types, populations and diagram layouts through from
  the existing model; `diffModels` still emits three element kinds.
  Option B is filed as barwise-940 and inherits the merge law rather
  than a fixture.
- **The model-level `note` was dropped too.** The defect was recorded
  as four missing element kinds; it was four kinds and a field, because
  `mergeModels` constructs its result with a literal naming `name` and
  `domainContext` only. The identity law caught it on the first
  generated model that carried a note, which is the same omission shape
  one level down from barwise-927.
- **Carrying is not unconditional.** An element whose referent the
  merge removed is dropped: `OrmModel` throws on a subtype fact naming
  an absent entity, and a throw inside `mergeModels` loses the whole
  merge, since `mergeAndValidate` catches it and returns a null model.
  An accepted removal is a decision to remove, so dropping what
  depended on it is the merge obeying the user. An accepted
  modification that turns an entity type into a value type has the same
  effect on a subtype fact naming it.
- **The accept-all law is false as drafted, and ships in the spec's own
  fallback shape.** Measured over 60 generated model pairs, accepting
  every delta left a residual delta in 50 of them, always `modified
  object_type ["aliases changed"]` and never anything else; the element
  sets matched in all 60. The cause is `unionAliases`, which is
  deliberate. So the law asserts the element sets and then states the
  exception exactly -- every residual delta is that one -- rather than
  being weakened to element sets alone. A second divergence appearing
  later fails the second clause.
- **The fix surfaced a smaller defect it did not introduce the shape
  of.** A population carried past an accepted fact-type modification
  keeps the existing role ids while the merged fact type takes the
  incoming ones, so its instances read as incomplete. Before the fix
  the population vanished silently; now it survives and is wrong,
  visibly. Filed as barwise-941, blocked on barwise-940, which is where
  the remap belongs.
- **The idempotence law found a performance defect and did not fix
  it.** `hashModel` constructs an `OrmYamlSerializer` per call, which
  compiles the JSON Schema with ajv in its constructor and never uses
  it, at about 34ms a hash. Two hashes per generated model made the law
  take 25s under coverage instrumentation and time out at the 30s
  default under a parallel twelve-package run. Filed as barwise-939;
  the laws carry an explicit 120s timeout naming it, per this spec's
  non-goal that a law which finds a defect files an issue rather than
  widening its own workstream.
- **`core-branching-load.spec.md`'s builder and field-table
  workstreams have not landed** (that spec's own header: WS1-WS3 and
  WS6-WS8 not implemented), so the arbitrary targets `OrmModel.add*`
  as drafted.

## Non-goals

- No Alloy, TLA+ or SMT integration, and no `formal` package.
- No change to the validator, the counterexample generator, the
  serializer or the mapper beyond WS2's merge fix; a law that finds a
  defect files an issue and the fix is its own change with the law
  already red.
- No property-based-testing mandate for other packages. The `llm`
  property has its own spec; anything else brings its own evidence.
