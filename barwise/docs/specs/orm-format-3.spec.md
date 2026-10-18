# `.orm.yaml` format 3.0: constraint identity and placement by kind

Status: WS2 implemented 2026-10-17 (stable constraint ids under 2.0; NORMA
import keeps constraint, fact type, subtype fact and fact instance ids); WS3
grounded 2026-10-18, not started; WS4 and WS5 not started; Open decisions 1
to 8 resolved by the owner 2026-10-17, 9 open
Created: 2026-10-16
Last-updated: 2026-10-18
Tracking: barwise-n9n (constraint ids and placement); barwise-7oz (WS2); barwise-loo (one subtype
partition per supertype); barwise-alg (external uniqueness as preferred
identifier); barwise-971 (five rules for "the preferred identifier", Open
decision 8); barwise-hnb (NORMA comparison doc correction)

In one sentence: every constraint in a constraint list gets a required,
stable id; a constraint
lives where its kind says it lives -- the internal kinds nested in their fact
type, the external kinds in one model-level list -- and subtype exclusion and
totality become model-level constraints instead of flags; all of it ships as
one major format version, 3.0, with one deterministic migration.

## Principle

**Explicit over implicit, and determinism in core.** Today a constraint's
identity and its location are both accidents.

- **Identity.** A constraint `id` is optional, and 2,555 of the 3,085
  constraints in the 113 tracked models omit it. `FactType` mints a random one
  on every load, so the same unchanged file gives its constraints different ids
  each time it is read. Exporting `examples/getting-started/shop.orm.yaml` to
  NORMA twice gives different constraint ids (checked 2026-10-16), and a
  counterexample report cites an id that means nothing after the run. The NORMA
  importer also drops NORMA's own constraint ids while keeping its object type
  ids verbatim, so a NORMA round trip loses constraint identity.
- **Location.** A constraint that relates several fact types is filed under
  one of them, its "host", chosen by whoever wrote it; the NORMA importer picks
  the first fact type in model order that holds any of its roles. 73
  constraints in 28 tracked files live this way. Diff had to learn
  host-relative role keys to stop reporting them as removed and re-added
  (barwise-b7z), project split has to detect them crossing domains, and the
  constraint is deleted with its host though it is equally about the others.
- **Subtype exclusion and totality are not constraints at all.** They are
  `is_exclusive` / `is_exhaustive` flags on each `subtype_fact`, and the group
  is every subtype fact of one supertype with the flag set. A supertype can
  therefore have only one exclusive group and one exhaustive group
  (barwise-loo), the rule has no id, and it is restated on every member. NORMA
  states each as its own constraint; the importer collapses them into flags.

ORM already draws the line this spec uses. An **internal** constraint applies
to the roles of one fact type; an **external** constraint relates roles of
different fact types, or subtype links. NORMA keeps every constraint in one
model-level collection and has each fact type list only its internal ones by
reference. Placing by kind makes location a property of the constraint's type
-- predictable, checkable by the schema, and unchanged when someone edits a
constraint's roles.

## Should placement follow each constraint's span, or its kind? (resolved: kind, owner 2026-10-16)

By kind. A rule based on what an individual constraint's roles happen to cover
moves a constraint when its roles are edited, and a reader cannot tell from
the kind where to look. By kind, the schema states it: a fact type's
`constraints` admits only internal kinds, and the model's `constraints` only
external ones.

The two rules agree on today's corpus, which is evidence the kind rule
matches how models are actually written: all 73 external-kind constraints in
the tracked files span fact types, and no internal-kind constraint uses a
role outside its fact type except one deliberate validation-error fixture
(`vscode/tests/fixtures/validation-errors.orm.yaml`).

## Should every constraint be model-level, as in NORMA? (resolved: no, owner 2026-10-16)

The owner first chose NORMA's approach outright, then asked for placement by
kind once ADR 0001's "inline and local" filter was on the table. Internal
constraints have exactly one element to sit beside, so nesting them keeps the
filter for 3,011 of the 3,085 constraints in the corpus (73 are
external; the last is an unknown kind in a fixture, refused as it is today) and keeps a fact type readable with its
own uniqueness and mandatory rules. External constraints have no single
element to be local to; the model-level list is the honest home for them.
NORMA's split is the same, expressed by reference instead of by nesting.

## Scope

In scope:

- **Required constraint ids.** When a model is loaded, the system shall give
  every constraint the id its file states; a constraint without an id is
  refused in a 3.0 file.
- **Placement by kind.** When a model is loaded, the system shall accept an
  internal kind only in a fact type's `constraints` and an external kind only
  in the model's `constraints`, and refuse either in the other place, naming
  the constraint and where it belongs.
- **Subtype constraints.** Subtype exclusion and totality are model-level
  constraints over subtype facts, each with an id; a supertype may have any
  number of them. The `is_exclusive` and `is_exhaustive` flags are removed.
- **Preferred identifier by reference.** An entity type names its preferred
  identifier by the id of a uniqueness constraint, internal or external
  (Open decision 3). `is_preferred` is removed.
- **Deterministic migration.** When a 2.0 file is loaded, the system shall
  migrate it to 3.0 with the same result every time, including the same
  filled ids. A random id in a migration would recreate the defect this spec
  fixes for every file not yet saved.
- **NORMA import and export** keep constraint ids, place constraints by kind,
  map subtype exclusion and totality one constraint to one constraint, and
  carry the preferred identifier both ways.

Out of scope:

- **Constraint naming** (NORMA's `Name`, templated names): separate, owner
  2026-10-16.
- **New constraint kinds**: external frequency (barwise-kw5) and the further
  NORMA ring types (barwise-vc3). Placement by kind leaves room for both: an
  external frequency would be a model-level kind.
- **The Effect adoption spike** (`effect-adoption.spec.md`). Its schemas
  follow whatever format `main` has when its workstreams land; Open decision 6.
- **The LLM extraction format's shape.** It has no ids or placement of its
  own and keeps its `is_preferred` flag; the parser
  (`llm/src/parse/constraints.ts`) builds the model through the API and, in
  WS4, translates `is_preferred` into the entity's preferred-identifier
  reference with the migration's step 4 rule.

## Placement by kind

| Kind                                                   | Lives in                  | Tracked count |
| ------------------------------------------------------ | ------------------------- | ------------- |
| `internal_uniqueness`                                  | the fact type             | 1,854         |
| `mandatory`                                            | the fact type             | 1,098         |
| `ring`                                                 | the fact type             | 32            |
| `frequency`                                            | the fact type             | 13            |
| `value_constraint` (on a role)                         | the fact type             | 9             |
| `value_comparison`                                     | the fact type             | 5             |
| `cardinality` (unary role)                             | the fact type             | 0             |
| `external_uniqueness`                                  | the model                 | 35            |
| `subset`                                               | the model                 | 19            |
| `disjunctive_mandatory`                                | the model                 | 10            |
| `exclusion`                                            | the model                 | 4             |
| `equality`                                             | the model                 | 2             |
| `exclusive_or`                                         | the model                 | 2             |
| `join_subset`, `join_equality`, `join_exclusion`       | the model                 | 1             |
| subtype exclusion and totality (today 32 and 13 flags) | the model                 | --            |
| object type value constraint, object cardinality       | the object type (no move) | --            |

Counts are from the tracked `.orm.yaml` files on 2026-10-16. Every internal
kind is already held to its fact type's roles by validation
(`constraintConsistency.ts`); the schema now says so too.

## Target architecture

```yaml
orm_version: "3.0"
model:
  name: Facilities
  object_types:
    - id: ot-room
      name: Room
      kind: entity
      preferred_identifier: c-room-key # a uniqueness constraint's id
    - id: ot-building
      name: Building
      kind: entity
      reference_mode: code
      preferred_identifier: c-building-code
    # ...
  fact_types:
    - id: ft-room-in-building
      name: Room is in Building
      roles:
        - { id: r-1, player: ot-room, role_name: is in }
        - { id: r-2, player: ot-building, role_name: houses }
      readings: ["{0} is in {1}"]
      constraints: # internal kinds only
        - id: c-room-one-building
          type: internal_uniqueness
          roles: [r-1]
        - id: c-room-in-mandatory
          type: mandatory
          role: r-1
    # ...
  subtype_facts:
    - { id: sf-1, subtype: ot-male, supertype: ot-person }
    - { id: sf-2, subtype: ot-female, supertype: ot-person }
  constraints: # external kinds only
    - id: c-room-key
      type: external_uniqueness
      roles: [r-2, r-4] # the roles Building and RoomNumber play opposite Room
    - id: c-sex-partition
      type: exclusive_or
      subtype_facts: [sf-1, sf-2]
```

In memory, the same split is a type split, so the compiler finds every
consumer that has to change:

```ts
// core/src/model/Constraint.ts
type InternalConstraint =
  | InternalUniquenessConstraint
  | MandatoryRoleConstraint
  | RingConstraint
  | FrequencyConstraint
  | ValueConstraint
  | ValueComparisonConstraint
  | CardinalityConstraint;
type ExternalConstraint = Exclude<Constraint, InternalConstraint>;
// FactType.internalConstraints: readonly InternalConstraint[]
// (FactType.constraints is removed, so every reader must be revisited)
// OrmModel.constraints: readonly ExternalConstraint[]
// OrmModel.constraintsTouching(factTypeId): readonly Constraint[]
```

91 reads in 43 source files across seven packages use `factType.constraints`
today (WS3 has the measurement).
Removing the property, rather than narrowing its type, makes every one of
them a compile error: a narrowed type would catch a `switch` that handles
`subset`, but a plain `for (const c of ft.constraints)` would keep compiling
and silently stop seeing external constraints (Risks).

**The migration (2.0 to 3.0)** is pure, runs on the raw document before
validation like `diagramReferencesToIds.ts`, and registers in
`schemaVersion.ts`:

1. Every constraint without an id gets one derived from its content: a hash
   of the fact type id and the constraint as read (its kind, roles in their
   written order, bounds, values, flags -- after the reader has folded
   equivalent spellings, such as a frequency's `role` or `roles`), with an
   occurrence number
   only to tell apart identical constraints in one fact type. Content, not
   position: inserting a constraint before others changes no other
   constraint's id, so two revisions of one 2.0 file migrated separately
   give the same id to the same constraint, and diff and merge can match by
   id. An id is derived once, at migration, and is stated in the file from
   the first save; editing a constraint afterwards does not change it.
   Every derived id hashes a domain tag first (`barwise.constraint` here,
   `barwise.subtype-constraint` in step 3), then each input with its length
   in front. The tag keeps the two steps apart; the length prefix keeps
   inputs within a step apart (the inputs `ft-1`, `mandatory` and `ft-1m`,
   `andatory` would otherwise concatenate identically). Open decision 4 sets
   the shape. Constraints in a constraint list are what step 1 covers; an
   object type's value constraint and object cardinality stay properties of
   their object type, identified by it, and NORMA export derives their
   NORMA ids from the object type's id.
2. Every external-kind constraint moves from its fact type to
   `model.constraints`, keeping its id and fields.
3. For each supertype, let E be its subtype facts flagged `is_exclusive` and
   X those flagged `is_exhaustive`. In 2.0 the two flag sets are independent,
   so they are converted independently, with one merge:
   - E and X equal, with two or more members: one `exclusive_or` over them.
   - Otherwise, E with two or more members: one `exclusion` over E; and X
     with one or more members: one `disjunctive_mandatory` over X.
   - E with a single member is dropped: exclusion within a one-member group
     always holds, so it states nothing. X with a single member is kept, since
     "every Person is a Male" is a real (if odd) rule; WS4's validation
     therefore allows one subtype fact in `disjunctive_mandatory` and requires
     two in `exclusion` and `exclusive_or`.

   Ids are derived from the supertype id and the kind. The flags are removed.
   The corpus has no partly overlapping or one-member group today (32
   exclusive and 13 exhaustive flags, every group consistent), so each case
   above gets its own fixture.
4. Each `is_preferred: true` becomes `preferred_identifier` on the entity
   it identifies, by the rule Open decision 8 settles. The migration never
   refuses a file over this step: a flag the rule cannot place on a single
   entity is dropped, the uniqueness constraint itself is kept, and a
   corpus test lists every dropped flag by constraint id so each drop is
   deliberate. The flag is removed.
5. `orm_version` becomes `"3.0"`.

A file stays 2.0 on disk until it is saved, and it loads to the same model
every time until then.

## Inventory

| Area                                                      | Today                                             | Verdict                                                                   |
| --------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| `core/schemas/orm-model.schema.json`                      | `orm_version` const `2.0`; one constraint `oneOf` | 3.0; internal and external `oneOf`s; ids required; flags removed          |
| `core/src/serialization/schemaVersion.ts`                 | migrations 1.0 to 1.1 to 2.0                      | adds 2.0 to 3.0                                                           |
| `core/src/serialization/migrations/`                      | `diagramReferencesToIds.ts`                       | adds the 3.0 migration                                                    |
| `core/src/serialization/yaml/constraint.ts`, `subtype.ts` | nested constraints; subtype flags                 | model-level constraints; subtype flags gone                               |
| `core/src/model/FactType.ts`                              | mints missing constraint ids (line 108)           | requires ids; `constraints` removed; `internalConstraints`                |
| `core/src/model/OrmModel.ts`                              | no constraint list                                | `constraints`, `constraintsTouching`                                      |
| `core/src/model/Constraint.ts`                            | one 16-kind union                                 | `InternalConstraint` / `ExternalConstraint`; subtype operands             |
| `core/src/model/SubtypeFact.ts`                           | `isExclusive`, `isExhaustive`                     | removed                                                                   |
| `core/src/model/identification.ts`                        | preferred = internal uniqueness flag              | preferred = the entity's referenced constraint                            |
| `core/src/validation/`, `verbalization/`, `mapping/`      | read external kinds from `ft.constraints`         | read `model.constraints`; compiler-guided                                 |
| `core/src/diff/`, `ModelMerge.ts`                         | match constraints by content key                  | external kinds in a model-level delta; still matched by content (WS3)     |
| `core/src/project/splitModel.ts`                          | detects cross-domain constraints under hosts      | migrates the raw document to 3.0 before splitting; reads the model list   |
| `formats/src/norma/`                                      | drops constraint ids; first-holder host; flags    | keeps ids; places by kind; partition constraints 1:1; preferred both ways |
| `diagram/src/graph/ModelToGraph.ts`                       | constraint nodes `constraint-<index>`             | node id = constraint id                                                   |
| `llm/src/parse/`                                          | attaches constraints to fact types                | places by kind through the model API                                      |
| tracked `.orm.yaml` files (113)                           | 2.0                                               | rewritten as 3.0 by the migration, in WS5                                 |
| `docs/NORMA_VS_ORM_YAML.md`                               | matrix overstates two rows (barwise-hnb)          | corrected in WS5                                                          |
| `docs/adr/`                                               | ADR 0001 "inline and local"                       | ADR 0003 amends it for external constraints                               |

Not in the table because they need no design decision, but in WS3 and WS4's
scope: the programmatic builders that create constraints without ids or set
`isPreferred` -- `llm/src/parse/constraints.ts` and `ModelContext.ts`,
`dbt/src/dbtMapping/identifierTypes.ts`, the DDL and OpenAPI importers,
NORMA mapping -- and the core readers of `isPreferred` (22 files across
core, dbt, formats, llm and vscode read it today). A constraint built in
code gets its id at the construction boundary from the installed generator
(`effect-adoption.spec.md` decision 8): it is new, so a fresh id is right,
and it is stated in the file from its first save. The extraction format in
`llm/src/prompt/responseSchema.ts` keeps its shape (see Scope).

**The DDL `barwise` annotation is a second persisted format.** It writes
`isExclusive` and `isExhaustive` per subtype fact
(`formats/src/ddl/barwiseAnnotation.ts`: declared at lines 51-52, written
at 165-166, checked by the reader at 335-336), under a
`-- barwise:v1` prefix whose reader already matches any version. WS4 moves
it to v2, writing the partition constraints, and keeps a v1 reader that
converts the flags with the migration's step 3, so DDL already exported
still imports.

## Alternatives considered

- **Every constraint at model level, as NORMA does.** One rule, closest to
  NORMA. Rejected by the owner once placement by kind was on the table: it
  moves 3,011 internal constraints away from the fact type they describe,
  breaks ADR 0001's "inline and local" for every kind, and makes a hand author
  or an LLM editing through MCP keep 3,085 cross-references consistent instead
  of 73.
- **Placement by each constraint's span.** Rejected above: location would
  change when roles are edited.
- **Keep ids optional and derive a stable id from content on every load.**
  No migration, but an id recomputed on every load changes whenever the
  constraint is edited, so it is not an identity. The migration derives from
  content too, but once, and the file keeps the id from then on.
- **Keep the host, and fix only the host rule.** Smallest change; the
  constraint still dies with an arbitrary host, and subtype exclusion still has
  nowhere to live.

## Workstreams (each independently shippable)

**The format changes in one workstream, WS4; everything before it keeps
reading and writing 2.0 without loss.** ADR 0001 allows a shared version
bump across several PRs only for additive minor changes; a breaking change
bumps the major version "with a real migration". Bumping to 3.0 in an early
workstream and adding to it later would let any build in between save a file
stamped 3.0 that later 3.0 readers refuse, and no migration would ever run on
it, because it already claims the current version. So WS2 and WS3 change only
what a 2.0 file can carry without loss, and WS4 changes the version, the
schema, the serializer, the migration and the in-memory pieces 2.0 cannot
represent, in one PR. Subtype constraints and the preferred-identifier
reference are in WS4 for that reason: a 2.0 serializer would have to convert
them back to flags on save, and steps 3 and 4 drop what the flags cannot
hold, so a 2.0 save between workstreams would silently lose data.

### 1. ADR 0003 and this spec

ADR 0003 amends ADR 0001's "inline and local" filter: an internal constraint
lives inline on its fact type; an external constraint, which has no single
element to be local to, lives in the model's constraint list and refers to
roles and subtype facts by id. Records the owner's two decisions above.

### 2. Stable ids under 2.0 (implemented 2026-10-17)

The user-visible defect, fixed without a format change: when a 2.0 file
omits a constraint id, the loader derives one with the migration's step 1
rule instead of minting a random one, so the same file always loads to the
same ids. The NORMA importer keeps NORMA's constraint ids. The test that
fails today: loading one 2.0 file twice yields the same constraint ids, and
two NORMA exports of it are byte-identical.

Implementation notes (2026-10-17):

- `core/src/serialization/derivedId.ts` holds `derivedId` (the UUIDv8),
  `canonicalJson` and `withDerivedIds`; WS4's migration step 1 reuses
  `withDerivedIds`, so the ids a 2.0 load gives today are the ids the
  migration will write. The model loader (`OrmYamlSerializer`) calls it
  over every fact type `deserializeFactType` read, before `FactType`'s
  generator fill can run, which now fills only constraints built in code;
  `deserializeFactType` alone leaves an omitted id omitted. `derivedId` and
  `canonicalJson` are exported from the core root, and the NORMA importer
  uses them for a constraint its file gives no id -- the same recipe under
  its own tag (`barwise.norma-constraint`), over the parsed NORMA
  constraint and with `_2` suffixes, so its ids are not the ones core
  would derive for that constraint in a 2.0 file and are not meant to be.
- A missing id and an empty one are treated alike, as the reader already
  did. Content is the constraint as `deserializeConstraint` reads it, keys
  sorted, `id` left out, so spellings the reader folds (a frequency's `role`
  or `roles`, an explicit `modality: alethic`) give one id. The occurrence
  number is the only positional input and matters only between exact
  duplicates.
- The NORMA importer gives every mapped constraint its id through one
  allocator on the mapping context (`ConstraintIdAllocator`, in
  `mapping/context.ts`), claimed at every mapping site in both phases.
  It holds the rules once. An exclusive-or maps once, under its exclusion's
  id, whichever half and coupler the file carries and whichever fact types
  list it (`buildExclusiveOr`); when the couplers disagree,
  the mandatory's own wins. Both phases ask that one pairing whether a
  half is an exclusive-or, never the half's own coupler alone, so a listed
  half whose partner carries the only coupler still maps as the
  exclusive-or. A half is a constraint that can build the exclusive-or over
  its own roles: a mandatory that is not simple or implied, or an
  exclusion with no join path over two single-role sequences or more (a
  mandatory over two roles or more); a coupled
  constraint that cannot
  maps as what it is and keeps its own id. Two halves pair when the
  mandatory can build and each is in one pair only; the pair maps to one
  exclusive_or over the mandatory's roles and consumes its exclusion, join
  path or not, since NORMA couples only plain role sequences (a path that
  failed to decode used to leave a stray flat exclusion beside it). The
  pair is built from the mandatory -- its roles and modality -- whichever
  half a phase reaches first, and couplers that agree in both directions
  pair before a one-way claim. Phase 3 now keeps a multi-fact constraint's
  deontic modality and dedupes on it, as phase 1 always did; before, an
  unlisted deontic exclusion, subset or equality imported as alethic,
  which predates WS2 and is fixed here because the pass was reworked.
  Both phases now drop a constraint as a duplicate only when one already
  held says exactly the same thing (`holdsSame`, over core's
  `canonicalJson`), so listing no longer decides whether a second identical
  rule survives -- phase 1 used to keep both. Listing can still change the
  shape of a few kinds, because phase 3 builds simple mandatory, value,
  ring and external uniqueness constraints with its own code rather than
  `mapNormaConstraint`; that predates WS2 and is barwise-vq7. Keeping one of two identical
  rules, and losing the second one's NORMA id, is the policy nine existing
  importer tests pin; it is kept, not reopened here. The check replaces per-kind checks that had drifted: a subset
  compared only its subset roles and an equality only its first sequence,
  so a NORMA-written file with two subsets from one role lost the second,
  and its id, on import; a ring ignored its type. A half with no such partner --
  deleted, unable to build, or the one that lost a coupler disagreement --
  builds the exclusive-or over its own roles, where before it was skipped for a partner that never built it
  and the constraint was lost (barwise-e58, fixed here). Every half therefore maps as the exclusive-or. A NORMA constraint the file gives no id (the
  parser reads it as `""`) gets one derived from its content by core's
  `derivedId` (tag `barwise.norma-constraint`), rather than one from the
  generator or from its place in the document; an id-less half or an empty
  coupler ref pairs with nothing. A second constraint mapped from
  one NORMA constraint gets `<id>_2`, skipping every id the document holds
  for any element, since NORMA's ids share one space (every `id` and `...Id` field the
  parser keeps); an inline
  cardinality without an id gets the writer's id for it
  (`cardinalityId`, shared by both; the writer spells an object type's with it too, but that cardinality is a property with no id in the metamodel, so its NORMA id is not kept: barwise-eok), under the same rule. Distinct
  exclusive-or pairs over the same roles merge into one constraint, as
  before, and both phases now check the whole model for it
  (inside `buildExclusiveOr`, a lookup of the role sets built so far) rather
  than one fact type, so whether two such pairs merge no longer depends
  on which phase maps which. Which pair's id the merged constraint keeps
  does: a listed pair maps in phase 1, ahead of an unlisted one. That is
  fixed for a given file, and only a file with two pairs saying one thing
  reaches it; the loser is dropped without a diagnostic, as before WS2,
  because the importer has no warning channel. Modality is part of what is compared: a deontic pair beside
  an alethic one over the same roles is kept. The exclusive-or pairing and the
  set of listed constraint ids are computed once per import, on the
  context, and read by the passes and the allocator alike.
- The NORMA importer keeps NORMA's fact type and subtype fact ids, as it
  kept object type ids, and derives an objectification link's id from the
  two ids it links unless its NestedPredicate carries an id of its own,
  which it keeps (and the writer now writes the link's id there), keeps fact instance
  ids, and derives a population's id from its fact type and a unary row's
  from its instance and role (the parser already drops a fact instance
  with no id), so one NORMA file
  imports to one model every time; before, every fact type id came from the
  generator. That is import determinism, not round-trip identity for sample
  data: the writer still numbers fact and entity instances by position
  (barwise-1i6). A constraint added through `addConstraint` in code still has no
  id until saved, and exports under a positional one (barwise-nkq).
- In core, the model loader derives ids after reading every fact type
  (`OrmYamlSerializer`, over `deserializeFactType`'s output), and a derived
  id steps past any constraint id the file states, in any fact type, so a constraint added without an id beside a saved
  identical one -- or where a saved one was moved away from -- gets a new id
  rather than a duplicate. The guarantee is per file: `project split`
  copies raw YAML, so a constraint that steps past an id stated in another
  fact type can derive a different id once that fact type is in another
  domain file. It takes a hand-moved saved id plus an identical id-less
  constraint, split before any save; saving first states every id. A duplicate id the file states itself is the
  author's error; the writer's silent drop of a repeated id predates WS2
  (it now drops the repeat whole, with no second InternalConstraints
  entry) and is answered by Open decision 4's duplicate-id refusal, which lands
  with the format in WS4.
- Known limits, accepted: barwise holds an exclusive-or as one constraint
  with one id, so the NORMA id of its mandatory half does not survive a
  NORMA round trip (the exporter writes `<exclusion-id>_xormand`); and
  list order inside a constraint is hashed, so reordering a uniqueness's
  roles in an unsaved 2.0 file gives it a new id, as any other edit would.
  Folding order away would restate, kind by kind, which lists are sets --
  the rules diff's `constraintKey` holds -- and once a file is saved the id
  is stated. A NORMA constraint listed in two fact types maps once per
  fact type, as it did before WS2, and now exports as `<id>` and
  `<id>_2`; that the import splits it predates WS2. What a NORMA round trip
  keeps is the identity of the elements barwise holds with ids; NORMA
  elements barwise folds into another element's fields lose theirs --
  subtype partition constraints (SubtypeFact flags until WS3 makes them
  constraints), reading orders and readings, subtype meta-roles, the
  exclusive-or mandatory half (above) and object-type cardinality
  (barwise-eok). And the trip from barwise is not identity-preserving
  for ids without NORMA's `_` prefix: the exporter adds it (`toNormaId`)
  and the importer keeps what NORMA wrote, so `ft-1` comes back as
  `_ft-1`; that predates WS2 for object types and now reaches fact types
  and constraints.
- Tests: `core/tests/serialization/derivedConstraintIds.test.ts` and
  `formats/tests/NormaConstraintIds.test.ts`. Each was run against a
  planted defect (no derivation, no key sort, no length prefix, position
  instead of content, no occurrence number, no version bits, raw YAML
  hashed instead of the read constraint; NORMA ids dropped in phase 2, in
  the passes, no duplicate handling, the exclusive-or pairing read from one
  coupler only, phase 1 reading a half's own coupler, an empty NORMA id
  passed through or named by position, an id-less half or empty ref
  paired, modality left out of the merge, a dropped repeat still listed,
  the exclusive-or's mandatory half left out of the repeat check, a
  join-path exclusion counted as a half, any half's claim marking its pair, the same-roles merge
  dropped in phase 1 or held to one fact type in phase 2, reservation of
  constraint ids only, the model id missed, a changed tag, a changed read
  shape, unpadded hex) and failed for each. Two derived ids are pinned to
  values recomputed by hand from the recipe, so a change to the derivation
  or to what the reader builds cannot pass unnoticed.

### 3. Placement by kind, in memory (grounded 2026-10-18)

External constraints move from their fact type to `OrmModel.constraints`
in three PRs, and the file stays 2.0 throughout: 3a adds the new API in
core and moves core's own readers, 3b moves the other packages' readers,
and 3c moves the storage and removes `FactType.constraints`. Removing the
getter last is still what proves no reader was missed: in 3c, any reader
the first two PRs did not reach stops compiling.

**What the move touches, measured 2026-10-18.** With the getter renamed and
every package type-checked (a probe, then reverted), the compiler reports
91 reads in 43 source files across seven packages:

| Package | Files | Reads |
| ------- | ----- | ----- |
| core    | 29    | 60    |
| llm     | 4     | 11    |
| formats | 4     | 7     |
| diagram | 2     | 6     |
| dbt     | 1     | 3     |
| learn   | 2     | 3     |
| vscode  | 1     | 1     |

cli, mcp, promptlab, code-analysis and diagram-ui read none. The draft's 52
files across nine packages was a text search, not a compile. There are 13
writes, `addConstraint` calls in four source files (`llm/src/parse/constraints.ts`,
`dbt/src/dbtMapping/sqlPatterns.ts`, the DDL importer, and NORMA's
phase 3). Tests read `.constraints` at most 112 times in 30 files; that is a
text-search ceiling, since tests are not type-checked (barwise-944).

**Each read falls into one of three groups, and the group decides the
change.**

- **It reads only internal kinds.** That means a filter on mandatory,
  uniqueness, ring, frequency, value, value comparison or cardinality, or
  a read of `isPreferred`. The read becomes `internalConstraints`, with no
  change in behaviour. Examples: the ring, uniqueness and value population
  rules, `identification.ts`, `NormaXmlWriter.collectPreferredIdentifiers`,
  and dbt's `sqlPatterns.ts`.
- **It reads only external kinds.** These are the spanning, set-comparison,
  join and disjunctive-mandatory population rules. They read
  `model.constraints` once instead of each host's list. A local external
  constraint, one whose roles all sit in one fact type, is still external:
  the set-comparison rules, which check one population at a time, find it
  through `constraintsTouching`.
- **It reads every constraint.** One rule decides these sites:
  - A whole-model view reads each fact type's `internalConstraints` plus
    `model.constraints` once, so each constraint appears once. Examples:
    `verbalizeModel`, `describeFullModel`, query's `listConstraints`, the
    counts, the review summary, the diagram graph, lineage and
    `constraintConsistency`.
  - A view of one fact type reads `constraintsTouching(ft.id)`, so a rule
    across fact types appears under each fact type it touches, but once
    per view. Examples: `verbalizeFactType`, `describeFactType`, the
    sidebar tree, and the diagram session's per-fact-type summary.

  Open decision 7 asked only for the first kind of view.

**The host appears in several outputs; it is replaced, not kept.** Each
output below is built from the host fact type, or from a constraint's
position in the host's list:

- Validation: messages say "in fact type X" (the six external cases in
  `constraintConsistency.ts`, and ten join-rule reports in
  `joinConstraintRules.ts` and `population/joinPath.ts`), and element ids
  are the host's (`ft.id`) or fall back to it (`c.id ?? ft.id`).
- Verbalization: a constraint's `Verbalization` carries the host's id, and
  its labels for roles in other fact types are worded relative to the host.
- Query: `ConstraintRef.factType` and `factTypeId`, which MCP's query
  output repeats.
- Describe: summary ids are positional (`${ft.id}-constraint-${i}`), and
  so is query's fallback id. Both shift when a constraint changes host.
- References: `ReferenceSource { kind: "constraint", factType }` in
  `model/graph.ts`, plus counterexamples and lineage's
  `getConstraintName(c, ft)`.
- Diagram: node ids are `constraint-<index>`.
- Diff: a constraint change sits inside its host's fact type delta.

Open decision 9 sets what replaces the host. The recommendation is the
constraint's id wherever an element id is needed, and the fact types it
spans, in model order, wherever a name is. Signatures split the same way.
An internal constraint keeps its fact type as context,
`(c: InternalConstraint, ft)`; an external one takes the model,
`(c: ExternalConstraint, model)`.

**Diff and merge keep matching by content.** This corrects Open decision 4
and the Inventory row. Matching by id would break the comparisons diff
exists for:

- `llm/src/sampleAgreement.ts` and `TranscriptProcessor.ts` diff
  independent LLM samples, whose ids are unrelated by construction.
- `merge` diffs an import against its base.

External constraints get their own model-level delta,
`elementType: "constraint"`, alongside the six element types `deltas.ts`
already has. It is keyed by the same content key, resolved through the
model-wide role holders that `elementDiff.ts` already builds. Between two
revisions of one file, which do share ids, matching by id first would
report an edited constraint as one change instead of a removal and an
addition. That is filed as barwise-18n, outside this workstream.

**The 2.0 serializer keeps the file's nesting.** On load it lifts the
external kinds into the model list. This happens after `withDerivedIds`,
which hashes the host's id, so derived ids do not change. They keep file
order: by host, then by position. On save it writes each one under the
first fact type, in model order, that holds one of its roles, after that
fact type's internal constraints. A save followed by a load therefore
gives back the same order.

Measured through the loader on the 78 tracked files it accepts:

- 72 external constraints, in 27 files.
- Every one comes after its host's internal constraints.
- 26 sit on a fact type other than their first holder, in 17 files. The
  draft said 27 in 18 from a text search, and the extra one is in a file
  the loader refuses. Those 26 move to their first holder on the next 2.0
  save, with ids and order kept. That changes where they are written, not
  what they mean: the host in 2.0 is arbitrary by definition. So the move
  is accepted rather than carried as a hidden host field on the model. If
  a release is cut while 2.0 is still current, its notes say that a save
  may move a cross-fact-type constraint to the first fact type it
  references.
- None has no holder. One can still arise, from code or from a lenient
  load of a file whose role references dangle. The 2.0 save refuses such a
  constraint and names it, because 2.0 has nowhere to write it.

**Writers.** In 3c, `OrmModel.addConstraint(c: ExternalConstraint)` arrives,
and `FactType.addConstraint` narrows to `InternalConstraint`. Both fill a
missing id from the installed generator, as the constructor already does.
That closes barwise-nkq and makes `NormaXmlWriter`'s positional fallback id
unreachable, so 3c removes it. Two duplicate checks compare external kinds
within one host today: NORMA phase 3's `holdsSame` and the LLM parser's
`isDuplicateConstraint`. Pointed at `model.constraints`, they compare
across the whole model, so two identical external constraints that 2.0 put
under different hosts become one. NORMA itself keeps every constraint at
model level, so this matches it.

**The three PRs.**

- **3a, core.** Adds `InternalConstraint`, `ExternalConstraint` and
  `isInternalConstraint`; `FactType.internalConstraints`; and
  `OrmModel.constraints` and `constraintsTouching`. While storage stays on
  the fact types, the last two are computed from them. Core's 29 files
  move, together with the output changes of Open decision 9, diff's
  constraint delta and verbalization's section for constraints across
  fact types. Golden files and query snapshots change here.
- **3b, the other packages.** The readers in llm, formats, diagram, learn,
  dbt and vscode move. The diagram's constraint nodes take the
  constraint's id.
- **3c, storage.** External constraints are stored on `OrmModel`;
  `FactType.constraints` is removed; the serializer lifts and lowers them;
  the writers call `model.addConstraint`; and ids are filled
  (barwise-nkq). It also lands the type test that `FactType.addConstraint`
  rejects every external kind.

The draft put all of this in one PR. The split costs a little: until 3c,
`OrmModel.constraints` walks the fact types on every read, so a rule that
calls `constraintsTouching` once per fact type does work proportional to
fact types times constraints. On the largest tracked model (121 fact types,
258 constraints) that is about 31,000 steps, which is negligible. What it buys is a
reviewable PR per package, against one PR touching 43 source files, up to
30 test files, and every output above. It costs no safety, because 3c's
removal is the compile-time check the draft wanted.

### 4. Format 3.0 (provisional: not yet grounded)

One PR:

- `orm_version` 3.0 and the schema: ids required, the two `oneOf`s,
  `model.constraints`, `subtype_facts` operands, `preferred_identifier`,
  the flags removed;
- the 2.0-to-3.0 migration, steps 1 to 5, and the 3.0 serializer;
- subtype constraints in memory: `exclusion`, `disjunctive_mandatory` and
  `exclusive_or` accept subtype facts in place of roles (Open decision 2),
  with the validation in step 3;
- the preferred-identifier reference in memory (Open decisions 3 and 8),
  read by the mapper and `identification.ts`, which closes barwise-971 by
  giving the five rules one answer to read;
- NORMA import and export placing by kind and mapping partition constraints
  one to one; the DDL annotation's v1 to v2 move.

Closes barwise-loo and barwise-alg.

### 5. Corpus, docs, release notes (provisional: not yet grounded)

The tracked 113 files rewritten by the migration (a script under `scripts/`,
or the CLI command of Open decision 5); `docs/NORMA_VS_ORM_YAML.md` corrected
(barwise-hnb); CLI and format docs; release notes naming the migration and
listing what step 4 drops. It can share WS4's PR if the radius allows.

## API and migration impact

- **Every 2.0 file loads unchanged**, migrated in memory, and is written as
  3.0 on its next save. A 2.x build refuses a 3.0 file by version, as the
  schema `const` already makes it.
- **Core's public API changes**: `FactType.constraints` is removed and
  `FactType.internalConstraints` holds the internal kinds, `OrmModel.constraints` is new, `SubtypeFact.isExclusive` and
  `isExhaustive` and `isPreferred` are removed. Downstream packages follow in
  the same workstreams; the full monorepo build gates each.
- **Diff output** reports external constraints in their own model-level
  delta, still matched by content (WS3).
- **Verbalization output** moves external constraints into their own section;
  golden files change in WS3.

## Open decisions (1 to 8 resolved 2026-10-17; 9 open)

1. **ADR 0003 amends ADR 0001's "inline and local" -- resolved 2026-10-17 by the owner: yes,
   as recommended.** Recommend: yes, as
   WS1 states it -- internal inline, external model-level by reference.
2. **Shape of subtype constraints -- resolved 2026-10-17 by the owner: option (a), reuse
   the three kinds with a `subtype_facts` operand.**
   - **(a)** Reuse `exclusion`, `disjunctive_mandatory` and `exclusive_or`
     with a `subtype_facts` operand. Recommended: it is NORMA's own
     representation (an exclusion or mandatory constraint over the subtype
     links' supertype roles), adds no kinds, and verbalizes as "each Person
     is at most one of: Male, Female".
   - **(b)** Three dedicated kinds (`subtype_exclusion` and so on). Clearer
     in a switch; three more kinds for every consumer to handle.
3. **Preferred identifier by reference, in 3.0 -- resolved 2026-10-17 by the owner: yes.**
   Recommend: yes. 3.0 is the
   one breaking bump, required ids are what make the reference possible, and
   it closes barwise-alg. The alternative, `is_preferred` added to
   `external_uniqueness`, keeps a flag the entity cannot see.
4. **Shape of migration-derived ids -- resolved 2026-10-17 by the owner: UUIDv8 from a
   hash.** Recommend: a UUIDv8 built from a
   SHA-256 of the inputs, so derived ids look like every other id and a
   collision with an author's id is improbable. Improbable is not
   impossible, so the loader refuses two constraints with the same id in
   one model, whatever their origin; that check, not the id shape, is what
   guarantees uniqueness. The alternative, readable ids such as
   `<fact-type-id>-c0`, is easier to read in a diff and collides with any
   author id spelled the same way.

   Because derived ids come from content (step 1), two revisions of one
   2.0 file give the same constraint the same id, and diff and merge match
   constraints by id whatever the files' versions. An edited constraint
   gets a different id, which diff reports as a removal and an addition,
   the same as today's content-key matching.

   Corrected 2026-10-18, by WS3's grounding: diff and merge do not switch
   to matching by id. They also compare models whose ids are unrelated by
   construction -- independent LLM samples, an import against its base --
   and there an id match would report every constraint as changed. They
   keep content keys; matching by id first where both sides share an id is
   barwise-18n.
5. **A `barwise migrate` command -- resolved 2026-10-17 by the owner: yes, CLI only, with a
   deliberate capability-matrix row.** Recommend: yes, CLI-only, rewriting files
   in place to the current version; it serves the 113 tracked files and every
   user's repository, and gets a deliberate capability-matrix row. The
   alternative is relying on each file's next save.
6. **Order against the Effect adoption -- resolved 2026-10-17 by the owner: format 3.0
   first.** Recommend: format 3.0 on `main`
   first, with the hand-written serializers. It fixes user-visible defects
   now, and the Effect spike's schemas then describe 3.0 -- which also removes
   that spec's optional-id complication (its WS1b part C).
7. **Verbalizing external constraints -- resolved 2026-10-17 by the owner: their own
   section.** Recommend: one section for
   constraints across fact types, each verbalized once. The alternative,
   repeating each under every fact type it touches, reads well per fact type
   and states every rule two or more times.
8. **What 2.0's `is_preferred` meant, for the migration's step 4 --
   resolved 2026-10-17 by the owner: option (a), the ORM reading.** Five
   modules answer "which constraint is this entity's preferred identifier"
   with five different rules today (barwise-971), and the corpus does not
   follow any one of them: of the 376 preferred uniquenesses, 286 sit on the
   entity's own role in an entity-value binary ("each Customer has at most
   one number"), 68 on the value's role ("each number belongs to at most one
   Customer"), 12 span every role of an objectified fact type, and 10 sit on
   n-ary fact types. In ORM, and in NORMA's `PreferredIdentifier`, the
   reference scheme is the second kind: the uniqueness over the roles played
   opposite the entity. `NormaXmlWriter.collectPreferredIdentifiers` finds
   no entity for the 286 for that reason. Format 3.0 ends the ambiguity for
   new files, because the entity names its identifier; the migration has to
   read the old flag once.
   - **(a)** Recommended. The flag marks which fact type identifies which
     entity, and the reference points at the constraint ORM means:
     - an objectified fact type whose flagged uniqueness spans every role:
       the objectifying type, identified by that uniqueness;
     - a binary between one entity and one value type, whichever role the
       flag is on: the entity, identified by the uniqueness on the value's
       role. 284 of the 286 entity-role flags have one; the mapper's primary
       key is chosen by fact type (`preferredIdentifyingBinary`), so no
       table's key moves, and NORMA export receives a valid reference;
     - otherwise, when one entity type plays every uncovered role: that
       entity, identified by the flagged uniqueness;
     - anything else is dropped, as step 4 says.

     When flags name two or more different constraints for one entity, the
     first in document order wins. That resolves, and so hides, a modeling
     error the 2.0 validator reports (an entity with two identifiers). The
     4 such entities in the corpus are fixed by hand in WS5 before their
     files are migrated, and the release notes tell users to run
     `barwise validate` on 2.0 files first. On the corpus this rule places
     372 of the 376 flags and drops 4: one ternary
     (`WonItemHasSoldPriceAtTimestamp`, in two copies of the auction model)
     and 2 entity-value binaries with no uniqueness on the value's role.
   - **(b)** Use `collectPreferredIdentifiers`'s rule alone. Matches NORMA
     export today, and drops 286 flags the mapper currently honours.
   - **(c)** Keep `is_preferred` in 3.0 alongside the reference. No
     migration judgment, and barwise-971 stays open in the new format.
9. **What names a constraint across fact types in output, once it has no
   host -- open (raised 2026-10-18 by WS3's grounding).** Today several
   functions pass the host fact type with an external constraint and write
   it into what they return (WS3 lists them). The host is the arbitrary
   choice format 3 removes, so each of those outputs needs another answer.
   - **(a)** Recommended. Where an element id is needed, use the
     constraint's own id. Where a name is needed, use the fact types it
     spans, in model order: "Join constraint over fact types A and B".
     `ConstraintRef` replaces `factType` and `factTypeId` with
     `factTypes` and `factTypeIds`, one entry for an internal constraint.
     MCP's query output changes shape with it.

     A diagnostic then points the editor at the constraint's own line
     wherever the file states its id. A 2.0 file that omits ids has no
     such line, so for the six consistency checks that point at the host
     today, the diagnostic falls to line 0 until the next save writes the
     ids. The thirteen join and spanning report sites have already behaved like
     that since WS2, because `c.id ?? ft.id` now always finds an id.
   - **(b)** Compute an anchor: the first fact type holding one of the
     constraint's roles, the same rule the 2.0 save uses. Most output
     keeps its current shape, since 46 of the 72 constraints already sit
     on their anchor. But it keeps the arbitrary host alive in every
     output under a new name, and the anchor moves whenever a role edit
     changes which fact type comes first.

## Risks and testing

- **Determinism of the migration** is the headline test: the same 2.0 input,
  loaded twice, gives deep-equal models with the same ids, and the migrated
  document validates as 3.0.
- **Round trip over the corpus**: every tracked file migrates, serializes,
  reloads and compares equal to the migrated model.
- **Placement is refused, not repaired**, in a 3.0 file: an external kind in a
  fact type, or an internal kind at model level, is an error naming the
  constraint and where it belongs; one test per direction.
- **The type split is held by a type test**: `FactType.addConstraint` rejects
  every external kind at compile time.
- **NORMA**: the existing fixtures round-trip with constraint ids, partition
  constraints and preferred identifiers intact; a fixture with two partitions
  of one supertype is added.
- **Risk: the consumer sweep in WS3 is wide.** A narrowed type alone would
  not bound it: a plain loop such as `for (const c of ft.constraints)` in
  `graph.ts`, `OrmYamlAnnotator.ts`, `query/evaluate.ts` and
  `RelationalMapper.ts` would still compile and silently stop seeing
  external constraints. Removing `FactType.constraints` (WS3) makes every
  reader fail to compile. Each WS3 PR lists every file it moves with its
  group (WS3), and 3c's removal catches any the first two missed.

## Non-goals

- Constraint names, templated or otherwise.
- New constraint kinds (barwise-kw5, barwise-vc3).
- Any change to the LLM extraction format.
