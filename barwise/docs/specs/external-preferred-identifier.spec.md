# An external uniqueness can be an entity's preferred identifier

Status: WS1 implemented (core and every reader); WS2 (NORMA and Ossie) not yet

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-alg
Plan-reviewed: 2e3c189e (code-review, pr-review)
Touches: barwise/packages/core/src/model/identification.ts,
barwise/packages/core/src/mapping/RelationalMapper.ts,
barwise/packages/core/src/validation/rules/completenessWarnings.ts,
barwise/packages/core/src/export/populationRenderer.ts,
barwise/packages/core/src/query/evaluate.ts,
barwise/packages/core/src/diff/ModelMerge.ts,
barwise/packages/core/src/diff/elementDiff.ts,
barwise/packages/core/schemas/orm-model.schema.json,
barwise/packages/core/src/query/types.ts,
barwise/packages/core/src/query/format.ts,
barwise/packages/core/tests/,
barwise/packages/llm/src/DraftModelParser.ts,
barwise/packages/llm/src/ModelContext.ts,
barwise/packages/vscode/src/sidebar/ModelTreeProvider.ts,
barwise/packages/formats/src/norma/NormaToOrmMapper.ts,
barwise/packages/formats/src/norma/NormaXmlWriter.ts,
barwise/packages/formats/src/norma/populationGraph.ts,
barwise/packages/formats/src/norma/mapping/constraintPasses.ts,
barwise/packages/formats/src/ddl/constraintRouting.ts,
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
own rule. Ossie's writer has one today (`compositeIdentifier`), and core
has another that answers half the question: `inferExternalUniquenessJoin`
(`core/src/externalUniqueness.ts`), which population validation and the
counterexample generator use to find the object an external uniqueness
joins on. The resolver builds on that helper rather than restating it,
and the Ossie writer asks the resolver's shape check instead of its own.

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

1. `inferExternalUniquenessJoin(U.roleIds)` finds a common object, and it
   is `E`. That helper already requires two roles or more, one per fact
   type, and a common object that plays exactly one other role in each of
   those fact types and plays none of `U`'s roles -- so `E` is never
   identified by a role it plays itself;
2. each of those fact types is binary, so the role `E` plays (the "near"
   role) and `U`'s role (the "far" one) are the whole fact;
3. each near role carries an internal uniqueness over that role alone, so
   each `E` has at most one of each component.

Rules 2 and 3 are what an identifier needs beyond a join: the helper
allows an n-ary fact type and never asks whether the near role is unique,
because a population check joining on `E` needs neither. The resolver
calls the helper and adds the two checks; it does not re-derive the
common object, so the object population validation joins on and the one
the mapper keys on cannot differ.

This is the shape Halpin's reference schemes take, the shape NORMA's
`PreferredIdentifierFor` on an external constraint denotes, and the shape
Ossie's `identify_by` with several relationships writes. Rule 4 keeps the
identification graph acyclic at its shortest length; a longer cycle
(`E` identified through `F`, `F` through `E`) is the existing
`identificationOrder` cycle, reported the way an objectification cycle
is.

A near role that is not mandatory does not stop `U` identifying `E`, and
validation says nothing about it. ORM requires a reference scheme's roles
to be mandatory, and the mapper's key columns are `NOT NULL` whatever the
model says; but no rule checks that for an internal identifier either
(an identifying binary whose entity role is optional validates clean
today), so a warning for the external case alone would be an asymmetry.
One rule for both kinds is barwise-i77; it changes tracked models'
`validate` output, which this spec's acceptance holds fixed.

## Scope

In scope:

- When an entity's stored preferred identifier is an external uniqueness
  of the shape above, `resolvePreferredIdentifier` shall resolve it, and
  `completeness/preferred-identifier-invalid` shall not report it.
- When the external uniqueness does not have that shape, validation shall
  report it as not identifying the entity, naming which rule failed: no
  common object, a common object other than this entity, a component
  that is not binary, or a near role without its own uniqueness.
