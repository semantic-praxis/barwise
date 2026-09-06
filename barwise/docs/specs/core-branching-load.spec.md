# Core's branching load: about half is the domain, and the other half has one cause

Status: Design review complete -- no workstream implemented; WS0 (the
defects) is filed as barwise-927..932 and is the first thing to land
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

The resolution in one sentence: keep the domain branching, and remove
the representation-driven half by resolving references once at each
capability's boundary and by deriving the per-field plumbing from one
table per element kind, without changing the serialized model or the
metamodel's public shape.

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

## Scope

In scope, as design conclusions (this spec ships no code):

- When a capability (validation, verbalization, counterexample, query)
  consumes a constraint, the system shall hand it roles resolved once at
  the capability's boundary, so the capability never branches on
  whether a role id resolves.
- When a model field is added, the system shall require exactly one
  declaration per element kind from which serialize, deserialize, diff
  and merge derive, so a missing line is a compile error rather than a
  silent drop.
- When `RelationalSchema` is consumed by a renderer, the system shall
  give it the conceptual `DataTypeDef` and the column's role, so no
  renderer re-parses a SQL string.
- When a `switch` dispatches over a core union, the system shall end in
  `assertNever`, so a new member fails compilation at every consumer.

Out of scope, and deliberately: changing what `.orm.yaml` contains, the
public constructor shapes of `ObjectType`/`FactType`/`OrmModel`, or the
`Constraint` union's members. Every recommendation below is additive to
the metamodel or internal to one capability. The `EntityType |
ValueType` split and branded ids are considered and not recommended
(Alternatives).

## Inventory

The clusters, the type looseness each one pays for, and the verdict.
Line references are to `packages/core/src` at `main` 664b9fe.

| Area / file                                          | Loose type it pays for                                                  | Verdict                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `validation/rules/**` (13 prologues, 29 lookups)     | `Population.factTypeId`, `Constraint.roleIds: string[]`, partial tuples | `ValidationContext` built once by the engine (WS4)                               |
| `validation/rules/constraintConsistency.ts`          | no `assertNever`; `value_comparison` absent                             | defect barwise-929 (WS0), then exhaustive (WS1)                                  |
| `validation/rules/population/cardinality.ts:27,36`   | `ObjectType.cardinality` has no modality                                | gap barwise-932; keep the branch until the field exists                          |
| `verbalization/constraints/phase1.ts`, `phase2.ts`   | role ids; `ringType: string`; `operator: string`; `JoinOperand[]`       | `ResolvedConstraint` at the verbalizer entry (WS5); narrow signatures (WS2)      |
| `verbalization/constraints/phase2.ts:226`            | six ring types on a default arm                                         | defect barwise-930 (WS0)                                                         |
| `serialization/OrmYamlSerializer.ts`, `yaml/*.ts`    | per-field omit-empty in two directions; `OrmYamlConstraint` lacks `id`  | field table + root `compact()` (WS3)                                             |
| `serialization/yaml/constraint.ts`                   | 16-case rename switch spelled twice (four times repo-wide)              | codec table (WS3)                                                                |
| `project/splitModel.ts`                              | `Raw*` re-parse of a schema-validated document; both round-trips        | build typed domain models via `toConfig()` (WS8); defect barwise-928 (WS0)       |
| `diff/elementDiff.ts`, `breakingLevel.ts`            | hand compares; classification by string prefix                          | `ElementChange` union from the field table (WS7)                                 |
| `diff/ModelMerge.ts:62-141, 224-231`                 | five copied literals; drops six fields                                  | defect barwise-927 (WS0) via `toConfig()`                                        |
| `diff/synonyms.ts:61-78`                             | `ModelDelta` optional `existing`/`incoming` forcing `!` and `as`        | `ModelDelta` discriminated on `kind` (WS7)                                       |
| `mapping/RelationalMapper.ts`                        | `PrimaryKey.columnNames`; `Column.dataType: string`; boolean triple     | typed `RelationalSchema` (WS6); `BinaryPattern` union; defect barwise-931        |
| `mapping/renderers/openapi.ts`, `avro.ts`            | re-parse `Column.dataType`; case lists disagree; unregistered pair      | falls out of WS6                                                                 |
| `model/FactType.ts:168` (`addConstraint`)            | accepts dangling `roleIds`, wrong arity, `min > max`                    | validate at construction, fragments excepted (WS4 prerequisite; Open decision 1) |
| `model/OrmModel.ts:195,268` (`skipPlayerValidation`) | one boolean makes fragment and whole model the same type                | `ModelFragment` type (Open decision 2); not required by any workstream           |
| `model/Constraint.ts` (`id?`)                        | optional in memory though `FactType` always fills it                    | required on the model type, optional on the config (WS2; Open decision 1)        |
| `counterexample/CounterexampleGenerator.ts:74-107`   | 11 `is*` guards, five kinds fall through silently                       | `switch` + `assertNever` (WS1)                                                   |
| `query/evaluate.ts`                                  | name-based `not-found` (inherent); `?? id` player fallbacks             | keep the first; the second goes with WS4's resolver                              |

