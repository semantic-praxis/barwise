# Multi-role (role-sequence) frequency constraints

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-19
Last-updated: 2026-06-19
Tracking: barwise-5t9.8, barwise-5t9 (epic),
docs/adr/0001-metamodel-evolution-policy.md, docs/NORMA_VS_ORM_YAML.md

## Principle

A frequency constraint ranges over a role _sequence_; barwise models only
a single role, so the general form is unrepresentable. ORM 2 lets a
frequency constraint bound how often a _combination_ of role values occurs
-- "each (Room, TimeSlot) combination is booked 0..1 times" -- exactly as a
uniqueness constraint already spans a role sequence in barwise
(`InternalUniquenessConstraint.roleIds`). Today `FrequencyConstraint.roleId`
is a single string, so a multi-role NORMA frequency constraint is narrowed
to one role on import and the combination semantics are lost. This is the
last Tier-2 construct, and the smallest: it widens an existing field to the
shape its sibling constraint already uses.

Determinism is preserved (ADR-0001): the validation counts distinct value
_tuples_ across the role sequence -- a pure function of the population, the
same tuple machinery uniqueness and set-comparison already use
(`tuplesForRoleSeq`). No new evaluation concern enters core.

## Should `roleId` become `roleIds`, or gain a parallel field? (resolved: replace)

Replace `roleId: string` with `roleIds: readonly string[]`. A single-role
frequency is just a length-1 sequence, exactly as internal uniqueness
treats it; a parallel optional `roleIds?` alongside `roleId` would make two
fields express one concept and leave every reader to reconcile them. The
file format stays backward compatible without a parallel _model_ field: the
serializer reads both the legacy `role:` (single) and the new `roles:`
(sequence) keys, and emits `role:` when the sequence has length 1 -- so every
existing `.orm.yaml` round-trips byte-for-byte and only genuinely multi-role
constraints use `roles:`. The in-memory type change is a breaking shape
change, but barwise ships no published packages; the one-way build surfaces
each of the few readers (core verbalization/validation/diff, the diagram
graph, the LLM draft parser, the NORMA mapper) mechanically -- `roleId`
becomes `roleIds[0]` at the single-role sites that stay single-role.

## Is NORMA multi-role import deferred? (resolved: no -- included)

Included, not deferred. Unlike the cardinality and derivation NORMA
mappings, this one needs no XSD verification: the NORMA parser _already_
reads the full role sequence (`NormaFrequencyConstraint.roleRefs` is an
array, built by `parseRoleSequenceRefs`), and the mapper currently throws
the extra roles away (`nc.roleRefs.find(...)` picks one). Once core carries
`roleIds`, the mapper maps the whole matching sequence and the export writes
it back -- the round-trip the acceptance criterion asks for, with the parsing
already in place. So NORMA round-trip rides in this change rather than a
follow-on.

## Scope

In scope:

- `FrequencyConstraint.roleIds: readonly string[]` (was `roleId: string`).
- Serializer back-compat: read `role` (legacy) or `roles`; emit `role` for
  a length-1 sequence, `roles` otherwise. No `orm_version` bump (1.1 open).
- JSON Schema: the frequency branch accepts `role` or `roles`.
- Validation: per-tuple counting across the role sequence (single-role
  behavior unchanged); the consistency check validates every role belongs
  to the fact type and the sequence is non-empty.
