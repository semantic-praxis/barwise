# One identification, one column

Status: Implemented (see Implementation notes)
Created: 2026-09-08
Last-updated: 2026-09-08
Tracking: barwise-967 (this spec); follows
`mapper-key-settlement.spec.md`, whose settled phase-0 key is the
column this changes

In one sentence: an entity that declares both a reference mode and a
preferred identifying binary gets two columns for one identification --
the key, named from the reference mode with the preferred identifier's
data type, and then the preferred identifier again as an ordinary
value column -- and the fix is that the preferred identifier becomes
the key and is not mapped twice.

## Principle

**Explicit over implicit**, and the project's own rule about which
declaration is authoritative.

In ORM a reference mode is shorthand for an identifying binary between
an entity and a value type. barwise lets a model state both, and the
mapper believes both. `resolveEntityPkType` pass 1 finds the preferred
identifying fact type and borrows its **data type** for a primary-key
column named from the **reference mode**
(`RelationalMapper.ts:780-802`); phase 2 then maps that same fact type
again through `mapValueTypeColumn`, whose preferred name collides with
the key and falls back to the `${role}_${value}` alternative. Hence
`patient (medical_record_number, has_medical_record_number, ...)`, two
columns holding one fact.

The rule that settles it is already written down.
`completenessWarnings.ts` says an entity "should have exactly one
preferred identifier ... Zero means the relational mapper must guess",
and `resolveEntityPkType`'s own pass 2 calls the reference-mode path
"the heuristic". So the preferred identifier is the authority and the
reference mode is the guess the rule exists to prevent -- and the
mapper currently takes the authority's type and the guess's name.

## How much of the corpus this is (resolved: measured, and larger than filed)

109 entities across 15 models, not the 26 across 6 the issue recorded.

The issue counted the 16 models it had loaded; measured over every
`.orm.yaml` in the repository that deserializes -- 59 of 63 -- the
count is 109 entities in 15 models, including the hand-authored
internal models (`examples/models/diagram-layout.orm.yaml`,
`learning-design.orm.yaml`) and every promptlab eval reference. This is
the dominant idiom, not an extraction artifact, and every one of those
entities carries a redundant column today.

The reference mode and the preferred identifier **agree** in all but
one entity: `Customer` in `order-management`, whose reference mode is
`customer_id` while the preferred identifier is on `Customer has Name`.
That model appears twice in the corpus (the eval reference and
`examples/output/`).

## Which declaration wins when they disagree (resolved: the preferred identifier, always)

Resolved with the repository owner on 2026-09-08: the preferred
identifier wins, with no special case for agreement.

The consequence is visible and intended: `order-management`'s
`customer` table gets `name` as its primary key. That may well reveal
the model is mismarked rather than that the rule is wrong -- a customer
identified by name is a modelling error, and it is one the mapper was
hiding by quietly using the reference mode's name. The alternative
considered and rejected was "preferred wins only when it agrees with
the reference mode, and a disagreement raises a new warning": two rules
plus a diagnostic where one rule will do.

## Scope

In scope, stated as requirements:

- When an entity type has a preferred identifying binary to a value
  type, the system shall make that fact type's value column the
  entity's primary key, named and typed from the value type.
- When a fact type has become an entity's primary key that way, the
  system shall not map it a second time as an ordinary value column.
- When an entity type has no preferred identifying binary to a value
  type, the system shall key it from its reference mode as before.
- When an entity is identified by an objectification instead, the
  system shall leave its preferred binary to be mapped as an ordinary
  column, because no key was taken from it.
- When the mapper maps any model, no entity table shall carry more than
  one column derived from that entity's preferred identifying fact
  type.

Out of scope: converging the five separate derivations of "the
preferred identifier of an entity" (below); any new diagnostic;
barwise-969's objectification-plus-subtype dual identification, which
is a different pair of declarations.

## Five places compute "the preferred identifier", and no two agree (resolved: named, not converged)

This spec adds a sixth home and uses it from one caller. It does not
converge the others, and that is a deliberate limit rather than an
oversight.

