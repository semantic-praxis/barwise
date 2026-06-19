# Object cardinality constraints for ORM 2

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-19
Last-updated: 2026-06-19
Tracking: barwise-5t9.4, barwise-5t9 (epic),
docs/adr/0001-metamodel-evolution-policy.md, docs/NORMA_VS_ORM_YAML.md

## Principle

This is the first Tier-2 construct (ADR-0001), and it fills a real
expressiveness gap: barwise can bound how many times an object plays a
_role_ (`FrequencyConstraint` -- "each Customer places 2..5 Orders") but
not how many _instances_ a population may contain. ORM 2 calls the latter
a **cardinality constraint**, and the book and NORMA both treat it as a
distinct kind: "there are at most 50 Departments", "between 2 and 10
Promotions are active". Today such a rule is unrepresentable, so it is
silently lost on import and cannot be authored.

ORM 2 -- and NORMA's schema -- recognize two distinct cardinality
subjects, confirmed in the XSD (barwise-5t9.4 notes):

- **Object-type cardinality** (`ObjectTypeCardinalityRestrictionType`):
  bounds the number of instances of an object type. "There are at most 50
  Departments."
- **Unary-role cardinality** (`UnaryRoleCardinalityRestrictionType`):
  bounds the number of object instances that play a unary role. "At most
  10 Promotions are active" (the unary fact type _Promotion is active_).

These are different concepts on different elements, so the design models
them on different elements -- orthogonality over a forced unification -- while
sharing one range value type so the count semantics are not duplicated.

## Should the two be one constraint or two homes? (resolved: two homes)

Two homes, one shared range. Object-type cardinality is a property of an
_object type_ and has no natural fact-type owner; unary-role cardinality is
a property of a _role_ inside a unary fact type. Forcing both into a single
`CardinalityConstraint` with an `objectTypeId`-XOR-`roleId` shape would put
an object-type-scoped rule into a fact type's constraint list (where it has
no role to attach to) and create an illegal-state pair (both ids set, or
neither). Splitting by subject keeps each rule on the element it constrains:

- Object-type cardinality -> a `cardinality?: CardinalityRange` field on
  `ObjectType`, exactly mirroring the existing `valueConstraint?:
  ValueConstraintDef` field, which is the established precedent for an
  object-type-level restriction that is not a fact-type constraint.
- Unary-role cardinality -> a `CardinalityConstraint` member of the
  `Constraint` union, keyed on `roleId`, living in the unary fact type's
  constraint list alongside the other role-scoped constraints.

DRY is preserved where it does not cost orthogonality: both reuse a shared
`CardinalityRange { min; max }` (the same `min` / `max | "unbounded"` shape
`FrequencyConstraint` already uses), so the bound semantics live in one
type. This is the secondary-principle trade the project's design rules call
for -- duplicate the _placement_ (two elements, two concepts) but not the
_range_.

## Where does object-type cardinality live? (resolved: ObjectType field)

A field on `ObjectType`, not a new model-level constraint collection.
`ObjectType` already carries `valueConstraint`, `defaultValue`, `note`, and
`independent` as optional fields with the round-trip / schema / diff
machinery wired per field; `cardinality` is the same kind of object-type
property and follows the same path. Introducing a model-level constraint
list (or an object-type constraint list) to hold one new rule would be new
aggregate machinery for a single field -- explicit-over-implicit favors the
field that says exactly what it constrains.

## Scope

In scope:

- A `CardinalityRange { min: number; max: number | "unbounded" }` value
  type, shared by both subjects.
- `ObjectType.cardinality?: CardinalityRange` (object-type population) with
  config, getter, round-trip, schema, diff, verbalization, validation.
- A `CardinalityConstraint { type: "cardinality"; roleId; min; max }`
  union member (unary-role occurrence) with guard, round-trip, schema,
  diff, verbalization, validation.
- Validation against sample populations: a population that exceeds or falls
  short of a bound is flagged, population-gated (only object types / roles
  that actually appear in a population are checked).
- NORMA import (and symmetric export) of both XSD elements, grounded
  against `ORM2Core.xsd` before implementation.

Out of scope:

- **Multi-role (role-sequence) cardinality.** ORM 2's cardinality applies
  to a single object type or a single unary role; role-sequence frequency
  is the separate barwise-5t9.8 construct.
- **Cardinality on n-ary (non-unary) roles.** The XSD restricts role
  cardinality to unary roles; barwise mirrors that and validates the
  fact type's arity is 1.