Not affected and worth saying: `Constraint` is already a proper
discriminated union with guards, and `elementDiff.constraintTypeKey`,
`ring.ts`, `evaluate.ts`'s query dispatch and the Rmap leaves are the
package's best pattern. The recommendations extend that pattern; they
do not introduce a new one.

## Target architecture

```
One resolver, four consumers (WS4, WS5)
  OrmModel.resolveConstraint(c, ft): ResolvedConstraint      throws on a dangling id --
    roles: readonly Role[] (each with .player: ObjectType)   by then it is a bug, not data
    spansFactTypes: boolean                                  (constraintConsistency reports
    commonPlayer?: ObjectType (disjunctive/xor, verified)     dangling ids as diagnostics)
  ValidationEngine  -> ValidationContext { universe, rolePlayers, populations: ResolvedPopulation[], constraints: ResolvedConstraint[] }
  Verbalizer, CounterexampleGenerator, query -> resolveConstraint at their entry

One declaration per element kind (WS3, WS7, WS8)
  OBJECT_TYPE_FIELDS: Record<keyof ObjectTypeConfig, { yaml: string; key(el): string; level: BreakingLevel }>  (satisfies)
  ObjectType.toConfig(): ObjectTypeConfig
    serialize   = project + rename + compact()          deserialize = reverse rename, no casts
    diff        = rows whose key differs -> ElementChange { field, from, to, level }
    merge       = { ...ot.toConfig(), id }               split = new OrmModel(...).addObjectType(toConfig())
  drift test: Object.keys(schema.definitions.object_type.properties) == table's yaml names

Typed relational schema (WS6)
  Column { name; dataType: DataTypeDef; role: {kind:"pk"} | {kind:"fk"; target: Table} | {kind:"attribute"}; nullable }
  PrimaryKey { columns: readonly Column[] }              renderers switch on ConceptualDataTypeName exhaustively
  ddl.ts renders the SQL string; nothing re-parses it
```

## Alternatives considered

- **Split `ObjectType` into `EntityType | ValueType`.** The cleanest
  type, and the one the issue's "exhaustive type discrimination"
  framing points at. Rejected for now: 60 `kind` checks across 24 files
  and every downstream package name `ObjectType`; the review found only
  `referenceMode?` spreads and one `refModeSuffix` guard that it would
  remove. The payoff is small next to the blast radius. Revisit after
  WS3 gives the class a `toConfig()`, which is the seam a split would
  need anyway.
- **Brand the ids (`RoleId`, `ObjectTypeId`).** Cheap and additive, but
  the review found no instance of an id of one kind used as another;
  branding removes no branch listed above. Not recommended as its own
  work; free to adopt inside WS4's resolver if it helps.
- **Deterministic ids at load, so references never dangle.** Solves the
  hashModel bug generally (barwise-923 chose canonicalization instead)
  but does not stop `addConstraint` accepting a dangling id; the
  looseness is in acceptance, not in minting.
- **Leave it: branching is cheap and the tests cover it.** The branches
  that cost the most are the ones without tests (the `undefined` arms),
  and the four WS0 defects are the cost already paid. The merge one is
  data loss on today's `main`.
- **A generic structural diff instead of a field table.** Loses the
  per-field breaking level, which is the reason `elementDiff` exists;
  the table keeps the level next to the field.