| Site                                           | Requires                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `query/evaluate.ts:428`                        | preferred IU whose `roleIds` include a role the entity plays    |
| `export/populationRenderer.ts:124`             | binary + entity plays a role + any preferred IU                 |
| `annotation/OrmYamlAnnotator.ts:381`           | any arity + entity plays a role + any preferred IU              |
| `validation/rules/completenessWarnings.ts:142` | any arity, counted over `factTypesForObjectType`                |
| `mapping/RelationalMapper.ts:781`              | binary + entity plays a role + the other player is a value type |

Converging them would change diagnostics on shipped models -- the
strictest and loosest differ on which fact types count -- which is a
behaviour change well outside this issue. The new function matches the
mapper's existing rule exactly, so no model's primary-key **type**
changes; only its name and the duplicate column do. The convergence is
filed as barwise-971, with the measurement it needs first.

## Inventory

| Module                                          | Current state                                                            | Verdict                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `packages/core/src/model/identification.ts`     | `identificationGraph`, `identificationOrder`                             | gains `preferredIdentifyingBinary` (WS1)             |
| `packages/core/src/mapping/RelationalMapper.ts` | phase 0 names the key from the reference mode; phase 2 remaps the binary | phase 0 takes the preferred binary; phase 2 skips it |
| `resolveEntityPkType` (same file)               | pass 1 preferred, pass 2 reference-mode heuristic, pass 3 fallback       | pass 1 moves to the new owner; passes 2-3 stay       |
| `packages/core/tests/laws/mapper.law.test.ts`   | `expectWellFormed` over 250 generated models                             | gains the once-only clause (WS1)                     |
| the 9 cli characterization goldens              | carry the duplicate column for clinic-appointments                       | regenerated (WS1)                                    |
| `examples/output/`                              | regenerated by `npm run regen:examples`                                  | regenerated (WS1)                                    |
| `completenessWarnings.ts`                       | states the rule this spec applies                                        | untouched; it is the authority, not the mechanism    |

The `untouched` row is a claim: `completenessWarnings` reports on
preferred identifiers and never consults the mapper, so nothing there
runs differently. Verified by reading it, not assumed.

## Target architecture

```ts
// core/src/model/identification.ts -- the identification concepts live here
export interface PreferredIdentifyingBinary {
  readonly factType: FactType;
  /** The role the entity itself plays. */
  readonly entityRole: Role;
  /** The value type on the other side: what actually identifies it. */
  readonly valuePlayer: ObjectType;
}

export function preferredIdentifyingBinary(
  model: OrmModel,
  entity: ObjectType,
): PreferredIdentifyingBinary | undefined;
```

The return type is the point. `resolveEntityPkType` answered a
narrower question -- what SQL type -- and threw away the fact type it
found it on, which is why phase 2 could not know the fact type had
already been spent. Returning the binary itself makes the second
mapping refusable.

Phase 0 becomes:

```ts
const preferred = preferredIdentifyingBinary(model, ot);
const pkColName = preferred
  ? toSnake(preferred.valuePlayer.name)
  : ot.referenceMode ?? `${toSnake(ot.name)}_id`;
```

and, where the column is actually created, the fact type's id joins a
set that phase 2's fact-type loop skips -- the same mechanism
`objectifiedFactTypeIds` already uses for a fact type an objectification
consumed. An entity that absorbs an objectification creates no phase-0
column, so its binary is not spent and phase 2 maps it normally.

## Alternatives considered

- **Keep the reference mode as the column name, use the preferred
  binary only for the type and the de-duplication.** Minimises churn:
  109 entities keep their current key name and only lose the duplicate.
  Rejected because it keeps `customer_id` as the name of a column that
  holds a customer's name, which is the misdirection this issue is
  about, and because it is the two-rule design the owner rejected.
- **Drop the reference-mode column and leave phase 2 to add the value
  column, then promote it to the key.** Same result by a longer route,
  and it would have to run after phase 2, which is exactly the ordering
  `mapper-key-settlement.spec.md` was written to remove.
- **Report the double declaration and change nothing.** The model is
  not wrong -- stating both is idiomatic ORM -- so a diagnostic on 109
  entities would be noise. The defect is in the mapper.

## Workstream: the preferred identifier is the key, once

One workstream: add `preferredIdentifyingBinary`, use it in phase 0,
skip the spent fact type in phase 2, add the law clause, and regenerate
the artifacts that change. They cannot be split -- the mapper change
turns the goldens red on its own.

