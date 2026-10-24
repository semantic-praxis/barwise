# An external uniqueness can be an entity's preferred identifier

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-alg
Touches: barwise/packages/core/src/model/identification.ts,
barwise/packages/core/src/mapping/RelationalMapper.ts,
barwise/packages/core/src/validation/rules/completenessWarnings.ts,
barwise/packages/core/src/export/populationRenderer.ts,
barwise/packages/core/src/query/evaluate.ts,
barwise/packages/core/src/diff/ModelMerge.ts,
barwise/packages/core/src/diff/elementDiff.ts,
barwise/packages/core/schemas/orm-model.schema.json,
barwise/packages/core/tests/,
barwise/packages/llm/src/ModelContext.ts,
barwise/packages/vscode/src/sidebar/ModelTreeProvider.ts,
barwise/packages/formats/src/norma/NormaToOrmMapper.ts,
barwise/packages/formats/src/norma/NormaXmlWriter.ts,
barwise/packages/formats/src/norma/populationGraph.ts,
barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/packages/formats/src/ossie/mapOssieToOrm.ts,
barwise/packages/formats/tests/,
barwise/docs/specs/orm-format-3.spec.md,
barwise/docs/specs/ossie-ontology-format.spec.md

When an entity's `preferred_identifier` names an external uniqueness that
identifies it -- Room by the Building it is in and its RoomNr -- barwise
shall accept it, key the entity's table on the combination, and carry the
reference through NORMA and Ossie, instead of refusing it as it does today.

## Principle

**Explicit over implicit.** Format 3.0 made the preferred identifier a
stored reference to a constraint by id (orm-format-3, Open decision 3) so
that it could name an external uniqueness: that decision's own argument
was "it closes barwise-alg". WS4b shipped the reference and deferred the
external case, so the one composite reference scheme ORM is best known
for cannot be declared. A modeller who writes it gets an error; the
mapper keys Room on its `room_id` reference mode and demotes the real
identifier to `UNIQUE (building_code, room_nr)`; NORMA import drops a
`PreferredIdentifier` that names an external uniqueness; Ossie import
keeps `identify_by: [building, number]` as an unnamed constraint and
warns. Each of those is the model saying less than its author did.

**Determinism and orthogonality.** Which constraint identifies which
entity stays one pure function, `resolvePreferredIdentifier`, that every
reader asks. The external case extends that function; no reader grows its
own rule. Ossie's writer has one today (`compositeIdentifier`), which this
change replaces with the core answer.

## Observed today (2026-10-24, at 6bf215b9 plus #765)

A 3.0 model with Room, Building, RoomNr, the two binaries "Room is in
Building" and "Room has RoomNr" (each unique and mandatory on Room's
role), an external uniqueness `c-room-id` over the Building and RoomNr
roles, and `preferred_identifier: c-room-id` on Room:

- `barwise validate` exits 1: "names constraint c-room-id as its preferred
  identifier, but its kind is external_uniqueness ... an external
  uniqueness is not yet read as one."
- `barwise export --format ddl` keys `room` on `room_id` and writes
  `UNIQUE (building_code, room_nr)`.
- No tracked model names an external uniqueness as an identifier: 3.0
  refuses it and 2.0 had no flag on external constraints. Twenty-one
  tracked `.orm.yaml` files hold an external uniqueness; none changes
  output under this spec unless it opts in.

## When does an external uniqueness identify an entity? (resolved: the ORM reference-scheme shape)

An external uniqueness `U` identifies entity `E` when:

1. `U` spans two roles or more;
2. each role of `U` belongs to a distinct binary fact type whose other
   role is played by `E` (the "near" role; `U`'s role is the "far" one);
3. each near role carries an internal uniqueness over that role alone, so
   each `E` has at most one of each component;
4. no far role is played by `E` itself.

This is the shape Halpin's reference schemes take, the shape NORMA's
`PreferredIdentifierFor` on an external constraint denotes, and the shape
Ossie's `identify_by` with several relationships writes. Rule 4 keeps the
identification graph acyclic at its shortest length; a longer cycle
(`E` identified through `F`, `F` through `E`) is the existing
`identificationOrder` cycle, reported the way an objectification cycle
is.

A near role that is not mandatory does not stop `U` identifying `E`, but
validation warns: the mapper's key columns are `NOT NULL`, so the schema
states a stronger rule than the model. ORM requires a preferred reference
scheme's components to be mandatory; a warning rather than a refusal
matches how the internal case treats the same omission today.

## Scope

In scope:

- When an entity's stored preferred identifier is an external uniqueness
  of the shape above, `resolvePreferredIdentifier` shall resolve it, and
  `completeness/preferred-identifier-invalid` shall not report it.
- When the external uniqueness does not have that shape, validation shall
  report it as not identifying the entity, naming which rule failed.
- When an entity is identified by an external uniqueness, the relational
  mapper shall key its table on the far roles' columns: a value player's
  column, or a foreign key to an entity player's settled key. The
  component fact types are spent on the key, as an identifying binary is
  today, and the entity takes no reference-mode column (Open decision 2).
  An entity player's key settles first: `identificationGraph` gains an
  edge from `E` to each entity far player.
- When another table references such an entity, its foreign key shall
  name every key column, as references to an objectified entity's
  composite key already do.
- When a near role is not mandatory, validation shall warn as above.
- Every reader of `preferredIdentifiers` shall handle the external case
  explicitly (Inventory), so none treats an external identifier as
  absent or reads a fact type that is not there.
- When a NORMA file's `PreferredIdentifier` names an external uniqueness
  constraint the mapping kept, the NORMA importer shall store it; the
  NORMA exporter shall write `PreferredIdentifier` and `IsPreferred` for
  a stored external identifier.
- When an Ossie concept's `identify_by` names two relationships or more,
  the Ossie importer shall store the external uniqueness it creates as
  the concept's preferred identifier, and drop its barwise-alg warning;
  the Ossie writer shall write `identify_by` from a stored external
  identifier through core's resolver rather than its own shape check.

Out of scope:

- Verbalizing the identification ("the combination of Building and RoomNr
  provides the preferred identification scheme for Room"). No
  identifier, internal or external, is verbalized as such today; filed
  separately (Open decision 3).
- A transcript extraction or LLM parser path that emits an external
  identifier. The llm parser reads 2.0-style flags on internal
  uniquenesses only, and asking a model for a composite scheme is a
  prompt change with its own evaluation.
- A reference scheme through a join longer than one fact type per
  component (Room identified by the Campus of its Building). ORM allows
  it; NORMA models it as a join path; nothing here reads one.

## Inventory

Verified against the code at 6bf215b9 unless marked provisional.

| Reader                                      | Reads today                          | Verdict                                                                      |
| ------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `model/identification.ts` resolver          | internal uniqueness only             | resolves the external shape; `IdentifyingUniqueness` becomes a union         |
| `identificationGraph`                       | objectification, identifying subtype | adds `E` -> entity far player for an external identifier                     |
| `RelationalMapper` phase 0/1                | identifying binary or reference mode | composite key from the far roles, settled in identification order            |
| `completenessWarnings`                      | refuses external with an error       | accepts the shape; reports a failed rule; warns on a non-mandatory near role |
| `identificationSources`                     | `factTypeId` of the identifier       | `constraintId` for the preferred-uniqueness arm (one id either kind)         |
| `preferredIdentifyingBinary`, `diagramView` | binary only                          | unchanged: external is not a binary, and they already answer undefined       |
| `isIdentified`, `OrmYamlAnnotator`          | `byEntity.has`                       | unchanged: an external identifier is in `byEntity`                           |
| `populationRenderer`                        | identifying fact type                | provisional: the component fact types; ground in WS1                         |
| `query/evaluate.ts` anchors                 | identifying fact type and its roles  | provisional: the components' far players; ground in WS1                      |
| `ModelMerge` reference following            | uniqueness over the same roles       | also follows an external uniqueness over the same roles                      |
| `elementDiff` preferred-identifier delta    | stored id                            | unchanged: compares ids; confirm in WS1                                      |
| `llm/ModelContext.ts`                       | `at.factType.id`                     | the component fact types                                                     |
| `vscode` `ModelTreeProvider`                | `byConstraint` keys                  | provisional: marks the external constraint; ground where it is drawn         |
| `NormaXmlWriter`, `populationGraph`         | internal identifier, binary seat     | writes `PreferredIdentifier`/`IsPreferred` for external (WS2)                |
| `NormaToOrmMapper.mapPreferredIdentifiers`  | stores internal refs only            | stores an external ref the mapping kept (WS2)                                |
| `ossie/writeOssie.ts` `compositeIdentifier` | its own shape check                  | replaced by the resolver for a stored identifier (WS2)                       |
| `ossie/mapOssieToOrm.ts` `addIdentifier`    | keeps external, warns                | stores it as preferred (WS2)                                                 |
| `schemas/orm-model.schema.json`             | "the uniqueness constraint"          | description names both kinds; no shape change                                |

## Target architecture

```ts
// core/src/model/identification.ts
export type IdentifyingUniqueness =
  | {
    readonly kind: "internal";
    readonly entityId: string;
    readonly constraint: InternalUniquenessConstraint;
    readonly factType: FactType;
  }
  | {
    readonly kind: "external";
    readonly entityId: string;
    readonly constraint: ExternalUniquenessConstraint;
    /** One per role of the constraint, in its role order. */
    readonly components: readonly IdentifyingComponent[];
  };

export interface IdentifyingComponent {
  readonly factType: FactType;
  /** The role the identified entity plays, unique on its own. */
  readonly nearRole: Role;
  /** The constraint's role: what identifies the entity. */
  readonly farRole: Role;
}

/** The fact types an identifier spends: one internal, one per component external. */
export function identifyingFactTypes(
  at: IdentifyingUniqueness,
): readonly FactType[];
```

`PreferredIdentifierResolution`'s failure reasons gain one per shape rule
(`"external-arity"`, `"external-not-binary-on-entity"`,
`"external-near-not-unique"`, `"external-self-reference"`), so validation
names the rule and the resolver stays the one place it is decided.

## Workstreams

### 1. Core, and every reader the type change reaches

One PR, because changing `IdentifyingUniqueness` to a union fails to
compile in every reader until each decides the external case: the
resolver and its failure reasons, validation, `identificationGraph`, the
mapper, `identificationSources`, the population renderer, query anchors,
merge, and the downstream readers that compile against the type
(`llm/ModelContext.ts`, the vscode tree, `NormaXmlWriter`'s
`collectPreferredIdentifiers`, which in this workstream skips an external
identifier rather than writing it).

Acceptance:

- The Room model validates clean, and its DDL keys `room` on
  `(building_code, room_nr)` with a foreign key to `building`, no
  `room_id` column, and no separate `UNIQUE (building_code, room_nr)`.
- A table referencing Room carries both columns and a two-column foreign
  key.
- Each failed shape rule is a test that names the rule in the message; a
  non-mandatory near role warns.
- A cycle (`E` identified through `F`, `F` through `E`) is reported by
  validation and leaves the mapper total.
- Every tracked model's `barwise validate` output and DDL export are
  byte-identical before and after (none names an external identifier).
- Each new test is watched red with its change reverted.

`orm-format-3.spec.md`'s WS4b note that an external identifier "is still
not stored" points here in the same PR.

### 2. NORMA and Ossie carry it

One PR, in `@barwise/formats`: the NORMA importer stores an external
`PreferredIdentifier`, the exporter writes it, and a NORMA round trip of
the Room model keeps it; the Ossie importer stores `identify_by` over
several relationships as the preferred identifier, the writer derives
`identify_by` from the resolver, and an Ossie round trip keeps it. The
Ossie importer's barwise-alg warning and the NORMA mapper's barwise-alg
comment go. `ossie-ontology-format.spec.md`'s note that composite
identifiers are kept unnamed is updated in the same PR.

## API and migration impact

- `IdentifyingUniqueness` gains a `kind` discriminant and an external
  arm. It is exported from `@barwise/core`; every in-repo reader is
  updated in WS1. An out-of-repo reader of `.factType` fails to compile
  rather than reading the wrong thing, which is the intent of the union.
- `IdentificationSource`'s preferred-uniqueness arm carries
  `constraintId` instead of `factTypeId`.
- No file format change: 3.0 already stores the reference by id, and its
  schema does not restrict which constraint kind it names.

## Open decisions

1. **The type: a discriminated union, or one shape with a list of fact
   types.** Options: (a) the union above, plus `identifyingFactTypes` for
   readers that only want the fact types; (b) one interface whose
   `constraint` widens to either uniqueness and whose `factType` becomes
   `factTypes`. **Recommend (a)**: the mapper and the NORMA writer need
   the near and far roles, which (b) would make each of them re-derive,
   and the union makes every reader decide the external case at compile
   time instead of discovering it at run time. (b) is fewer edits.
2. **The reference-mode column of an externally identified entity.** An
   entity type always carries a `reference_mode` string, so Room has one
   even when its identifier is external. Options: (a) the mapper writes
   no reference-mode column, as it already does when a preferred
   identifying binary overrides the reference mode; (b) keep it as a
   non-key surrogate column. **Recommend (a)**: it is the existing rule
   ("the preferred identifier is the authority and the reference mode is
   the guess"), and a surrogate column nothing populates is the redundant
   column `mapper-key-settlement.spec.md` removed for objectified types.
3. **Verbalizing identification.** Options: leave it out here and file
   it (recommended: no identifier is verbalized today, internal or
   external, so it is a gap for both and a verbalization change with its
   own fidelity check, barwise-k5q's territory), or add the NORMA
   sentence for both kinds in WS1.

## Risks and testing

- **A shape rule that disagrees with NORMA's.** WS2's NORMA round trip on
  the Room model is the check that the two agree on the simple case; a
  NORMA file whose external identifier fails a rule is imported without
  it and the mapping warns, as an unreadable internal reference is today.
- **A key change in a tracked model.** None names an external identifier,
  so WS1's acceptance is that no tracked output changes at all; a diff is
  a bug in the change, not an expected migration.
- **A test that cannot fail.** Every acceptance test asserts specific
  columns, constraint ids or messages, and is watched red with its change
  reverted.