## Workstreams (each independently shippable)

Ordered by blast radius. Each keeps the suite green alone. WS0 first
because it is defects, not design.

### 0. The defects the review found (barwise-927, -928, -929, -930, -931)

Fix each where it lives, with the test that would have caught it.
Merge (927) goes through `ObjectType.toConfig()` / `FactType.toConfig()`
-- two additive methods that WS3 needs anyway -- rather than a sixth
hand-copied literal. Split (928) replaces the eight-key walk with an
exhaustive `switch (c.type)`. The other three are one-file changes.

### 1. Exhaustiveness sweep

`default: assertNever(x)` on every `switch` over `Constraint["type"]`,
`RingType`, `DeltaKind`, `ConceptualDataTypeName`; the `is*` chain in
`CounterexampleGenerator` becomes a `switch` with explicit
`return undefined` cases for the five kinds it does not handle. No
behaviour change; the next union member fails to compile at every
consumer. Deletes the phase2.ts:557 dead doc comment.

### 2. Narrow the signatures that widened

`verbalizeRing(ringType: RingType)`, `operator: ValueComparisonOperator`,
`JoinConstraint.operands: readonly [JoinOperand, JoinOperand, ...JoinOperand[]]`,
`ValueConstraintDef.ranges: readonly ValueRange[]` (default `[]`), and
-- pending Open decision 1 -- `Constraint.id: string` on the model type
with `ConstraintConfig.id?` on the config. Each removes a `default`, a
`??`, or an `[0]` guard and the test that pinned it (`Phase2...test.ts:497`
pins `"!="`, a value the type forbids). Serializer constructs the tuple.

### 3. One field table per element kind, and `toConfig()`

`OBJECT_TYPE_FIELDS` and `FACT_TYPE_FIELDS` as sketched; the serializer
becomes project-rename-`compact()` in one direction and reverse-rename
in the other; the `(c as {id?})` casts go; the constraint codec becomes
a table. Drift test against the JSON Schema's property names, so the
schema copy -- the one copy that cannot be typed away -- is guarded.
This is the change that turns "add a field" from eight edits into two.

### 4. `ValidationContext` (provisional: the resolver's shape is drafted, not grounded against `@barwise/learn`'s `evaluateConstraintEnforcement`)

The engine resolves once -- populations paired with their fact types,
instances with complete tuples, constraints with `Role[]` and a verified
common player, one object universe, one role-player map -- and
population rules take the context instead of `OrmModel`. Deletes the 13
prologues and ~20 `undefined` guards, and turns the silent case (a
dangling role id in an exclusion constraint reading as "spanning") into
a reported error. Prerequisite: `addConstraint` validates role ids at
construction, with merge fragments as the one exception (Open decision
1). `constraintEnforcement.ts` builds the same context internally so
`learn` is untouched.

### 5. `ResolvedConstraint` at the verbalizer and counterexample entry (provisional: shares WS4's resolver)

The same resolver; verbalizers receive `{ role, player }` per role and
the six `?? roleId` fallback ladders go, together with the ~12 tests that
pin `"bogus"` prose. Also the `joinSegments` helper (six copies of one
punctuation ladder) and one `Bound` renderer for the four quantifier
copies, which already drift (`at most` exists in one copy).

### 6. Typed `RelationalSchema` (provisional: `formats` and `dbt` consumers of `Column` not yet enumerated)

`Column.dataType: DataTypeDef`, `Column.role`, `PrimaryKey.columns`.
Deletes both renderer switches (~80 of 86 renderer branches), the four
PK-by-name lookups, the unreachable `"TEXT"` fallbacks, and closes
barwise-931 one way or the other. `ddl.ts` is the only place a SQL type
string is rendered. Blast radius: the mapping subpath plus
`formats/DdlExportFormat`, `dbt`'s column reader, `DbtExportAnnotator`.
The mapper-internal `BinaryPattern` union (four-way, exhaustive) is a
near-zero-radius companion.

### 7. `ElementChange` for diff and level (provisional)