- Verbalization: a multi-role phrasing ("Each combination of {roles} occurs
  ... times"); single-role phrasing unchanged.
- Diff: the frequency key folds the (sorted) role sequence.
- Forced downstream updates the build requires: the diagram graph (single-
  role badge only), the LLM draft parser/conformance (single-role
  `[roleId]`), and the NORMA mapper/export (full sequence).

Out of scope:

- **Role order as semantics.** A frequency role sequence is a combination,
  not an ordered tuple; the declared order is preserved for stable display
  and tuple construction but carries no meaning (the diff key sorts).
- **Frequency over a join path** (roles in different fact types). Like the
  value-comparison join case, that waits on the role-path model
  (barwise-5t9.10). This construct stays within one fact type.

## Inventory

| Module                                                    | Change                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `core/src/model/Constraint.ts`                            | `FrequencyConstraint.roleId` -> `roleIds: readonly string[]`     |
| `core/src/serialization/OrmYamlSerializer.ts`             | Read `role`/`roles`; emit `role` for length 1, `roles` otherwise |
| `core/schemas/orm-model.schema.json`                      | Frequency branch accepts `role` or `roles` (one required)        |
| `core/src/verbalization/constraints/phase2.ts`            | Multi-role frequency phrasing; single-role unchanged             |
| `core/src/validation/rules/population/valueFrequency.ts`  | Count per value-tuple across the role sequence                   |
| `core/src/validation/rules/constraintConsistency.ts`      | Validate each role belongs to the fact type; non-empty sequence  |
| `core/src/diff/elementDiff.ts`                            | `FREQ` key folds the sorted role sequence                        |
| `diagram/src/graph/ModelToGraph.ts`                       | Single-role badge only (skip the multi-role case)                |
| `llm/src/DraftModelParser.ts`, `ExtractionConformance.ts` | Build/compare core frequency with `roleIds: [roleId]`            |
| `formats/src/norma/NormaToOrmMapper.ts`, NORMA writer     | Map/emit the full role sequence (parser already reads it)        |

Not affected: the relational mapper / DDL (frequency has no column
projection), the format registry, `OrmProject`, and the vscode tree (it
renders only `min`/`max`).

## Target architecture

```
interface FrequencyConstraint extends ConstraintBase {
  readonly type: "frequency";
  readonly roleIds: readonly string[];   // was roleId: string; length 1 = single-role
  readonly min: number;
  readonly max: number | "unbounded";
}

.orm.yaml (back-compat):
  - { type: frequency, role: r1, min: 0, max: 5 }          # length-1, legacy key kept
  - { type: frequency, roles: [r1, r2], min: 0, max: 1 }   # multi-role, new key

validation (deterministic, per-tuple):
  count occurrences of each distinct value-tuple across roleIds;
  flag tuples below min or above max  (single-role == today's behavior)

verbalization:
  single-role: unchanged ("Each Customer places at least 2 ... Orders.")
  multi-role:  "Each combination of Room, TimeSlot occurs at most 1 time."
```

## Alternatives considered

- **A parallel optional `roleIds?` beside `roleId`.** Rejected: two fields
  for one concept, with every reader forced to decide which is authoritative
  and an illegal both-set state. The length-1 sequence subsumes the single
  role cleanly, the way internal uniqueness already does.
- **A separate `multi_role_frequency` constraint type.** Rejected: frequency
  is one concept; a second union member doubles the guards, switches, and
  verbalizers for a difference that is just the arity of a field.
- **Deferring the NORMA round-trip.** Rejected here (unlike the other NORMA
  mappings): the parser already captures the role sequence, so finishing the
  mapping is a few lines and no XSD risk; deferring would leave the parsed
  roles dropped on the floor for no benefit.
- **Keeping `roleId` and storing extra roles elsewhere.** Rejected: it hides
  the constraint's real shape and defeats the point of modeling the
  combination.

## Workstreams

This lands as **one atomic PR**, not a sequence: changing the `roleId`
field shape makes every reader a compile error until updated, so core and
its forced downstream consumers (diagram, llm, formats) must move together.
The internal ordering, smallest-blast-radius first:

1. **Core model + serialization + schema + diff.** Widen the field; read
   `role`/`roles` and emit the back-compat key; fold the sequence into the
   `FREQ` diff key. Round-trip tests: a legacy single-role file still emits
   `role:`; a multi-role constraint round-trips through `roles:`.
2. **Core validation + verbalization.** Per-tuple counting (single-role
   path unchanged); the multi-role verbalization phrasing; the consistency
   check over the sequence. Goldens for the multi-role sentence; the
   existing single-role goldens stay green.
3. **Forced downstream + NORMA round-trip.** Update the diagram badge (skip
   multi-role), the LLM draft parser/conformance (`[roleId]`), and the NORMA
   mapper/export to carry the whole sequence. A NORMA round-trip test on a
   multi-role frequency constraint.

## API and migration impact

- `FrequencyConstraint.roleId` is removed in favor of `roleIds` -- a breaking
  change to the public type, contained within the monorepo (no published
  consumers). Every internal reader is updated in the same PR; the one-way
  build is the checklist.
- No `orm_version` bump: the _file_ format is backward compatible (legacy
  `role:` still read and still emitted for single-role), and 1.1 is the open
  cycle.
- Blast radius: the constraint stays one union member with one `type`
  discriminant, so the exhaustive switches compile once each reader's
  `roleId` access is updated; no new union member.

## Open decisions (for review)

- **Replace `roleId` with `roleIds` (recommend: replace).** Single-role is a
  length-1 sequence; the serializer keeps the file format back-compat so no
  `.orm.yaml` churns. The alternative (a parallel field) is the only other
  option and it is strictly worse.
- **Include the NORMA round-trip now (recommend: include).** The parser
  already reads the sequence; finishing the mapping costs little and meets
  the acceptance criterion. The alternative (defer) leaves parsed data
  dropped.
- **Role order is cosmetic (recommend: yes).** Treat the sequence as a
  combination; preserve declared order for display, sort it in the diff key.
  The alternative (order-significant) has no ORM basis for frequency.

## Risks and testing

- The single-role path must stay byte-for-byte identical -- file output,
  verbalization goldens, and validation messages. Guarded by the existing
  frequency tests staying green plus a round-trip assertion that a
  single-role constraint still serializes with `role:`.
- Determinism holds: per-tuple counting is a pure function of the
  population; `check-core-purity` guards it.
- New tests: multi-role round-trip (`roles:`), multi-role validation (a
  tuple over/under the bound), the multi-role verbalization golden, and a
  NORMA multi-role frequency round-trip.

## Non-goals

- No frequency over a join path across fact types (barwise-5t9.10).
- No role-order semantics; a frequency sequence is a combination.
- No new constraint type; the existing `frequency` member is widened.
- No relational / DDL projection of frequency.