- When an entity is identified by an external uniqueness, the relational
  mapper shall key its table on the far roles' columns: a value player's
  column, or a foreign key to an entity player's settled key. The
  component fact types are spent on the key, as an identifying binary is
  today, and the entity takes no reference-mode column (Open decision 2).
  An entity player's key settles first: `identificationGraph` gains an
  edge from `E` to each entity far player. Each key column carries the
  far role as its `sourceRoleId`, as the columns an objectified entity
  absorbs carry their roles (`addRoleColumns`), so the DDL router and the
  annotator find them by role as they find any other column.
- When an external uniqueness is an entity's identifier and its columns
  are the table's whole primary key, the DDL router shall not route it as
  a separate `UNIQUE` clause, as it already skips an internal uniqueness
  that is the whole key (`isWholePrimaryKey`); its external branch has no
  such check today.
- When another table references such an entity, its foreign key shall
  name every key column, as references to an objectified entity's
  composite key already do.
- Every reader of `preferredIdentifiers` shall handle the external case
  explicitly (Inventory), so none treats an external identifier as
  absent or reads a fact type that is not there.
- When a NORMA file's `PreferredIdentifier` names an external uniqueness
  constraint, the NORMA importer shall keep that constraint and store it:
  the duplicate-dropping pass (`constraintPasses.ts` `addUnlessHeld`) shall
  not drop an external uniqueness a `PreferredIdentifier` names, as the
  internal pass already spares a named one (`namedIdentifiers`). When an
  external uniqueness is marked `IsPreferred` and its entity names no
  `PreferredIdentifier`, the importer shall store it when the resolver
  accepts it, as the internal fallback does.
- When an entity's stored identifier is external, the NORMA exporter shall
  write `PreferredIdentifier` and `IsPreferred` for it, and write no
  `_ReferenceMode` for that entity: NORMA reads a reference mode as the
  entity's identifier, so writing both states two.
- When an Ossie concept's `identify_by` names two relationships or more,
  the Ossie importer shall store the external uniqueness it creates as
  the concept's preferred identifier, and drop its barwise-alg warning.
  Where a relationship's multiplicity left its near role without a
  single-role uniqueness, the importer shall add one and warn, as its
  single-relationship branch already does for the far role:
  `identify_by` states each component is single-valued, and without that
  uniqueness the stored identifier would fail rule 3.
- When the Ossie writer decides `identify_by`, it shall use core's shape
  check for both cases it handles today: a stored external identifier,
  and the inference it makes for an entity with no stored identifier
  whose external uniqueness has the identifying shape. An external
  uniqueness that fails rule 3 is then no longer written as
  `identify_by` but reported as a loss, which changes Ossie output for
  any tracked model holding one; WS2 measures that over every tracked
  model and lists each change. Each component relationship is written
  with `E`'s role first, so `identify_by` can name it.

Out of scope:

- Verbalizing the identification ("the combination of Building and RoomNr
  provides the preferred identification scheme for Room"). No
  identifier, internal or external, is verbalized as such today; filed
  separately (Open decision 3).
- A transcript extraction or LLM parser path that emits an external
  identifier. The llm parser reads 2.0-style flags on internal
  uniquenesses only, and asking a model for a composite scheme is a
  prompt change with its own evaluation.
- A rule that a reference scheme's roles are mandatory, for either kind
  (barwise-i77).
- A reference scheme through a join longer than one fact type per
  component (Room identified by the Campus of its Building). ORM allows
  it; NORMA models it as a join path; nothing here reads one.

## Inventory

Verified against the code at 6bf215b9 unless marked provisional. Every
row that reads `.factType` or builds an `IdentifyingUniqueness` fails to
compile under the union until it decides the external case; that is what
makes this list checkable rather than remembered.

| Reader or builder                                                        | Reads today                                   | Verdict                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identification.ts` `resolvePreferredIdentifier`                         | internal uniqueness only                      | resolves the external shape through `inferExternalUniquenessJoin` plus rules 2 and 3                                                                                                                            |
| `identification.ts` `identifiedBy`, `placePreferredFlags`, `PlacedFlags` | build internal identifiers from 2.0 flags     | narrowed to `InternalIdentifyingUniqueness`: a 2.0 flag is only ever internal                                                                                                                                   |
| `identification.ts` `preferredIdentifyingBinary`                         | `at.factType`                                 | guards on `kind === "internal"`; external is not a binary                                                                                                                                                       |
| `identificationGraph`                                                    | objectification, identifying subtype          | adds `E` -> each entity far player of an external identifier                                                                                                                                                    |
| `identificationSources`                                                  | `factTypeId` of the identifier                | preferred-uniqueness arm carries `constraintId`, one id for either kind                                                                                                                                         |
| `isIdentified`, `OrmYamlAnnotator`, `diagramView`                        | `byEntity.has`, the binary helper             | unchanged: an external identifier is in `byEntity`, and is not a binary                                                                                                                                         |
| `RelationalMapper` phases 0 and 1                                        | identifying binary or reference mode          | composite key from the far roles, settled in identification order                                                                                                                                               |
| `formats/src/ddl/constraintRouting.ts` `routeAcross`                     | routes every external uniqueness              | skips the identifying one when it is the whole primary key                                                                                                                                                      |
| `completenessWarnings`                                                   | refuses external with an error                | accepts the shape; names the failed rule otherwise                                                                                                                                                              |
| `populationRenderer`                                                     | identifying fact type                         | joins the component populations on the entity (grounded in WS1)                                                                                                                                                 |
| `query/evaluate.ts` anchors and `query/types.ts`                         | one `factType` and its roles                  | `factTypes` added for every identifier (Open decision 4)                                                                                                                                                        |
| `query/format.ts`                                                        | prints `factType`                             | prints `factTypes`                                                                                                                                                                                              |
| `elementDiff` `preferredIdentifierLabel`                                 | labels by fact type and role position         | an external identifier is labelled by its components, each fact type and far-role position, sorted by that content as the internal label sorts its roles, so neither listing order nor ids register as a change |
| `ModelMerge` reference following                                         | uniqueness over the same roles                | also follows an external uniqueness over the same roles                                                                                                                                                         |
| `llm/ModelContext.ts`                                                    | hides identifying fact types                  | hides only an internal identifier's: an external scheme's components are not implied by the reference mode, so they stay in the context                                                                         |
| `llm/DraftModelParser.ts`                                                | `kept.factType.name` in a warning             | reads the internal arm: the parser stores 2.0-style flags, which are internal                                                                                                                                   |
| `vscode` `ModelTreeProvider`                                             | `byConstraint` keys                           | unchanged: grounded in WS1, see Implementation notes                                                                                                                                                            |
| `NormaXmlWriter` `collectPreferredIdentifiers`                           | internal identifier                           | WS1 skips an external one; WS2 writes it                                                                                                                                                                        |
| `norma/populationGraph.ts` `findIdentifyingSeat`                         | binary seat                                   | unchanged in WS1 (no binary, so it synthesizes as for any unseated entity); WS2 grounds whether NORMA needs more                                                                                                |
| `NormaToOrmMapper.mapPreferredIdentifiers`                               | stores internal refs only                     | stores an external ref, and the `IsPreferred` fallback reads external (WS2)                                                                                                                                     |
| `norma/mapping/constraintPasses.ts` `addUnlessHeld`                      | drops a duplicate external uniqueness         | spares one a `PreferredIdentifier` names (WS2)                                                                                                                                                                  |
| `ossie/writeOssie.ts` `compositeIdentifier`, `roleOrder`                 | its own shape check; internal-only role order | core's shape check; `E`'s role first in each component (WS2)                                                                                                                                                    |
| `ossie/mapOssieToOrm.ts` `addIdentifier`                                 | keeps external, warns                         | adds missing near-role uniquenesses, stores it as preferred (WS2)                                                                                                                                               |
| `schemas/orm-model.schema.json`                                          | "the uniqueness constraint"                   | description names both kinds; no shape change                                                                                                                                                                   |

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

/** The internal arm: what a 2.0 flag, and so `PlacedFlags`, can name. */
export type InternalIdentifyingUniqueness = Extract<
  IdentifyingUniqueness,
  { kind: "internal"; }
>;

/** The fact types an identifier spends: one internal, one per component external. */
export function identifyingFactTypes(
  at: IdentifyingUniqueness,
): readonly FactType[];
```

`PreferredIdentifierResolution`'s failure reasons gain one per shape rule
(`"external-no-common-object"`, `"external-other-entity"`,
`"external-not-binary"`, `"external-near-not-unique"`), so validation
names the rule and the resolver stays the one place it is decided.

## Workstreams

### 1. Core, and every reader the type change reaches

One PR, because changing `IdentifyingUniqueness` to a union fails to
compile in every reader until each decides the external case: the
resolver and its failure reasons, validation, `identificationGraph`, the
mapper, `identificationSources`, the population renderer, query anchors,
merge, and the downstream readers that compile against the type
(`llm/ModelContext.ts`, `llm/DraftModelParser.ts`, the vscode tree,
`NormaXmlWriter`'s `collectPreferredIdentifiers`, which in this workstream
skips an external identifier rather than writing it), the diff label, the
query anchors, and the DDL router's external branch.

Acceptance:

- The Room model validates clean, and its DDL keys `room` on
  `(building_code, room_nr)` with a foreign key to `building`, no
  `room_id` column, and no separate `UNIQUE (building_code, room_nr)`.
- A table referencing Room carries both columns and a two-column foreign
  key.
- Each failed shape rule is a test that names the rule in the message.
- `barwise diff --matching content` on two separately built Room models
  reports no identifier change, and reports one when a component differs.
- `barwise query` anchors for Room list both component fact types.
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

## Implementation notes (WS1)

- **The vscode tree needed no change.** Its provisional row grounded as
  `unchanged`: the tree draws an external constraint under each fact type
  it spans (`constraintsTouchingAny`) and badges it from `byConstraint`,
  which already holds the external identifier.
- **The population renderer** builds an externally identified entity's
  example by joining its component populations on the near-role value,
  starting from the first component's first instance; an entity no
  component population fully describes gets no example.
- **The DDL router's new check is broader than the identifier case.** It
  skips any external uniqueness whose columns are exactly the table's
  primary key, which is implied whatever names it, as the internal branch
  already did.
- **Acceptance measured.** `barwise validate` and `barwise export --format
  ddl` over all 117 tracked `.orm.yaml` files, before (the change stashed)
  and after: byte-identical, 13,995 lines.

## API and migration impact

- `IdentifyingUniqueness` gains a `kind` discriminant and an external
  arm. It is exported from `@barwise/core`; every in-repo reader is
  updated in WS1. An out-of-repo reader of `.factType` fails to compile
  rather than reading the wrong thing, which is the intent of the union.
- `IdentificationSource`'s preferred-uniqueness arm carries
  `constraintId` instead of `factTypeId`.
- The query anchors' `preferredIdentifier` gains `factTypes`; `factType`
  stays for an internal identifier and is absent for an external one (Open
  decision 4). That result reaches the CLI `query` command's JSON and the
  MCP `query_model` and `describe_domain` tools.
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

4. **The query anchors' identifier shape.** `EntityAnchors.preferredIdentifier`
   has one `factType: string`, and an external identifier has several.
   Options: (a) add `factTypes: string[]` for every identifier and keep
   `factType` only for an internal one; (b) replace `factType` with
   `factTypes`. **Recommend (a)**: a JSON consumer reading `factType` keeps
   working for every model it can read today, since none names an external
   identifier, and the one that does gets an absent field rather than a
   wrong one. (b) is the cleaner shape and breaks every reader of the
   field at once.

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