Acceptance, in EARS form: when the mapper maps an entity with a
preferred identifying binary to a value type, the entity's table shall
carry exactly one column derived from that fact type and it shall be
the primary key. Guarded by a clause in
`tests/laws/mapper.law.test.ts` over 250 generated models, shown red
against today's mapper -- which emits two.

## API and migration impact

- No package API change. `model/identification.ts` is not exported from
  `@barwise/core`'s index -- the mapper and the validator import it
  directly -- so `preferredIdentifyingBinary` is internal, as
  `identificationOrder` beside it already is.
- **Generated schemas change** for 109 entities across 15 models: each
  loses one column. One of them changes its primary key's name and
  meaning (`order-management`'s `customer`, from `customer_id` to
  `name`), and models whose reference mode was not snake_case get a
  snake_case key name (`rb-global-account-taxonomy`: `UserId` becomes
  `user_id`).
- Goldens and `examples/output/` are regenerated by their own
  regenerators, never by hand.

## Risks and testing

- **The risk is a silent widening**: a rule that consumes a fact type
  it should not have, leaving an entity without the column that fact
  type was meant to give it. The law's once-only clause catches the
  duplicate; the existing well-formedness clauses catch a key that
  names a missing column.
- The law clause must be read red against the current mapper before it
  is trusted green, and the mutation to plant afterwards is removing
  the phase-2 skip.
- The regenerated goldens are reviewed as a diff, per column, not
  accepted wholesale: 109 entities losing a column is exactly the shape
  in which one entity losing the wrong column hides.
- One PR, followed by `npm run ci:local` from `barwise/` with the exit
  code read directly.

## Non-goals

- No new diagnostic, and no change to `completenessWarnings`.
- No convergence of the five preferred-identifier derivations.
- No change to how an entity with no preferred identifier is keyed.

## Implementation notes

**The law is thin, and the fixtures carry the weight.** Measured at the
fixed seed: 1 model of 250 has an entity with a preferred identifying
binary to a value type. That one model does kill the mutation -- removing
the phase-2 skip fails the law -- but one is not cover, and it is the same
thin spot barwise-968 records for composite foreign keys. So the
behaviour is pinned by three fixtures in `RelationalMapper.test.ts` (the
agreeing case, the disagreeing case, and no preferred identifier at all)
and the count is asserted in the law's coverage block, where raising it is
a visible change.

**Red-first proof.**

| Mutation                                            | Killed                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| phase 2 no longer skips the spent fact type         | both agreeing/disagreeing fixtures, and the law |
| phase 0 names the key from the reference mode again | the disagreeing fixture                         |
| the DDL routing guard removed                       | the constraint-routing test                     |

**A redundant UNIQUE appeared, and is fixed here.** With the duplicate
column gone, the value-side uniqueness of the identifying binary resolved
to the primary-key column, so the DDL export emitted
`UNIQUE (medical_record_number)` beside
`PRIMARY KEY (medical_record_number)`. `valueColumnForUniqueness` in
`@barwise/formats` had always documented that "any other uniqueness is
realized by the mapping itself"; this is the case that made the claim
false, and `routeConstraints` now skips a single-column uniqueness that
IS the table's primary key. Valid SQL either way, but a clause the key
already enforces is noise a reader has to explain away.

**One fixture was a mismarked model.** `openapi.test.ts`'s population
example fixture gave `Customer` the reference mode `customer_id` while
marking the preferred identifier on `Customer has Email` -- a customer
identified by their email address. It passed only because the mapper
named the key from the reference mode and ignored what actually
identified the entity. The fixture now says what it meant.

**A test that passed with its own guard removed.** The first version of
the constraint-routing test put the uniqueness on the entity role, where
`valueColumnForUniqueness` returns undefined and no clause is produced
either way -- so it asserted nothing. It was rewritten to add the
value-side constraint directly, because the builder's `uniqueness:
"both"` silently drops `isPreferred`. Caught by watching the mutation
fail to fail.

**What changed in the shipped artifacts.** Only the three
clinic-appointments export goldens: four duplicate columns removed
(`has_medical_record_number`, `has_provider_id`,
`has_confirmation_number`, `has_room_number`) across DDL, Avro and
OpenAPI, plus the four now-redundant UNIQUE clauses. `examples/output/`
holds models, diagnostics and verbalizations, none of which the
relational mapper produces, so `validate:examples` needed no
regeneration.
