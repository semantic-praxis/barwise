# A preferred identifier's roles are mandatory, or validation says so

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-i77
Touches: barwise/packages/core/src/validation/ruleId.ts,
barwise/packages/core/src/validation/rules/completenessWarnings.ts,
barwise/packages/core/tests/validation/completenessWarnings.test.ts

When an entity type's preferred identifier rests on a role the entity plays
that no alethic mandatory constraint covers, validation shall warn, naming
the entity, the identifier and each such fact type, because the relational
mapper keys the entity's table on that role and so states a rule the model
does not.

## Principle

**Explicit over implicit, applied to the schema the model produces.** ORM
requires a reference scheme's roles to be mandatory: an entity with no
identifier cannot be referred to. The relational mapper relies on it
without saying so. Every column of a primary key is `NOT NULL`, so a model
whose identifying role is optional maps to a schema stricter than the model
-- the model allows a Person with no PersonNr, the table does not -- and
nothing tells the modeller. `completeness/preferred-identifier-invalid`
checks that a stored identifier has the right shape; nothing checks the one
property of its roles the mapper depends on.

## Observed today (at 5406da4d)

- A model whose Person is identified by "Person has PersonNr", with
  uniqueness on both roles and no mandatory on Person's role, validates with
  no identification diagnostic (only the missing-definition and
  missing-inverse-reading notices any small model gets).
- Over the 119 tracked `.orm.yaml` files (84 load): 378 identified entities,
  every identifying role mandatory. Over the 192 recorded eval payloads,
  parsed with `parseDraftModel` as the scorer does: 780 identified entities,
  2 with an optional identifying role, in 2 payloads.

## Scope

In scope:

- One rule, `completeness/preferred-identifier-optional`, severity
  `warning`, in `completenessWarnings.ts`, reading `preferredIdentifiers`
  (the answer the mapper reads, so the two cannot disagree on which
  identifier is meant).
- The roles it checks are the entity's own roles in the identifier:
  - **internal, entity-value binary** (`identifiedBy`'s rank-0 case): the
    entity's role;
  - **internal, the one uncovered role** of a longer fact type: that role;
  - **internal, objectification**: none, since the entity is the fact type
    and plays no role in it;
  - **external**: each component's near role.
- When any checked role has no alethic `mandatory` constraint on it, the
  rule shall report one diagnostic for the entity, naming the identifying
  constraint and the fact types whose role is optional.
- When the entity's stored reference does not resolve, the rule shall say
  nothing: `preferred-identifier-invalid` already reports it, and an entity
  with no identifier has no roles to check.

Out of scope:

- Mandatory implied by other constraints (a disjunctive mandatory, an
  equality or subset path). The rule reads a role's own mandatory
  constraint, which is what the verbalizer and the mapper read.
- Changing the mapper or the LLM parser.

## Inventory

| Area                                    | Current state                         | Verdict                     |
| --------------------------------------- | ------------------------------------- | --------------------------- |
| `core/src/validation/ruleId.ts`         | 9 `completeness/` rules               | one rule and message added  |
| `validation/rules/completenessWarnings` | `checkPreferredIdentifiers` and peers | one check added beside them |
| `core/src/model/identification.ts`      | `preferredIdentifiers`, components    | read, unchanged             |
| `mapping/RelationalMapper.ts`           | keys on the identifier, `NOT NULL`    | unchanged                   |
| tracked models, `validate` output       | 378 identified entities               | unchanged (0 affected)      |
| eval payloads, scored warnings          | 780 identified entities               | 2 warnings added, 2 files   |

## Workstreams

### 1. The rule

One PR. Acceptance:

- the entity-value case: Person identified by "Person has PersonNr" with no
  mandatory on Person's role gets the warning naming Person, the
  uniqueness and the fact type; with the mandatory, none;
- the external case: a Room identified over "Room is in Building" and "Room
  has RoomNr" with one near role optional gets one warning naming that fact
  type only;
- a deontic mandatory on the role does not satisfy it;
- an objectified entity's identifier gets none;
- an unresolved reference gets `preferred-identifier-invalid` and not this
  warning;
- `barwise validate` output over every tracked model is byte-identical
  before and after.

Each test is watched red with the rule's registration removed.

## Open decisions

1. **Severity.** Options: (a) `warning`; (b) `error`. **Recommend (a)**:
   the model is still mappable, and the mapper's answer (a stricter schema)
   is a reasonable reading of what the modeller meant. An error would also
   fail `--strict` exports of the two eval models for a property no export
   misreads. The recorded score history does not move; future scored runs
   charge 0.05 per entity that omits the mandatory, which is a real defect
   in the extraction.
2. **Deontic mandatory.** Options: (a) only an alethic mandatory satisfies
   the rule; (b) any. **Recommend (a)**: a deontic mandatory says each
   entity ought to have an identifier, which does not make the key column
   always filled; `isUniqueAlone` takes the same position for the
   uniqueness half of an external scheme.

## Risks and testing

- **A test that cannot fail.** Each acceptance test names the entity or the
  fact type in the message, and is watched red with the rule removed.
- **Score movement.** Two warnings across the recorded payloads; no history
  row is rewritten.
