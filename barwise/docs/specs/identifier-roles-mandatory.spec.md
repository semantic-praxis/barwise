# A preferred identifier's roles are mandatory, or validation says so

Status: Implemented -- WS1

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-i77
Plan-reviewed: f742cb71 (code-review, pr-review)
Touches: barwise/packages/core/src/model/identification.ts,
barwise/packages/core/src/index.ts,
barwise/packages/core/tests/validation/ValidationEngine.test.ts,
barwise/packages/core/src/validation/ruleId.ts,
barwise/packages/core/src/validation/rules/completenessWarnings.ts,
barwise/packages/core/tests/validation/completenessWarnings.test.ts

When an entity type's preferred identifier rests on a role the entity plays
that no alethic mandatory constraint covers, validation shall warn, naming
the entity, the identifier and each such fact type, because an identifier
some instances may lack does not identify them.

## Principle

**Explicit over implicit.** ORM requires a reference scheme's roles to be
mandatory: an entity that may have no identifier cannot be referred to, so
an optional identifying role says something the modeller almost certainly
did not mean. `completeness/preferred-identifier-invalid` checks that a
stored identifier has the right shape; nothing checks this property of its
roles.

The mapper makes it concrete for the two common shapes. For an entity-value
binary (`preferredIdentifyingBinary`) and for an external scheme
(`settleExternalKey`) the identifying columns are the primary key, so they
are `NOT NULL` whatever the model says: the model allows a Person with no
PersonNr and the table does not. The rule does not rest on the mapper,
though. For the other identifier shapes the mapper keys the table some
other way (the reference mode, or an absorbed objectification), and the
reference scheme is still incomplete.

## Observed today (at 5406da4d)

- A model whose Person is identified by "Person has PersonNr", with
  uniqueness on both roles and no mandatory on Person's role, validates with
  no identification diagnostic.
- Over the 119 tracked `.orm.yaml` files (84 load): 378 identified entities,
  every identifying role mandatory.
- Over the 192 recorded eval payloads, read as `scoreExtraction` reads them
  (`parseExtractionResponse`, then `enforceConformance`, then
  `parseDraftModel`): 778 identified entities, every identifying role
  mandatory. Without conformance two entities in two payloads have an
  optional role; conformance removes both. So no recorded score moves.

## Scope

In scope:

- `isMandatoryAlone(factType, roleId)` in `model/identification.ts`, beside
  `isUniqueAlone`: whether the role carries its own alethic mandatory
  constraint. The two halves of what a reference scheme needs of a role
  then live in one module.
- One rule, `completeness/preferred-identifier-optional`, severity
  `warning`, in `completenessWarnings.ts`, reading `preferredIdentifiers`.
- The roles it checks are the entity's own roles in its identifier, one
  case per arm of `identifiedBy` and `externalIdentifies`:
  - **internal, the objectification arm** (the identifier is the fact type
    the entity objectifies): none, since the entity plays no role in it;
  - **internal, the entity-value binary**: the entity's role;
  - **internal, every other fact type** (a longer fact type, or a binary
    between two entity types): the one role the uniqueness leaves
    uncovered, which the entity plays;
  - **external**: each component's near role.
    An objectified entity whose preferred identifier is its own reference
    scheme ("Review has ReviewId") is in the entity-value arm, and is
    checked: its reference scheme is what it names, whatever the mapper keys
    on.
- When any checked role fails `isMandatoryAlone`, the rule shall report one
  diagnostic for the entity, naming the identifying constraint and the fact
  types whose role is optional.
- When the entity's stored reference does not resolve, the rule shall say
  nothing: `preferred-identifier-invalid` reports it.

Out of scope:

- Mandatory implied by other constraints (a disjunctive mandatory, an
  equality or subset path).
- The mapper's reading of a deontic mandatory as `NOT NULL`
  (`analyzeMandatory` ignores modality). That is the mapper's question; this
  rule asks the modeller's.

## Inventory

