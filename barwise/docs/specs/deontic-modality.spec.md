# Deontic modality for ORM 2 constraints

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-19
Last-updated: 2026-06-19
Tracking: barwise-5t9.3, barwise-5t9 (epic),
docs/adr/0001-metamodel-evolution-policy.md, docs/NORMA_VS_ORM_YAML.md

## Principle

This is the last Tier-1 construct (ADR-0001), and the one that carries
real semantics rather than a passive field. ORM 2 separates **alethic**
constraints (logical necessity -- they cannot be violated in any valid
population; the default) from **deontic** constraints (obligation -- they
_should_ hold, and a violation is recorded rather than impossible).
barwise models only alethic today: every constraint is an implicit hard
rule, so a deontic business rule ("a manager _should not_ approve their
own expense") is unrepresentable and, if entered as a normal constraint,
is wrongly reported as a hard error.

ADR-0001 rule 4 says design against the book, not NORMA's tooling. The
honest reading: the book's _graphical notation_ marks each constraint
alethic or deontic -- a single per-constraint tag -- and that is exactly
what barwise should model. The cited "single main modal operator" NORMA
limit and the book's deeper modal logic both concern _nested/compound_
modal formulae, which no practical tool needs and barwise will not model.
Where barwise actually honors the distinction -- and where treating
deontic as alethic is a _bug_ -- is the validation semantics: a deontic
violation is a warning, not an error. That semantic, not the label, is
the point of this change.

## Should modality live on a shared base or per-interface? (resolved: shared base)

Shared base. `id` and `modality` are universal properties of every
constraint, so a `ConstraintBase { id?; modality? }` that each of the
twelve interfaces `extends` expresses that in the type system instead of
repeating it as if it were a coincidence. The discriminated union is
unaffected: each interface keeps its own `type` literal discriminant, so
every type guard (`c.type === "..."`) and every exhaustive switch still
narrows correctly; the base only contributes the two shared optional
fields, which existing constraint literals already omit. The refactor is
mechanical and safe -- replace each interface's `readonly id?: string`
with `extends ConstraintBase` -- and it makes the next shared field (if one
ever arrives) a one-line base edit rather than a twelve-fold one. DRY here
does not compromise orthogonality: the union, its members' discriminants,
and their guards are unchanged, so the model simply says what it means.

## Should a deontic violation be an error or a warning? (resolved: warning)

A warning. This is the whole reason the construct earns its place. An
alethic constraint violated by the sample population is an `error` (the
model is inconsistent); a deontic constraint violated is a `warning` (the
obligation is unmet but the population is still valid). The population
rules currently hardcode `severity: "error"`; each rule that checks a
specific constraint has that constraint in hand, so it selects severity
from `constraint.modality` via a one-line helper rather than a literal.
Rules not tied to a modality-bearing constraint (dangling references,
structural checks) are unaffected.

## Scope

In scope:

- A `ConstraintModality = "alethic" | "deontic"` type and an optional
  `modality` on every constraint (default alethic).
- Serializer round-trip: `modality` is emitted only when `"deontic"`
  (alethic is the omitted default), so every existing file is unchanged.
  Additive -- no `orm_version` bump (1.1 is already open).
- JSON Schema: a `modality` enum property on the constraint shape.
- Verbalization: deontic constraints soften the modal phrasing (must ->
  should, must not -> should not) and, where a family has no modal verb,
  prefix the FORML deontic form "It is obligatory that ...".
- Validation: a deontic constraint's population violation is a `warning`,
  via a `severityForModality(constraint)` helper threaded through the
  population rules that check a named constraint.

Out of scope:

- **NORMA `Modality` import/export.** Deferred to the NORMA-mapping
  follow-on; NORMA's exact `Modality="Deontic"` encoding needs XSD
  verification, the same caution as the other deferred NORMA mappings.
- **Nested or compound modal formulae** (the book's deeper modal logic).
  A single per-constraint tag is the standard notation; compound modality
  is a non-goal for barwise.
- **Modality on non-constraint elements** (object/fact types). ORM 2
  modality is a constraint property.

## Inventory

| Module                                           | Change                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `core/src/model/Constraint.ts`                   | `ConstraintModality` type; `ConstraintBase` (id + modality) each interface extends |
| `core/src/index.ts`                              | Export `ConstraintModality` (and any helper made public)                           |
| `core/src/serialization/OrmYamlSerializer.ts`    | Round-trip `modality` on each constraint (emit only deontic)                       |
| `core/schemas/orm-model.schema.json`             | `modality` enum on the constraint branches                                         |
| `core/src/verbalization/constraints/phase1,2.ts` | Deontic modal-verb softening + obligatory-prefix fallback                          |
| `core/src/validation/rules/population/*.ts`      | `severityForModality` helper; deontic violation -> `warning`                       |
| `core/src/diff/elementDiff.ts`                   | Fold `modality` into the constraint key (so a modality change diffs)               |

Not affected: the format registry, the relational mapper/DDL (modality
has no relational projection), and `OrmModel`/`ObjectType` (constraint
property only).

## Target architecture

```
ConstraintModality = "alethic" | "deontic"          // model/Constraint.ts

interface ConstraintBase {                           // NEW shared base
  readonly id?: string;                              // moved from each interface
  readonly modality?: ConstraintModality;            // NEW, default alethic
}
interface <Each>Constraint extends ConstraintBase {
  readonly type: "...";                              // discriminant unchanged
  ...                                                // constraint-specific fields
}

.orm.yaml:  a constraint carries `modality: deontic` only when deontic;
            alethic constraints omit it (lossless, no churn to 1.0/1.1
            files, no orm_version bump).

validation: severityForModality(c) = c.modality === "deontic"
              ? "warning" : "error"
            -- the population rules that check a named constraint use it
            instead of the "error" literal.

verbalization: deontic -> soften modals (must/should) or prefix
               "It is obligatory that ..."; alethic unchanged.
```

## Alternatives considered

- **Per-interface repetition of `modality?`** (no base). Rejected: it
  treats a universal constraint property as a coincidence and repeats the
  field twelve times, and it makes any future shared field another
  twelve-fold edit. The shared base expresses the domain at no cost to
  orthogonality, since the discriminants and guards are unchanged.
- **Separate deontic constraint variants** (`deontic_mandatory`, ...).
  Rejected: modality is orthogonal to constraint type, so variants would
  double the union and every switch for no benefit.
- **Deontic violations as errors** (just a label, no semantic). Rejected:
  it defeats the purpose -- a deontic obligation that fails validation as
  hard as a necessity is indistinguishable from alethic, so the construct
  would be inert.
- **Modeling compound modal formulae.** Rejected as a non-goal: not in
  the book's graphical notation, not needed by any consumer, and at odds
  with the lean-format principle.

## Workstreams (each independently shippable)

Likely one PR (the field is small and the three concerns are cohesive),
but split if review prefers. Ordered smallest-blast-radius first.

### 1. Model + serialization + schema + diff

Add `ConstraintModality` and the optional `modality` field; round-trip it
(emit only deontic); add the schema enum; fold `modality` into the diff
key so a deontic/alethic change is a real diff. Round-trip test per the
established additive-construct pattern. No behavior change yet -- the field
is inert until WS2/WS3.

### 2. Validation: deontic violations are warnings

Add `severityForModality(constraint)` and route the population rules that
check a named constraint through it. When a deontic constraint is violated
by a population, the system shall emit a `warning`, not an `error`; when an
alethic constraint is violated, the severity is unchanged (`error`). Cases:
the same population violating an alethic vs a deontic copy of a constraint
yields `error` vs `warning`.

### 3. Verbalization: deontic phrasing

Thread modality into the constraint verbalizers: deontic softens the modal
verb (must -> should, must not -> should not) where the family has one, and
otherwise prefixes "It is obligatory that ...". When a constraint is
deontic, its verbalization shall read as an obligation; alethic
verbalizations are byte-for-byte unchanged. Verbalization goldens per
modified family.

## API and migration impact

- New public type `ConstraintModality` from `@barwise/core`; `modality`
  added to the constraint interfaces (additive, no existing signature
  changes). `severityForModality` stays internal to validation unless a
  consumer needs it.
- No `orm_version` bump: the field is additive and optional, and 1.1 is
  already the open cycle (ADR-0001 schema-versioning rule -- one bump per
  cycle, already spent on 5t9.9).
- Blast radius: the exhaustive constraint switches (serializer,
  verbalization, diff) compile unchanged because `modality` is a field,
  not a new union member; only the sites that read it are touched. The
  one-way build surfaces any downstream drift.

## Open decisions (for review)

- **Constraint shape: shared base vs per-interface (resolved: shared
  base).** `ConstraintBase` carries `id` + `modality`; each interface
  `extends` it. Resolved during review -- the base expresses a universal
  property without touching the union's discriminants or guards. Recorded
  here for the trail.
- **Deontic violation severity: `warning` vs a dedicated channel.**
  Recommend `warning` (reuses the existing severity ladder; tools already
  render warnings distinctly). A dedicated `ruleId` suffix
  (`...-deontic`) can ride along for filtering without a new channel.
- **Modality on all constraints vs a subset.** Recommend the field on all
  (uniform, future-proof); verbalization modal-switching is wired only
  where a family has a natural phrasing, the rest carry the field and use
  the obligatory-prefix fallback.

## Risks and testing

- The verbalization phrasing is the subjective part: the acceptance bar is
  that a deontic constraint reads as an obligation a reviewer recognizes,
  and that every alethic verbalization is unchanged (guarded by the
  existing goldens staying green).
- Determinism holds: modality is stored data; severity selection is a pure
  function of the constraint. `check-core-purity` guards it.
- Each concern ships with a test: round-trip (deontic round-trips, alethic
  omitted), validation (alethic error vs deontic warning on the same
  violated population), and verbalization goldens.

## Non-goals

- No NORMA modality import/export (deferred, XSD-gated).
- No compound/nested modal operators; a single per-constraint tag only.
- No modality on object or fact types; no relational/DDL projection.
