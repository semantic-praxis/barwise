# Core's branching load: half is the domain, and the other half goes with a sealed record metamodel

Status: WS0 complete -- barwise-927..931 shipped (PRs #426, #428, #429,
#432, #434) and closed out; barwise-932 is a WS4 gap, not a defect.
WS1-WS8 not implemented.
Created: 2026-09-06
Last-updated: 2026-09-06
Tracking: barwise-924 (this review), barwise-x4z (the wider
functional/type analysis this partly answers), barwise-e8m (the
functional-core commitment), barwise-923 (the hashModel bug the same
remediation found); follow-ups barwise-927, -928, -929, -930, -931, -932

## Principle

Core is meant to be a functional core passing rich types around. A
rich type is one whose values are all legal, so a consumer switches on
what the value is rather than checking whether it could be something
else. The vitest 4 coverage engine showed core carrying 3,195 branches
across 127 files, and the question barwise-924 asks is whether those
branches encode ORM 2 -- which genuinely has cases: arity, modality,
eight ring types, sixteen constraint kinds, open-world population
semantics -- or whether they are consumers re-checking what the types
should already guarantee.

The answer, from reading the eight densest clusters (2,739 of the 3,195
branches): **about half is the domain and should stay; the other half is
representation-driven, and nearly all of it traces to one looseness
stated three ways.** References are held as unchecked bare-string ids
(constraints to roles, roles to players, populations to fact types);
optional fields stand in for invariants (`Constraint.id?`,
`ValueConstraintDef.ranges?`, `referenceMode?`, `JoinOperand[]` where
the comment says two-or-more); and typed intermediates are erased to
strings and re-parsed downstream (`Column.dataType`, the diff's change
strings, the split's `Raw*` documents). Each consumer then re-validates
at its own boundary, invents a fallback for the case validation already
reports, and the tests pin the fallback as behaviour. In Ousterhout's
terms the dominant cost is change amplification with a real unknown
unknown underneath: a new model field needs a line in the class, the
config, the serializer twice, the schema, the diff, the merge, and the
split, and two of those fail silently when the line is missing. That is
not hypothetical: the review found five defects (WS0), four of them of
exactly that shape -- a merge that drops six fields, a split that keeps
cross-domain join constraints, a consistency rule with no arm for one
constraint kind, a verbalizer with six ring types on a default arm --
and one latent, in the mapper.

The resolution in one sentence: **the metamodel becomes sealed,
immutable records with one builder; every capability reads a graph
derived from the model once; and per-field and per-kind plumbing is
derived from one table per axis.** The serialized model does not
change. The first draft of this spec kept the mutable classes and
layered a resolver and field tables on top of them; the review decided
to pay for the metamodel itself now rather than build the layers twice
(Implementation notes).

## Is the branching inherent? (resolved: about half)

The branch totals are measured: coverage-v8's per-file counts
(`npx vitest run --coverage --coverage.reporter=json-summary` in
`packages/core`, 2026-09-06, 1614 tests passing). The inherent share is
a judgement, not a measurement: one reviewer per cluster classified
every conditional in the listed files as domain-inherent or
representation-driven, with the line ranges recorded in the cluster
notes this spec summarises, so the split can be disputed row by row
rather than as a whole.

| Cluster (files read)                                                          | Branches | Inherent | Representation-driven | The one cause in this cluster                                                                                             |
| ----------------------------------------------------------------------------- | -------: | -------: | --------------------: | ------------------------------------------------------------------------------------------------------------------------- |
| validation (`rules/*`, `population/*`, `constraintConsistency`, `structural`) |      661 |  ~55-60% |               ~40-45% | 13 rules repeat resolve-fact-type-then-bail; 29 role lookups may fail; `roleValues` admits partial tuples                 |
| verbalization (`constraints/phase1`, `phase2`, `ConstraintVerbalizer`)        |      362 |     ~40% |                  ~60% | role ids re-resolved with `?? roleId` fallback prose at 11 sites; enums widened to `string` then re-narrowed              |
| serialization + project (`OrmYamlSerializer`, `yaml/*`, `splitModel`)         |      480 |     ~40% |                  ~60% | omit-empty and optional-to-optional copying spelled per field per direction; split re-parses into loose `Raw*` records    |
| diff (`elementDiff`, `ModelMerge`, `breakingLevel`, `synonyms`)               |      321 |     ~55% |                  ~45% | per-field hand compares; `breakingLevel` regex-parses strings `elementDiff` just emitted; five copied nine-field literals |
| mapping (`RelationalMapper`, `renderers/openapi`, `renderers/avro`)           |      313 |  ~40-45% |               ~55-60% | `Column.dataType` erased to a SQL string and re-parsed by both renderers; `PrimaryKey` holds names, not columns           |
| model + query + counterexample                                                |      602 |  ~55-60% |               ~40-45% | `addConstraint` accepts dangling role ids, so 13 consumer sites re-guard; `skipPlayerValidation` makes fragments legal    |

Weighted over the reviewed branches the inherent share is about 50%.
The remaining ~450 branches (annotation, lineage, sql, describe, export,
format) were not read; `describe` and `sql` sit at the low end of the
density scale (36 and 47 per 100 lines against 92 for `diff`) and
nothing in them was named by the coverage remediation.

Two things the numbers do not say and the reading does. First, the
inherent half is well tested: every ring type, every query kind, every
leaf of Rmap (Halpin's relational mapping procedure, which the mapper
implements), every migration edge has a fixture. Second, the
representation-driven half is where the untested branches live --
`CounterexampleGenerator` is 79% branch-covered because its
`return undefined` arms guard dangling constraint role ids that no test
constructs, and the same is true of the `?? roleId` arms in
verbalization. The branch coverage the remediation chased is, in large
part, coverage of code that should not exist.

## What removes a branch, and what only moves it

Two different things read as a branch to the coverage engine, and the
workstreams treat them differently.

- **"Could this value be illegal?"** A role id that may not resolve, an
  optional id, a partial tuple, a `default` arm for a string the type
  should have narrowed. These are removed by construction: the sealed
  types make the illegal combinations unrepresentable (WS1), the
  builder rejects the references the types cannot check (WS1), and the
  derived graph resolves every reference once (WS3), so a consumer
  receives a value that cannot be wrong. Nothing moves elsewhere; the
  check runs once, where the data enters.
- **"Which case of ORM 2 is this?"** Sixteen constraint kinds, eight
  ring types, entity or value, arity, modality. With N kinds and M
  operations (validate, verbalize, diff, merge, map, describe,
  counterexample, lineage) something has to say what an exclusion
  constraint means to each operation: N x M cells, and no dispatch
  style removes one. A method per class puts the cells in the kinds; a
  switch per operation puts them in the operations. Barwise's kinds are
  ORM 2's fixed vocabulary and its operations keep growing, and
  orthogonality wants each operation in its own module, so the
  per-operation orientation the code already has is the right one. What
  a typed dispatch table changes is not the cell count but who checks
  completeness: the compiler, at every table, instead of an
  `assertNever` a reader has to remember to write (WS4).

Where the count genuinely falls rather than moves, the trick is the
same both times: find the axis along which the cells are the same
function of a row, and write the rows once.

- **Fields.** Serialize, diff, merge and describe each spell out every
  field of every element kind: N fields x M operations, all of them
  "copy, compare, rename or omit this field". One table per element
  kind and M generic walkers over it (WS2, WS7, WS8) turns that into N
  rows plus M functions. With records instead of classes the copy
  column disappears outright: a spread cannot drop a field.
- **Ring types.** The eight ring types are conjunctions of a handful of
  algebraic properties of a binary relation, and two of the three
  consumers that switch on all eight (`population/ring.ts`,
  `CounterexampleGenerator`) hand-write eight bodies whose semantics are
  those properties. One property table and one handler per property
  replaces both (WS5). The third consumer, verbalization, keeps one
  sentence per ring type, because the standard ORM reading of each ring
  type is a fixed sentence, not a conjunction of clauses; its fix
  (barwise-930) is the eight-row table of WS4.

A dispatch table reads as zero branches to coverage-v8, so the branch
count will fall further than the complexity does once WS4 lands. The
number is not the target; the two mechanisms above are.

## Scope

In scope, as design conclusions (this spec ships no code):

- When an element is constructed with a combination of fields the type
  can express as illegal (an entity type without a reference mode, a
  value type with one, a constraint without an id), the system shall
  reject it at compile time, so no constructor throws for it and no
  consumer re-checks it.
- When a model is built from elements whose references the type cannot
  check (a role naming a player, a constraint naming roles, a population
  naming a fact type), the system shall resolve every reference once in
  the builder and return diagnostics rather than a model when one
  dangles, so a capability never branches on whether an id resolves.
- When a capability (validation, verbalization, counterexample, query,
  mapping, lineage) consumes a model, the system shall hand it a graph
  whose accessors are total, so the capability navigates rather than
  looks up.
- When a model is modified, the system shall produce a new model value
  and leave the old one unchanged, so diff, merge, hash and split
  operate on values.
- When a model field is added, the system shall require exactly one
  declaration per element kind from which serialize, deserialize, diff
  and describe derive, so a missing line is a compile error rather than
  a silent drop.
- When `RelationalSchema` is consumed by a renderer, the system shall
  give it the conceptual `DataTypeDef` and the column's role, so no
  renderer re-parses a SQL string.
- When code dispatches over a core union, the system shall dispatch
  through a typed table or end in `assertNever`, so a new member fails
  compilation at every consumer.

Out of scope, and deliberately: changing what `.orm.yaml` contains or
its JSON Schema; changing the `Constraint` union's members; the purity
axis of barwise-x4z beyond what immutability settles (effect seams
remain that spec's question); and any change of implementation
language, which was a thought experiment in review and not a proposal.

## Inventory

The clusters, the type looseness each one pays for, and the verdict.
Line references are to `packages/core/src` at `main` 664b9fe.

| Area / file                                                                                 | Loose type it pays for                                                                                           | Verdict                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `model/ObjectType.ts` (11 optional config fields)                                           | entity and value are one class; four fields are required-or-forbidden by `kind`, enforced by throws              | `EntityType \| ValueType` sealed records (WS1)                                           |
| `model/FactType.ts`, `Role.ts`, `SubtypeFact.ts`, `ObjectifiedFactType.ts`, `Population.ts` | mutable classes with `id?` configs, bare-string references, setters on `ModelElement`                            | sealed records; references resolved in the builder (WS1)                                 |
| `model/Constraint.ts` (`id?`, `modality?`)                                                  | optional in memory though `FactType` always fills `id`; modality defaults at every reader                        | `id: string`, `modality: ConstraintModality` on the record; optional on the config (WS1) |
| `model/OrmModel.ts` (`findRole` scan; `skipPlayerValidation`)                               | id-keyed maps with no adjacency; one boolean makes fragment and whole model the same type                        | model as a value; `ModelBuilder` and `ModelFragment` (WS1); adjacency in the graph (WS3) |
| `model/roleGraph.ts` (`hopsFrom`)                                                           | recomputes adjacency by filtering on every call                                                                  | a graph accessor (WS3)                                                                   |
| `validation/rules/**` (13 prologues, 29 lookups)                                            | `Population.factTypeId`, `Constraint.roleIds: string[]`, partial tuples                                          | rules take `ModelGraph` (WS3)                                                            |
| `validation/rules/structural.ts`, `population/structural.ts`                                | 12 rule ids re-check what construction could have refused                                                        | the referential rules move into the builder's diagnostics, same ids (WS1)                |
| `validation/rules/constraintConsistency.ts`                                                 | no `assertNever`; `value_comparison` absent                                                                      | defect barwise-929 (WS0), then exhaustive (WS4)                                          |
| `validation/rules/population/cardinality.ts:27,36`                                          | `ObjectType.cardinality` has no modality                                                                         | gap barwise-932; keep the branch until the field exists                                  |
| `verbalization/constraints/phase1.ts`, `phase2.ts`                                          | role ids; `ringType: string`; `operator: string`; `JoinOperand[]`                                                | `ResolvedConstraint` from the graph (WS3); narrow signatures (WS1)                       |
| `verbalization/constraints/phase2.ts:226`                                                   | six ring types on a default arm                                                                                  | defect barwise-930 (WS0); eight-row sentence table (WS4)                                 |
| `validation/rules/population/ring.ts:87`, `counterexample/CounterexampleGenerator.ts:226`   | eight ring types spelled out per consumer; the algebra they share is implicit                                    | property table beside `RingType`, one handler per property (WS5)                         |
| `serialization/OrmYamlSerializer.ts`, `yaml/*.ts`                                           | per-field omit-empty in two directions; `OrmYamlConstraint` lacks `id`                                           | field table + root `compact()` (WS2); `fromDocument` feeds the builder (WS1)             |
| `serialization/yaml/constraint.ts`                                                          | 16-case rename switch spelled twice (four times repo-wide)                                                       | codec table (WS2)                                                                        |
| `project/splitModel.ts`                                                                     | `Raw*` re-parse of a schema-validated document; both round-trips                                                 | filter the value's tables, rebuild through the builder (WS8); defect barwise-928 (WS0)   |
| `diff/elementDiff.ts`, `breakingLevel.ts`                                                   | hand compares; classification by string prefix                                                                   | `ElementChange` union from the field table (WS7)                                         |
| `diff/ModelMerge.ts`                                                                        | was five copied literals dropping six fields; now one `Complete<Config>`-typed projection per kind (barwise-927) | the projection goes when the record spreads (WS1); the diff's half is barwise-934        |
| `diff/synonyms.ts:61-78`                                                                    | `ModelDelta` optional `existing`/`incoming` forcing `!` and `as`                                                 | `ModelDelta` discriminated on `kind` (WS7)                                               |
| `mapping/RelationalMapper.ts`                                                               | `PrimaryKey.columnNames`; `Column.dataType: string`; boolean triple                                              | typed `RelationalSchema` (WS6); `BinaryPattern` union; defect barwise-931                |
| `mapping/renderers/openapi.ts`, `avro.ts`                                                   | re-parse `Column.dataType`; case lists disagree; unregistered pair                                               | falls out of WS6                                                                         |
| `counterexample/CounterexampleGenerator.ts:74-107`                                          | 11 `is*` guards, five kinds fall through silently                                                                | `switch` + `assertNever` (WS4)                                                           |
| `query/evaluate.ts`                                                                         | name-based `not-found` (inherent); `?? id` player fallbacks                                                      | keep the first; the second goes with the graph (WS3)                                     |

Not affected and worth saying: `Constraint` is already a sealed union
of records with a discriminant, and `elementDiff.constraintTypeKey`,
`ring.ts`, `evaluate.ts`'s query dispatch and the Rmap leaves are the
package's best pattern. WS1 makes the other element kinds look like
`Constraint`; it does not introduce a second style.

Construction outside core, measured because it is WS1's radius: 58
`model.add*(...)` call sites in `formats` (29), `llm` (12),
`code-analysis` (11), `dbt` (4) and `learn` (2), plus 16 direct
`new ObjectType(...)`-style constructions. Every one is an importer or
parser building a model from nothing. `vscode` has none: its 13 files
that touch a model deserialize document text and never construct or
mutate one. Nothing outside core edits an element after construction;
the one setter call is `model.name = ...` in `NormaImportFormat.ts:33`.
`ModelMerge` is the single in-core editor, and it already builds a new
model rather than mutating the base.

## Target architecture

The metamodel is a set of sealed record types, one builder that is the
only mutable thing, and a graph derived from a built model. Capabilities
are functions over the graph; per-field and per-kind behaviour is a
table per operation module.

```
The value: sealed records, no classes, no methods, no setters (WS1)

  interface ObjectTypeBase { id; name; definition?; sourceContext?; aliases: readonly string[];
                             independent: boolean; note?; cardinality?: CardinalityRange }
  interface EntityType extends ObjectTypeBase { kind: "entity"; referenceMode: string }
  interface ValueType  extends ObjectTypeBase { kind: "value";  dataType: DataTypeDef;
                                                valueConstraint?: ValueConstraintDef; defaultValue?: string }
  type ObjectType = EntityType | ValueType            // the sealed set; "sealed trait" spelled in TypeScript

  interface Role      { id; name; playerId: string }
  interface FactType  { id; name; roles: readonly [Role, ...Role[]]; readings: readonly ReadingOrder[];
                        constraints: readonly Constraint[]; definition?; note?; derivation?: DerivationRule }
  interface SubtypeFact { id; subtypeId; supertypeId; providesIdentification: boolean;
                          isExclusive: boolean; isExhaustive: boolean; definingRule?: DerivationRule }
  interface ObjectifiedFactType { id; name; factTypeId; objectTypeId }
  interface Population { id; factTypeId; description?; sample: boolean; instances: readonly FactInstance[] }
  Constraint: as today, with id: string and modality: ConstraintModality on the record;
              JoinConstraint.operands: readonly [JoinOperand, JoinOperand, ...JoinOperand[]];
              ValueConstraintDef.ranges: readonly ValueRange[]

  interface OrmModel { name; domainContext?; note?; orm_version;
                       objectTypes: readonly ObjectType[]; factTypes: readonly FactType[];
                       subtypeFacts; objectifiedFactTypes; populations; definitions; diagramLayouts }
  // arrays in declaration order, not maps: serialization order is part of the golden bytes,
  // and a value with arrays spreads, compares and hashes without a helper.

  Genuinely optional fields stay optional (a note is legal to omit on either kind).
  Variant-determined fields live in the variant (a reference mode cannot be absent on an entity type).
  Defaults are applied once, in the builder (independent, sample, modality, aliases).
  Ids: the *Config types keep id? and the builder mints; the records carry id: string.

The one mutable thing: the builder (WS1)

  const b = new ModelBuilder({ name });        // same add* names the 70 importer sites use today
  b.addObjectType(config): ObjectTypeId          // config is EntityTypeConfig | ValueTypeConfig
  b.addFactType(config, constraints?)            // roles name players by id
  b.addSubtypeFact(config); b.addPopulation(config); ...
  b.build(): BuildResult                          // { ok: true; model: OrmModel } | { ok: false; diagnostics: Diagnostic[] }
  b.buildFragment(): ModelFragment                // players may be unresolved; the merge's input type, nothing else's

  build() resolves every reference and applies exactly the rules construction can refuse --
  today's structural/dangling-*, structural/duplicate-*, structural/*-not-entity, structural/subtype-cycle,
  population/dangling-fact-type, population/incomplete-instance -- under their existing rule ids,
  so `barwise validate` prints the same diagnostics it prints today instead of a stack trace.
  Everything else stays a validation rule over the built model.

Modification: a builder seeded from a value (WS1)

  ModelBuilder.from(model)                        // the only edit path; add, remove, then build() again
  The merge, the split and the editor go through it; nothing assigns a field of a built model.

The view: a graph derived once from a built model (WS3)

  const g = graphOf(model): ModelGraph            // O(n); rebuilt after any modification; never mutated
  g.player(role): ObjectType                       g.factTypeOf(role): FactType
  g.rolesOf(c): readonly Role[]                    g.constraintsOn(role): readonly Constraint[]
  g.rolesPlayedBy(ot): readonly Role[]             g.hopsFrom(ot): readonly RoleHop[]      (roleGraph.ts today)
  g.populationsOf(ft): readonly Population[]       g.supertypesOf(ot) / g.subtypesOf(ot)
  g.resolve(c): ResolvedConstraint                 // { constraint; roles: [{ role; player; factType }]; spansFactTypes; commonPlayer? }
  Every accessor is total: the builder proved the references, so the graph cannot fail to build.
  ORM 2 is a bipartite hypergraph -- object types and fact types are the nodes, roles the edges,
  constraints annotations on edge sets, populations instances over hyperedges; the graph is that shape typed.

One table per axis, one per operation module (WS2, WS4, WS5, WS7)

  OBJECT_TYPE_FIELDS: Record<keyof ObjectTypeBase | keyof EntityType | keyof ValueType, { yaml; level: BreakingLevel }>
    serialize = project + rename + compact()   deserialize = reverse rename into the builder
    diff      = rows whose value differs -> ElementChange { field; from; to; level }
    drift test: Object.keys(schema.definitions.object_type.properties) == the table's yaml names
  RING_SENTENCES: Record<RingType, ...> in verbalization;  RING_PROPERTIES: Record<RingType, RingProperty[]> beside RingType;
  per-property handlers in population/ring.ts and CounterexampleGenerator.ts;
  Record<Constraint["type"], ...> per operation where every kind gets one handler, assertNever where arms group.

Typed relational schema (WS6)
  Column { name; dataType: DataTypeDef; role: {kind:"pk"} | {kind:"fk"; target: Table} | {kind:"attribute"}; nullable }
  PrimaryKey { columns: readonly Column[] }              renderers switch on ConceptualDataTypeName exhaustively
  ddl.ts renders the SQL string; nothing re-parses it
```

Three rules the sketch encodes, stated once so a workstream cannot
drift from them:

- **A parent type with sealed children is a union.** TypeScript has
  inheritance but no `sealed`; the union declaration is how the
  compiler learns the child list is closed, which is what makes a match
  exhaustive. `EntityType` and `ValueType` extend one base, a function
  that needs only the base takes the base, and one that needs the
  reference mode matches on `kind` and gets a `string`.
- **Records, not classes; functions beside the type, not methods on
  it.** Structural equality, spread-copy and discriminant matching are
  what case classes give in Scala; TypeScript classes give none of them
  (identity equality, hand-written copies, `instanceof` that breaks
  across the extension's bundle). Derivations that belong to the data -- `arity(ft)`, `referenceScheme(et)` -- are functions in the kind's
  module, defined once. Operations that exist because a capability
  exists -- verbalize, validate, map, diff -- are functions in that
  capability's module over the sealed union, so the model module
  imports nothing from verbalization and the dependency graph stays
  one-way. The test for which side a function belongs on: would it
  still exist if the capability were deleted?
- **The graph is derived, never stored.** Two live representations
  would have to be kept in sync; one value and one view rebuilt from it
  cannot disagree. Models are hundreds of elements, so the rebuild is
  not a cost. This is the house rule's "derive it from the authority"
  applied to the model itself.

## Alternatives considered

- **Keep the classes and layer a resolver and field tables on them.**
  The first draft of this spec. Superseded in review: every layer would
  be built against the mutable class shape and moved when the metamodel
  changed, and the merge defect (927) is a direct cost of the class
  shape (hand-copied literals) that no layer removes.
- **A class hierarchy with methods, `EntityType extends ObjectType`.**
  Gives the parent-and-children reading directly, and a method defined
  once on the parent is one definition. Rejected for the operations,
  not for the shape: a `verbalize` method puts verbalization inside the
  model module and reverses the dependency direction; with sixteen
  constraint kinds the verbalization of constraints scatters across
  sixteen classes; and methods require classes, which require the
  hand-written copies that produced 927. The parent-and-children
  reading is kept as the sealed union.
- **Direct object references (`role.player: ObjectType`).** The classic
  object graph. Creates cycles that serialization, hashing and diff
  must work around, and removal still needs a reverse index. The
  derived graph gives the same navigation with an acyclic value.
- **A generic property graph (labelled nodes and edges).** Trades typed
  dispatch for string-label branching at every consumer. Rejected.
- **Redux or Immer for the immutable model.** Redux is a store with
  subscribers and middleware, built for many components reading one
  state over time; core has no subscribers and no time. Its underlying
  pattern (state as a value, transitions as pure functions, memoized
  selectors) is this design, written with plain records, spreads and
  `graphOf`. Immer is a legitimate library under the no-trivial-deps
  rule if update code on nested records gets hard to read; not adopted
  until that happens.
- **Brand the ids (`RoleId`, `ObjectTypeId`).** The review found no
  instance of an id of one kind used as another. Free to adopt inside
  the builder and graph where it documents a signature; not its own
  workstream.
- **Deterministic ids at load, so references never dangle.** Solves the
  hashModel bug generally (barwise-923 chose canonicalization instead)
  but does not stop a builder accepting a dangling id; the looseness is
  in acceptance, not in minting.
- **Leave it: branching is cheap and the tests cover it.** The branches
  that cost the most are the ones without tests (the `undefined` arms),
  and the four WS0 defects are the cost already paid. The merge one is
  data loss on today's `main`.
- **A generic structural diff instead of a field table.** Loses the
  per-field breaking level, which is the reason `elementDiff` exists;
  the table keeps the level next to the field.

## Workstreams (each independently shippable)

Ordered by dependency, not by blast radius: the review chose to pay for
the metamodel first so nothing is built twice. WS0 lands before it
because it is data loss today. WS4 and WS5 depend on nothing and can
land at any point.

```
WS0 -> WS1 (sealed records + builder)
         +-> WS2 (field tables) -> WS7 (typed diff) -> WS8 (split)
         +-> WS3 (graph; capabilities consume it) -> WS6 (typed relational schema)
WS4, WS5: independent of all of the above
```

### 0. The defects the review found (barwise-927, -928, -929, -930, -931)

Fix each where it lives, with the test that would have caught it, on
the current shape. Merge (927) copies through a helper that lists every
field once; WS1 deletes the helper when the record spread makes it
redundant. Split (928) replaces the eight-key walk with an exhaustive
`switch (c.type)`. The other three are one-file changes.

### 1. The sealed record metamodel, the builder, and the fragment type

The types in Target architecture; classes and `ModelElement` deleted;
setters deleted; `ModelBuilder` with today's `add*` names; `build()`
returning `BuildResult`; `buildFragment()` returning `ModelFragment`
for the merge; `ModelBuilder.from(model)` as the one edit path; `Constraint.id`
and `modality` required on the record; the three narrowings
(`operands` tuple, `ranges` default, `verbalizeRing(ringType: RingType)`).
`OrmYamlSerializer.fromDocument` feeds the builder and returns its
diagnostics on failure; `lenient` disappears because the builder's
`BuildResult` is what `lenient` existed to allow. The 12 referential
structural rules move into the builder under their existing ids;
`structural.ts` keeps the rest, including
`structural/binary-missing-inverse-reading`, which is a warning and so
cannot be a refusal. `build()` collects every diagnostic before it
returns rather than failing on the first, which is what keeps the
report one pass wide (Decisions). The builder freezes what it returns
(`Object.freeze`, deep), so a test that mutates a model fails loudly,
and `ModelBuilder.from(model)` copies the arrays it inherits rather
than mutating frozen ones.

Radius: every package. The 58 importer sites change their receiver from
a model to a builder and read `build()`; the 16 direct constructions
become builder calls; `vscode`'s 13 deserializing files change the
`deserialize` result type only. Every site is found by the compiler.
Golden bytes and the round-trip corpus do not change: this workstream
rewrites how a model is held, not what it serializes to. Tests of the
constructor throws move to the builder's diagnostics; tests that pin
`skipPlayerValidation` become fragment tests or go.

### 2. One field table per element kind

`OBJECT_TYPE_FIELDS`, `FACT_TYPE_FIELDS` and the rest as sketched; the
serializer becomes project-rename-`compact()` in one direction and
reverse-rename into the builder in the other; the `(c as {id?})` casts
go; the constraint codec becomes a table. Drift test against the JSON
Schema's property names, so the schema copy -- the one copy that cannot
be typed away -- is guarded. This is the change that turns "add a
field" from eight edits into two. Depends on WS1: the table's keys are
the record's keys.

### 3. `ModelGraph`, and the capabilities that read it

`graphOf(model)` with the accessors sketched; `hopsFrom` moves from
`roleGraph.ts` into it. Validation rules take the graph and lose the 13
prologues and ~20 `undefined` guards; the verbalizer and counterexample
generator take `g.resolve(c)` and lose the six `?? roleId` fallback
ladders and the ~12 tests that pin `"bogus"` prose; query and the
mapper lose their `?? id` player fallbacks; `findRole`'s scan and the
per-call adjacency recompute go. `constraintEnforcement.ts` builds the
graph internally so `learn` is untouched. Also the `joinSegments`
helper (six copies of one punctuation ladder) and one `Bound` renderer
for the four quantifier copies, which already drift (`at most` exists
in one copy). `graphOf` memoizes per value through a module-level
`WeakMap` and freezes the graph it returns, since callers share one
object (Decisions). Depends on WS1.

### 4. Exhaustiveness: dispatch tables and `assertNever`

Every `switch` over `Constraint["type"]`, `RingType`, `DeltaKind`,
`ConceptualDataTypeName` becomes total, by one of two mechanisms:

- **A typed dispatch table** where every member gets a handler of one
  signature: `const RING_SENTENCES: Record<RingType, (ctx) => Verbalization>`
  (or `satisfies` over a literal object). A missing member fails to
  compile at the table, with no `default` arm and no helper to
  remember. `RING_TYPE_MEMBERS` in `model/Constraint.ts` is the
  precedent (barwise-869): a `Record<Union, true>` that cannot lag the
  union. Each operation module owns its own table, so verbalization
  and validation stay in separate files even though both are keyed by
  the same kind. The ring verbalizer (`phase2.ts:201`, two arms and a
  default) becomes this table with eight sentences, which is the
  barwise-930 fix.
- **`default: assertNever(x)`** where the arms group members
  (`case "asymmetric": case "antisymmetric":`) or narrow the value for
  further use in the same function; a table would force one handler
  per member and lose the grouping.

The `is*` chain in `CounterexampleGenerator` becomes a `switch` with
explicit `return undefined` cases for the five kinds it does not
handle. No behaviour change except the six ring sentences; the next
union member fails to compile at every consumer. Deletes the
phase2.ts:557 dead doc comment. Independent of WS1.

### 5. Ring types as algebra

The eight `RingType` members are conjunctions of properties of a binary
relation R over one object type: irreflexive (no R(a,a)), symmetric
(R(a,b) implies R(b,a)), antisymmetric (R(a,b) and R(b,a) imply a = b),
transitive (R(a,b) and R(b,c) imply R(a,c)), intransitive (they imply
not R(a,c)), acyclic (the transitive closure is irreflexive), and
purely reflexive (R(a,b) implies a = b). Asymmetric is irreflexive and
antisymmetric together; acyclic implies both; the rest are single
properties. Today `population/ring.ts:87` (eight arms, 300 lines) and
`CounterexampleGenerator.ts:226` (eight arms) each spell the eight out
by hand, and the generator's `case "asymmetric": case "antisymmetric":
case "acyclic":` grouping is the algebra showing through the switch.

Declare the algebra once, beside `RingType` in `model/Constraint.ts`:

```
type RingProperty =
  | "irreflexive" | "symmetric" | "antisymmetric" | "transitive"
  | "intransitive" | "acyclic" | "purely_reflexive";
const RING_PROPERTIES: Record<RingType, readonly [RingProperty, ...RingProperty[]]>;
  // asymmetric: ["antisymmetric", "irreflexive"], acyclic: ["acyclic"], ...
```

Each consumer then holds one handler per property in its own module:
the population rule a `Record<RingProperty, (pairs, ctx) => Diagnostic[]>`
(`checkAcyclic` is already the acyclic handler), and the generator a
`Record<RingProperty, (a, b, c) => RoleValues[]>` of violating tuple
sets. Checking a ring type is the union of its properties' diagnostics;
its counterexample is the witness of the property listed first, so the
order in `RING_PROPERTIES` is load-bearing and is chosen to reproduce
today's witnesses (asymmetric's is the reverse pair, not the self-loop).
Diagnostics keep their current messages, keyed by ring type, so no
population golden changes. Two eight-arm switches become one eight-row
table and two seven-row tables, and a ring type added to ORM 2's
vocabulary later is one row plus, at most, one new property.

Independent of every other workstream and small enough to land first.
Verbalization is deliberately not on the property axis (see "What
removes a branch"); its ring fix is WS4's sentence table.

### 6. Typed `RelationalSchema` (provisional: `formats` and `dbt` consumers of `Column` not yet enumerated)

`Column.dataType: DataTypeDef`, `Column.role`, `PrimaryKey.columns`.
Deletes both renderer switches (~80 of 86 renderer branches), the four
PK-by-name lookups, the unreachable `"TEXT"` fallbacks, and closes
barwise-931 one way or the other. `ddl.ts` is the only place a SQL type
string is rendered. Blast radius: the mapping subpath plus
`formats/DdlExportFormat`, `dbt`'s column reader, `DbtExportAnnotator`.
The mapper-internal `BinaryPattern` union (four-way, exhaustive) is a
near-zero-radius companion. After WS3, so the mapper reads the graph
before its output type changes.

### 7. `ElementChange` for diff and level (provisional)

From WS2's table: `elementDiff` yields typed changes carrying their
level; `breakingLevel` switches exhaustively instead of regex-parsing
prose; `changeDescriptions` stays as a derived string array so cli, mcp
and vscode -- which only print -- do not change. `ModelDelta` becomes a
union on `kind` so `existing`/`incoming` are non-optional where present
and the 14 `!` in `ModelMerge` go. The merge seeds a builder from the
base, adds the fragment's elements, and builds; a `ModelFragment` is
never itself a model.

### 8. `splitModel` over the value (provisional)

Each domain is the model's tables filtered by the split config and
rebuilt through the builder, so referential integrity is checked by
construction; delete the `Raw*` layer (lines 85-149), the eight-key
walk, and both defensive round-trips. Depends on WS1 and WS2. The
header's justification for the raw path ("carries every field,
including ones this code does not enumerate") does not hold: the
schema forbids unknown keys everywhere and `parse`/`stringify` drops
comments regardless.

## API and migration impact

- Nothing in `.orm.yaml` or its schema changes in any workstream; every
  serializer change is byte-identical output, guarded by the round-trip
  tests and the golden examples.
- WS1 is the one cross-package change and it is deliberate: `OrmModel`,
  `ObjectType`, `FactType`, `Role`, `SubtypeFact`, `ObjectifiedFactType`
  and `Population` become record types; `ModelBuilder` and `BuildResult`
  are new exports; the class constructors, `ModelElement`, the setters
  and `skipPlayerValidation` are removed. Read accessors (`getObjectType`,
  `getFactTypeByName`, `factTypesForObjectType`, `supertypesOf`) become
  functions over the value or accessors on the graph, with the same
  names, so a consumer's edit is the receiver. No compatibility shim: one
  migration, found by the compiler, and the old shape does not survive
  to be maintained.
- `RelationalSchema` (WS6) is a public type consumed by `formats` and
  `dbt`; it is the only other workstream with cross-package fallout.
- Downstream packages see no behaviour change from WS2-WS5, WS7, WS8.
  WS0 changes behaviour where today's behaviour is the defect. WS1
  changes one observable: a model that fails to build reports the same
  diagnostics it reports today, through `BuildResult` instead of an
  exception-or-lenient pair.

## Decisions (resolved in review, 2026-09-06)

Eight questions were put to the owner and settled. They are recorded
here with the choice and its reason so a workstream does not reopen
them.

From the first draft: `Constraint.id` required on the record (yes,
WS1); a `ModelFragment` type instead of `skipPlayerValidation` (yes,
WS1); WS6 after WS3 (yes); the entity/value split (yes, as a sealed
union, WS1).

- **The builder owns the 12 referential structural rules.** Chosen by
  the test "can the value exist with this defect", so a built model has
  no dangling reference, no duplicate name and no subtype cycle. The
  narrower alternative (only dangling references) leaves a value a
  cycle can make non-terminating for the graph.

  **This costs the operator a pass, and the cost was accepted.** The
  engine runs every rule unconditionally today and sorts the findings,
  so a model with a dangling reference and an unrelated constraint
  problem reports both at once. Under this decision it does not build,
  the semantic rules never run, and the second problem surfaces only
  after the first is fixed. The analogy that makes this the right
  trade is the compiler's: build errors are parse errors and the
  validation rules are the type checker, and no compiler type-checks a
  file that will not parse. The mitigation is a WS1 requirement:
  **`build()` collects every diagnostic it can find before returning,
  never failing on the first**, so one pass reports every referential
  problem in the model rather than one at a time. An earlier draft of
  this spec claimed the operator "sees the same report either way";
  that was wrong, and the correction is what this paragraph records.

- **The builder refuses a partial population tuple.**
  `FactInstance.roleValues` is complete on a built model and the
  population rules lose their partial-tuple guards. Today's
  `population/incomplete-instance` rule already reports the case as an
  error, so this changes when the operator hears, not whether.

- **`build()` freezes what it returns**, deeply, so a mutation a cast
  slipped past the type fails loudly. Two consequences for WS1: this
  package's modules are always strict mode, so a stray write throws
  rather than failing silently, which is what makes the freeze useful
  in a test; and `ModelBuilder.from(model)` copies the arrays it
  inherits, since it cannot mutate frozen ones.

- **`graphOf` memoizes per model value**, with a module-level
  `WeakMap<OrmModel, ModelGraph>` inline in the graph module. In
  JavaScript a weak map is not an addition to memoization, it is how a
  function memoizes on an object key without pinning every key it ever
  saw (`functools.lru_cache` keyed on a hash is the strong-reference
  equivalent). No general `memoize` helper until a second call site
  wants one.

  The point is idempotence rather than speed: two calls on one value
  return the same object, so identity comparisons and anything keyed on
  the graph behave. Three consequences. The cache is sound **because**
  the model is frozen, since memoizing on identity is only correct when
  the key cannot change. The graph is frozen too, because callers now
  share one object. And the purity gate is satisfied: a cache is not
  I/O, a clock or randomness, and the graph returned is identical
  whether or not it was cached. Passing the graph down from a
  capability's entry point stays the house style, because it reads
  better; the cache means a caller who forgets does not pay for it.

## Risks and testing

- Every workstream is guarded by the existing suite: round-trip tests
  and golden examples for the serializer, the corpus for verbalization,
  the Rmap tests for mapping, `populationValidation.test.ts` for the
  rules. A workstream that changes any golden byte is wrong by
  definition, except WS0 where the golden was the defect, and WS4's
  ring sentence table, which changes the six ring verbalizations the
  default arm renders today (barwise-930, the same exception).
- **What happens to the tests.** Fewer than it looks. Of 1,403 `it`
  blocks in core's 94 test files, 46 in 24 files pin a fallback,
  dangling-reference or lenient behaviour by their titles; those are
  the limitation-pinned class the `assertion-audit` skill names, and
  WS1 and WS3 delete them deliberately, saying so in the commit. The
  rest test domain semantics, and every one of them survives, because
  the domain branches stay. Constructor-throw tests become
  `BuildResult` tests with the same subjects. The count of tests falls
  by about 3%; what falls further is the number of tests whose
  subject is code that should not exist.
- Coverage thresholds will move up, not down: the uncovered branches
  are the ones being deleted, and a dispatch table reads as zero
  branches. Do not lower a threshold to land a workstream.
- WS1 is large and lands once. The guard is that it changes no golden
  byte and no diagnostic id, so the serializer round-trip corpus and
  the validation fixtures are the acceptance test; a WS1 that needs a
  golden edit has changed semantics and is wrong.
- Mutation after construction: nothing outside core does it today
  (measured, Inventory), and the builder's freeze makes a regression a
  thrown error in the test that introduces it.

## Non-goals

- Reducing branch count for its own sake. The inherent half stays, and
  a workstream that removes a domain case to make a number smaller is
  wrong.
- Changing the serialized format or its schema.
- Answering barwise-x4z in full. This spec covers the type-system axis
  where branching made it measurable and settles immutability; the
  effect-seam half of the purity axis is not examined here.
- Changing the implementation language. Raised as a thought experiment
  in review; the answer is recorded in the session, not here.

## Implementation notes

- The review's method and its per-cluster tables are recorded in the
  session that produced this spec (six parallel read-only reviews over
  the eight densest clusters, each classifying every conditional). The
  numbers in "Is the branching inherent?" are theirs; the judgement in
  Principle is this spec's. One agent claim was corrected on
  re-reading: the ring default arm renders a generic
  `<Label>: X pred X.` shape, not "Acyclic" for every type; barwise-930
  says so.
- `DomainModel.principles.md`, which barwise-924 cites, does not exist
  in the repository; the principles it means are the root `CLAUDE.md`
  design principles, and that is what this spec argues from.
- Revised in review (2026-09-06, same day, three passes). First:
  "What removes a branch, and what only moves it" was added; the
  exhaustiveness workstream gained the typed dispatch table as its
  primary mechanism; ring types as algebra was added. A first draft of
  that workstream put verbalization on the property axis too; it was
  pulled back because the standard reading of a ring type is one fixed
  sentence, and composing it from property clauses would render
  asymmetric as two sentences where Halpin gives one. Second: the
  owner asked for the design that is right rather than the one with
  the smallest radius, and the metamodel became sealed immutable
  records with a builder and a derived graph; the first draft's
  `ValidationContext` and `ResolvedConstraint` are two instances of
  the graph and were merged into WS3; workstreams were reordered by
  dependency. Third: the four first-draft open decisions were settled
  as recorded above. The first draft's reason for rejecting the
  entity/value split (few branches removed for a large radius) counted
  the wrong thing; the split's payoff is compile-time refusal at the 58
  construction sites, which a branch count cannot see.
- The four open decisions were resolved 2026-09-06 and moved into
  Decisions with their reasons. Resolving them corrected one claim the
  spec had made: that moving the referential rules into the builder
  leaves the operator "the same report either way". It does not. The
  validation engine runs every rule unconditionally and sorts the
  findings, so today a dangling reference and an unrelated semantic
  problem arrive together, and after WS1 the second waits for a second
  pass. The owner accepted that cost; `build()` collecting every
  diagnostic before returning is the mitigation, and it is now a WS1
  requirement.
- Two claims in this revision are argued from reading, not from
  running: that the acyclic handler and the existing witnesses
  reproduce under a property ordering (WS5), and that the 12
  referential structural rules are exactly the set a builder can
  refuse without changing any diagnostic id (WS1). Both are the first
  thing to verify when their workstream is grounded.
- WS0 landed 2026-09-06 as five PRs from a second session (#426, #428,
  #429, #432, #434), each with its test seen red first. The review of
  the first found the 927 projection helpers guarded by a comment only
  and the role fields still hand-listed; the closeout PR types the
  literals `Complete<Config>` (`util/complete.ts`), so an unlisted
  field is a compile error, and derives roles from the projection. The
  diff half of the 927 symptom (note, independent, defaultValue never
  compared) is barwise-934, WS7's to absorb. The 927 merge also showed
  that the spec audit did not match this spec's own "no workstream
  implemented"; the closeout widens the regex with a gate test.