- **Modality interplay beyond the inherited field.** `CardinalityConstraint`
  extends `ConstraintBase`, so it carries `modality` for free; the
  object-type `cardinality` field is not a `Constraint` and has no
  modality (object-type restrictions are alethic, matching
  `valueConstraint`).

## Inventory

| Module                                           | Change                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `core/src/model/Constraint.ts`                   | `CardinalityRange` type; `CardinalityConstraint` interface + union member + `isCardinality` guard |
| `core/src/model/ObjectType.ts`                   | `cardinality?: CardinalityRange` config field, private slot, getter                               |
| `core/src/index.ts`                              | Export `CardinalityRange`, `CardinalityConstraint`, `isCardinality`                               |
| `core/src/serialization/OrmYamlSerializer.ts`    | Round-trip object-type `cardinality` and the `cardinality` constraint branch                      |
| `core/schemas/orm-model.schema.json`             | `cardinality` on the object-type schema; a `cardinality` constraint branch                        |
| `core/src/verbalization/ConstraintVerbalizer.ts` | Verbalize the unary-role cardinality constraint                                                   |
| `core/src/verbalization/Verbalizer.ts`           | Verbalize object-type population cardinality (alongside object-type output)                       |
| `core/src/validation/rules/population/*.ts`      | A cardinality population rule (object-type count and unary-role count)                            |
| `core/src/diff/elementDiff.ts`                   | Object-type `cardinality` compare in `diffObjectType`; `cardinality` case in `constraintTypeKey`  |
| `formats/` (NORMA importer/exporter)             | Map both XSD cardinality elements (WS4, XSD-grounded)                                             |

Not affected: the relational mapper / DDL (a population-count bound has no
column projection) and `OrmProject` (single-model construct).

## Target architecture

```
CardinalityRange = { min: number; max: number | "unbounded" }   // model/Constraint.ts
                   // min defaults 0; max "unbounded" = no upper limit
                   // (same shape FrequencyConstraint already uses)

ObjectType.cardinality?: CardinalityRange        // object-type population bound
                                                 // peer of valueConstraint, alethic

interface CardinalityConstraint extends ConstraintBase {   // unary-role occurrence
  readonly type: "cardinality";
  readonly roleId: string;                       // a role in a unary fact type
  readonly min: number;
  readonly max: number | "unbounded";
}                                                // added to the Constraint union
                                                 // -> exhaustive switches force the case

.orm.yaml:
  object_type:
    cardinality: { min: 2, max: 10 }             // emitted only when present
  constraints:
    - type: cardinality                          // in a unary fact type
      role: <roleId>
      min: 0
      max: 50

validation (population-gated, deterministic):
  object-type:  count = |buildObjectUniverse(model).get(objectType.id)|
  unary-role:   count = |valuesPlayedInRole(model, roleId)|
  flag when count < min or (max != "unbounded" and count > max)

verbalization:
  object-type:  "There are at most 50 Department instances."
  unary-role:   "At most 10 Promotion objects are active."
```

## Alternatives considered

- **One unified `CardinalityConstraint` with `objectTypeId` XOR `roleId`.**
  Rejected: it admits illegal states (both or neither id), and it forces an
  object-type-scoped rule into a fact type's constraint list where it has no
  role to bind to. The two-home split keeps each rule on the element it
  constrains.
- **A new model-level (or object-type-level) constraint collection** to
  host object-type cardinality as a `Constraint`. Rejected: new aggregate
  machinery for one field, when `ObjectType` already carries object-level
  restrictions (`valueConstraint`, `defaultValue`) as plain fields.
- **Overloading `FrequencyConstraint`** to mean population size when some
  flag is set. Rejected: frequency bounds role plays per object; cardinality
  bounds population size -- conflating them is exactly the gap this construct
  closes, and the bd issue is explicit that they must not be merged.
- **Deferring unary-role cardinality to a follow-on**, shipping only
  object-type. Rejected: the two share the range type and validation
  scaffold, NORMA models both, and the bd note says cover both; splitting
  them would duplicate the round-trip/schema/diff work across two PRs for
  no orthogonality gain.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. WS1-WS3 are core-only and additive;
WS4 is the connector mapping and is gated on XSD verification.

### 1. Model + serialization + schema + diff