| Area                                    | Current state                           | Verdict                               |
| --------------------------------------- | --------------------------------------- | ------------------------------------- |
| `core/src/model/identification.ts`      | `isUniqueAlone`, `preferredIdentifiers` | `isMandatoryAlone` added beside it    |
| `core/src/validation/ruleId.ts`         | 9 `completeness/` rules                 | one rule and message added            |
| `validation/rules/completenessWarnings` | `checkPreferredIdentifiers` and peers   | one check added beside them           |
| `mapping/RelationalMapper.ts`           | keys on two identifier shapes           | unchanged                             |
| tracked models, `validate` output       | 378 identified entities                 | unchanged (0 affected)                |
| eval payloads, scored                   | 778 identified entities                 | unchanged (0 affected); no suite bump |

## Workstreams

### 1. The rule

One PR. Behavioural tests, each naming the entity or the fact type in the
message it asserts, and each watched red with the rule's registration
removed:

- the entity-value case: Person identified by "Person has PersonNr" with no
  mandatory on Person's role gets the warning naming Person, the uniqueness
  and the fact type;
- the external case: a Room identified over "Room is in Building" and "Room
  has RoomNr" with one near role optional gets one warning naming that fact
  type and not the other;
- the uncovered-role case on an entity-entity binary gets the warning;
- a deontic mandatory on the role still gets the warning.

Pins, which assert an absence and so hold with the rule removed too; each
is watched red against a variant of the rule that drops the guard it pins:

- with an alethic mandatory, no warning;
- an entity identified by objectification gets none;
- an unresolved reference gets `preferred-identifier-invalid` and not this
  warning.

And one corpus check: `barwise validate` over every tracked model is
byte-identical before and after.

## Implementation notes

- **`identifyingRoles` lives beside `isMandatoryAlone`.** Which roles an
  entity plays in its identifier is a question about the arms of
  `identifiedBy` and `externalIdentifies`, so it is answered in
  `model/identification.ts` (exported with `isMandatoryAlone`) rather than
  restated in the rule.
- **Two "well-formed" fixtures were not.** The no-diagnostics models in
  `completenessWarnings.test.ts` and `ValidationEngine.test.ts` identified
  Customer and Order by reference binaries with the entity roles optional,
  which is the defect this rule reports; they now declare the mandatory
  constraints. No other test in the monorepo changed (`npm test`, 24 of 24
  tasks).
- **Watched red.** Registration removed: the four behavioural tests fail.
  The no-optional-roles guard removed: the alethic and objectification pins
  fail, with the well-formed fixture. Modality ignored: the deontic case
  fails. The unresolved-reference pin holds by construction, since the rule
  reads only `preferredIdentifiers`, which keeps a reference only when it
  resolves; no single-line variant of the rule makes it fire.
- **Corpus.** The rule reports nothing on any of the 84 tracked models that
  load, so `validate` output is unchanged; on the eval payloads read as the
  scorer reads them it reports nothing either (Observed).

## Open decisions

1. **Severity.** Options: (a) `warning`; (b) `error`. **Recommend (a)**:
   the model is still mappable and its meaning is clear enough to act on;
   an error would fail `--strict` exports for a property no export
   misreads. No recorded score moves either way (Observed).
2. **Deontic mandatory.** Options: (a) only an alethic mandatory satisfies
   the rule; (b) any. **Recommend (a)**: a deontic mandatory says each
   entity ought to have an identifier, which does not make the scheme total;
   `isUniqueAlone` takes the same position for the uniqueness half.
3. **Which shapes.** Options: (a) every identifier shape with an entity
   role, as above; (b) only the shapes the mapper keys on (entity-value
   binary not absorbed by an objectification, and external). **Recommend
   (a)**: the requirement is ORM's, and (b) would tie a modelling rule to a
   mapper detail that can change; the message says what is missing, not
   what the mapper does.

## Risks and testing

- **A test that cannot fail.** The behavioural tests are watched red with
  the rule removed; the pins against a variant without their guard, since
  removing the rule cannot turn an absence red.
- **Score movement.** None on the recorded payloads, measured as the scorer
  reads them.
