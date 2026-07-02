# OrmYamlSerializer decomposition

Status: Implemented (merged in #247) -- OrmYamlSerializer 935 -> 259, split
into per-element-kind modules under serialization/yaml/. Nothing outstanding.
Created: 2026-06-23
Last-updated: 2026-06-24
Tracking: REPO_REVIEW-2026-06-23.md F3,
docs/specs/god-file-decomposition.spec.md (supersedes its "keep -- cohesive
pair" disposition for this file),
docs/specs/refactor-metamodel-consolidation.spec.md (Lane B ownership),
barwise-5t9 (the constructs that drove the growth)

## Principle

`core/src/serialization/OrmYamlSerializer.ts` is the one core file that
materially grew this cycle -- 667 -> 935 lines -- because it is the single
sink every new metamodel construct edits. The Tier-1/2 batch (deontic
modality, value comparison, object cardinality, multi-role frequency,
independent types, defaults, notes, derivation) and the role-path operands
all threaded their serialize/deserialize through this one file. That is the
"every new symbol edits one file" anti-pattern F2 diagnosed for the core
barrel, now living in the serializer.

This is an orthogonality problem with a cost the metamodel thread pays
directly: the serializer is on their hot path (the conflict surface), so the
file's size and the breadth of what a construct must touch in it are a
recurring tax -- and, across threads, the file's churn is a collision point.
Splitting it by element kind shrinks the unit a construct edits from a
935-line god file to one small per-kind module, which both restores the
one-concern-per-module pillar and reduces the conflict-surface footprint.
The split is pure code organization: the transforms stay deterministic, the
orchestration keeps the referential-integrity ordering, behavior is
unchanged.

## Should we decompose it? (resolved: yes -- by element kind, keeping each serde pair together)

The god-file spec deliberately marked this file _keep (cohesive pair);
watch_ -- the reasoning being that serialize and deserialize for a construct
belong together, and a split risks scattering that pair. F3 records that the
watch tripped: the file crossed 900 lines and became the metamodel sink.

The resolution honors the original concern rather than overriding it. Split
**by element kind, not by direction** -- each module owns one kind's wire
interface _and_ both its serialize and deserialize functions. The cohesive
pair the god-file spec wanted to protect stays co-located (per kind); what
ends is the single-file growth. This also completes a pattern the metamodel
thread already began organically: it extracted `serializeValueConstraintBody`,
`serializeRolePath`, `serializeJoinOperand`, and `serializeDerivation` as
free-function pairs as those constructs landed. The decomposition formalizes
and finishes that move; it is not a foreign structure imposed on the file.

## Scope

In scope: extract the per-element-kind wire interfaces and their
serialize/deserialize functions out of `OrmYamlSerializer.ts` into a
`serialization/yaml/` module set; reduce the `OrmYamlSerializer` class to the
orchestration it alone should own (entry points, version migration, schema
validation, and the `toDocument`/`fromDocument` ordering).

Out of scope: any behavior change, any change to the public API
(`serialize`/`deserialize`), any change to the wire format or the JSON
Schema, and the role-path projected-tuple revision itself (that is the
metamodel thread's, and interacts with sequencing below). No change to the
sibling serializers (`MappingSerializer`, `ProjectSerializer`).

## Inventory

What moves out of `OrmYamlSerializer.ts` (935 lines) into
`serialization/yaml/`. Each module carries the `OrmYaml*` wire interface plus
its `serialize*`/`deserialize*` pair.

| Element kind        | Current home in the file                          | New module                |
| ------------------- | ------------------------------------------------- | ------------------------- |
| Value constraint    | `serialize/deserializeValueConstraintBody` (fns)  | `yaml/valueConstraint.ts` |
| Role path / operand | `serialize/deserializeRolePath`, `JoinOperand`    | `yaml/rolePath.ts`        |
| Derivation rule     | `serialize/deserializeDerivation` (fns)           | `yaml/derivation.ts`      |
| Object type         | `serializeObjectType` + inline deser in `fromDoc` | `yaml/objectType.ts`      |
| Fact type + role    | `serializeFactType`, `serializeRole` + inline     | `yaml/factType.ts`        |
| Constraint (union)  | `serializeConstraint`, `deserializeConstraint`    | `yaml/constraint.ts`      |
| Subtype fact        | `serializeSubtypeFact` + inline deser             | `yaml/subtype.ts`         |
| Objectification     | `serializeObjectifiedFactType` + inline deser     | `yaml/objectified.ts`     |
| Population          | `serialize/deserialize` population + instance     | `yaml/population.ts`      |
| Definition          | `serializeDefinition` + inline deser              | `yaml/definition.ts`      |
| Diagram layout      | `serializeDiagramLayout` + inline deser           | `yaml/diagram.ts`         |
| Document shape      | `OrmYamlDocument` + model-level fields            | `yaml/document.ts`        |

`OrmYamlSerializer.ts` keeps: the `OrmYamlSerializer` class (`serialize`,
`deserialize`, `migrateToCurrentVersion`, and the `toDocument`/`fromDocument`
orchestration that fixes the add-order for referential integrity),
`DeserializationError`, and `versionErrorMessage`. The `SchemaValidator`
instance and migration plumbing stay with it.

## Target architecture

```
core/src/serialization/
  OrmYamlSerializer.ts     orchestrator: serialize/deserialize entry,
                           migrate, schema-validate, toDocument/fromDocument
                           (owns the deterministic add-order), errors
  yaml/
    document.ts            OrmYamlDocument + model-level header fields
    objectType.ts          OrmYamlObjectType + serde
    factType.ts            OrmYamlFactType, OrmYamlRole + serde
    constraint.ts          OrmYamlConstraint(Body) union + serde
    subtype.ts             OrmYamlSubtypeFact + serde
    objectified.ts         OrmYamlObjectifiedFactType + serde
    population.ts          OrmYamlPopulation, OrmYamlFactInstance + serde
    definition.ts          OrmYamlDefinition + serde
    diagram.ts             OrmYamlDiagramLayout + serde
    valueConstraint.ts     OrmYamlValueConstraint + value ranges + serde
    rolePath.ts            OrmYamlRolePath, OrmYamlJoinOperand + serde
    derivation.ts          OrmYamlDerivation + serde
```

The deserialize side becomes a pure translation per kind:
`deserializeObjectType(otDoc) -> AddObjectTypeArgs`, with `fromDocument`
calling `model.addObjectType(deserializeObjectType(otDoc))`. The model
mutation and its ordering stay in `fromDocument`; only the wire-to-args
translation moves out. Wire interfaces stay internal to `serialization/`
(not added to the public root barrel), so the public API is untouched.

## Workstreams

One PR. The extraction is mechanical and behavior-preserving, and a
half-decomposed serializer is worse than either endpoint, so it lands as a
single change rather than a staged sequence -- but it is reviewable
commit-by-commit, one commit per extracted module (sub-constructs first --
`valueConstraint`, `rolePath`, `derivation` -- then the element kinds that
depend on them, then the orchestrator slim-down). The full serialization
suite gates each commit.

## API and migration impact

- No public API change: `OrmYamlSerializer.serialize`/`deserialize` keep
  their signatures; the `OrmYaml*` wire types were never exported and stay
  internal to `serialization/`. Downstream packages (`@barwise/llm`,
  `barwise-vscode`, the connectors) are unaffected.
- No wire-format or JSON Schema change -- this serializes exactly what it
  serializes today.
- Blast radius is one directory. The one-way build still rebuilds core's
  dependents, which is the guard that nothing drifted.

## Sequencing and ownership (the open coordination point)

This file is on the metamodel thread's Lane-B conflict surface
(`refactor-metamodel-consolidation.spec.md`), and there is in-flight work
that edits it: the **role-path projected-tuple revision** (pending sign-off)
will change `serializeJoinOperand`/`deserializeJoinOperand` and the join
branches of the constraint serde. A structural move that relocates those
into `yaml/rolePath.ts` and `yaml/constraint.ts` collides with that revision
if both are open at once.

Two orderings, and this is a joint call (architecture + metamodel threads):

- _Decompose first (recommended)._ Land the extraction while the tuple
  revision is still held for sign-off, then the revision rebases onto
  `yaml/rolePath.ts` + `yaml/constraint.ts` -- editing two small modules
  instead of the god file. The decomposition is behavior-preserving and
  fast, so the rebase is a path change, and the revision arguably gets
  _easier_.
- _Decompose after._ Let the tuple revision land, then extract against the
  settled shape. Safer against collision, but the metamodel thread keeps
  paying the god-file tax for the revision and any 5t9 work in between.

Recommend decompose-first, contingent on the metamodel thread confirming the
tuple revision can rebase rather than being mid-flight in the same files. If
they are actively editing the join serde now, fall back to decompose-after.
Either way, the decomposition does not start until that sequencing is agreed.

## Risks and testing

- The risk is an extraction that silently changes a transform. The guard is
  strong and already in place: the property round-trip
  (`tests/property/roundTrip.property.test.ts`, random models through
  serialize -> deserialize), the direct `OrmYamlSerializer.test.ts`, the
  per-construct serialization suites (Join/Phase2/Subtype/Population/Aliases/
  Objectified/DiagramLayout/SchemaVersioning), and the integration
  round-trips. The bar is behavioral parity -- every suite green, unchanged.
- Run `npm run build`, `npm run test`, `npm run lint`, `npm run depcruise`,
  and `npm run purity` after the change; `npm run filesize` should show the
  serializer dropping off the >600 list.
- Determinism is preserved by construction: the per-kind functions are pure
  transforms, and `fromDocument` retains the add-order; `check-core-purity`
  guards it.

## Non-goals

- No behavior, wire-format, or JSON Schema change; no new construct.
- No public-API change; the wire types stay internal to `serialization/`.
- No change to `MappingSerializer` or `ProjectSerializer`.
- Not a generalized "serializer framework" -- this is a by-kind extraction
  of the existing logic, nothing more.