Add `CardinalityRange`, the `cardinality` field on `ObjectType`, and the
`CardinalityConstraint` union member + `isCardinality` guard. Round-trip
both (object-type field and constraint branch), add the schema entries, and
extend `diffObjectType` (cardinality compare) and `constraintTypeKey` (a
`CARD:` case). Round-trip tests per the established additive-construct
pattern. No behavior beyond storage yet. Additive -- no `orm_version` bump
(1.1 is the open cycle; ADR-0001 schema-versioning rule, one bump per
cycle). The exhaustive constraint switches (serializer, verbalizer, diff)
will not compile until the new case is handled -- the build is the checklist.

### 2. Validation: population bounds

Add a cardinality population rule. For each object type with a
`cardinality`, count its instances via `buildObjectUniverse` and flag when
the count is outside `[min, max]`. For each `CardinalityConstraint`, count
the distinct objects playing the role via `valuesPlayedInRole` and flag
likewise. Population-gated: when no population mentions the object type or
role, emit nothing (absence of data is not a violation, consistent
with the existing population rules). Severity follows
`severityForModality` for the constraint (the object-type field is alethic).
Cases: a population of 60 against `max: 50` -> diagnostic; a population of 3
against `min: 2, max: 10` -> none.

### 3. Verbalization

Verbalize both. Unary-role cardinality joins the constraint verbalizer:
"{Quantifier} {Type} objects {reading}" (at most N / at least N / between N
and M / exactly N), reusing the frequency quantifier phrasing. Object-type
cardinality is verbalized with the object type itself in `Verbalizer.ts`:
"There are {quantifier} {Type} instances." Goldens per form.

### 4. NORMA import/export (XSD-grounded)

Map `ObjectTypeCardinalityRestrictionType` -> the object-type `cardinality`
field and `UnaryRoleCardinalityRestrictionType` -> the `CardinalityConstraint`,
and the symmetric export. Ground the exact nesting (the
`CardinalityRanges` / `CardinalityRange` `From` / `To` shape) against
`ORM2Core.xsd` before writing the mapping. If the encoding proves uncertain
on inspection, defer per the standing NORMA-mapping caution and file the
follow-on -- the core construct (WS1-WS3) stands on its own.

## API and migration impact

- New public types `CardinalityRange`, `CardinalityConstraint`, and the
  `isCardinality` guard from `@barwise/core`; `cardinality` added to
  `ObjectTypeConfig` / `ObjectType` (additive, no existing signature
  changes).
- No `orm_version` bump: both additions are optional and additive, and 1.1
  is already the open cycle.
- Blast radius: adding `CardinalityConstraint` to the union makes every
  exhaustive `switch (c.type)` (serializer, verbalizer, diff key) a compile
  error until handled -- intended, and the one-way build surfaces each site.
  The `ObjectType` field touches only sites that read it.

## Open decisions (for review)

- **Two homes vs one unified constraint (recommend: two homes).** Object-type
  cardinality as an `ObjectType` field, unary-role cardinality as a
  `Constraint`. Matches the two NORMA XSD elements and avoids an
  illegal-state union member. The alternative (one constraint, two optional
  ids) is simpler to enumerate but admits invalid combinations.
- **Population-gating absent data (recommend: skip).** A `min: 2` bound on
  an object type with no sampled instances emits nothing, matching every
  other population rule (they fire only on present data). The alternative
  -- treating zero instances as a `min` violation -- would make every
  cardinality-bearing type error in models that carry no population, which
  is noise.
- **Unary-only role cardinality (recommend: enforce arity 1).** The XSD
  restricts role cardinality to unary roles; barwise validates the
  constraint's fact type has arity 1 and reports a structural error
  otherwise. The alternative (allow any role) diverges from ORM 2 and the
  count semantics get ambiguous on n-ary roles.

## Risks and testing

- The verbalization phrasing is the subjective part: the bar is that each
  form reads as a recognizable cardinality statement and that all existing
  goldens stay green (the constructs are new, so no prior verbalization
  changes).
- Determinism holds: cardinality is stored data; the count is a pure
  function of the populations. `check-core-purity` guards it.
- Each concern ships a test: round-trip (object-type field and constraint
  both round-trip, omitted when absent), validation (over- and under-population
  against both subjects, plus the no-population skip), and verbalization
  goldens for both forms.
- WS4 risk is the XSD encoding; the grounding step and the standing
  defer-if-uncertain rule contain it, and WS1-WS3 do not depend on it.

## Non-goals

- No role-sequence / multi-role cardinality (that is barwise-5t9.8).
- No cardinality on n-ary roles; unary roles only, per the XSD.
- No relational / DDL projection of a population-count bound.
- No new model-level constraint aggregate; object-type cardinality is a
  field, matching `valueConstraint`.