From WS3's table: `elementDiff` yields typed changes carrying their
level; `breakingLevel` switches exhaustively instead of regex-parsing
prose; `changeDescriptions` stays as a derived string array so cli, mcp
and vscode -- which only print -- do not change. `ModelDelta` becomes a
union on `kind` so `existing`/`incoming` are non-optional where present
and the 14 `!` in `ModelMerge` go.

### 8. `splitModel` over the typed model (provisional)

Build each domain as an `OrmModel` from `toConfig()` values and
serialize; delete the `Raw*` layer (lines 85-149), the eight-key walk,
and both defensive round-trips, since construction enforces referential
integrity. Depends on WS3. The header's justification for the raw path
("carries every field, including ones this code does not enumerate")
does not hold: the schema forbids unknown keys everywhere and
`parse`/`stringify` drops comments regardless.

## API and migration impact

- Nothing in `.orm.yaml` changes in any workstream; every serializer
  change is byte-identical output, guarded by the round-trip tests and
  the golden examples.
- Additive on the metamodel: `toConfig()` on `ObjectType`/`FactType`,
  `OrmModel.resolveConstraint`. Narrowing: `Constraint.id` required on
  the model type (Open decision 1) -- literal constraints in tests,
  `llm`'s parser and `formats`' importers construct through
  `ConstraintConfig`, where it stays optional, so the compile fallout is
  in core only.
- `RelationalSchema` (WS6) is a public type consumed by `formats` and
  `dbt`; that workstream is the only one with cross-package fallout,
  which is why it is provisional and late.
- Downstream packages see no behaviour change from WS1-WS5, WS7, WS8.
  WS0 changes behaviour where today's behaviour is the defect.

## Open decisions (for review)

- **Require `Constraint.id` on the model type.** Today `FactType`
  always mints one and 19 validation sites still write `c.id ?? ft.id`.
  Options: (a) `id: string` on `Constraint`, `id?` on `ConstraintConfig`
  -- every reader drops the `??`, the compile fallout is core-internal;
  (b) leave it. Recommended: (a), as part of WS2. It also settles what
  `addConstraint` accepts: a config, validated into a constraint.
- **A `ModelFragment` type versus `skipPlayerValidation`.** The merge
  builds fragments with unresolved players through a boolean flag, and
  six consumer sites pay for it with `?? id`. Options: (a) a separate
  fragment type the merge uses, so a whole `OrmModel` never carries an
  unresolved player; (b) keep the flag and accept the six guards.
  Recommended: (a), but only after WS7 reshapes the merge, since that
  is the only producer of fragments.
- **Whether WS6 is worth its cross-package radius now.** The mapping
  cluster is the one where the representation-driven share is highest
  and the fix is cleanest, but it touches `formats` and `dbt`. Options:
  land it after WS3 and WS7 when the pattern is proven core-internal,
  or land it first because barwise-931 sits in it. Recommended: after;
  931 can be closed by a test either way.
- **Whether to pursue the `EntityType | ValueType` split at all.** The
  issue's framing leans toward it; the review does not. Recommended:
  no, and say so in barwise-x4z so the wider analysis does not re-open
  it without new evidence.

## Risks and testing

- Every workstream is guarded by the existing suite: round-trip tests
  and golden examples for the serializer, the corpus for verbalization,
  the Rmap tests for mapping, `populationValidation.test.ts` for the
  rules. A workstream that changes any golden byte is wrong by
  definition, except WS0 where the golden was the defect.
- The tests that pin fallback prose ("bogus", "[tuple]", `"!="`) are
  the limitation-pinned class the `assertion-audit` skill names; WS2
  and WS5 delete them deliberately and say so in the commit.
- Coverage thresholds will move up, not down: the uncovered branches
  are the ones being deleted. Do not lower a threshold to land a
  workstream.
- WS4 and WS5 share the resolver; land WS4 first so the resolver is
  designed against the harder consumer.

## Non-goals

- Reducing branch count for its own sake. The inherent half stays, and
  a workstream that removes a domain case to make a number smaller is
  wrong.
- Changing the serialized format or its schema.
- Answering barwise-x4z in full. This spec covers the type-system axis
  where branching made it measurable; the purity axis (hidden mutation,
  effect seams) is not examined here beyond noting that
  `skipPlayerValidation` is a flag where a type belongs.

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
