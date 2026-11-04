# `.orm.yaml` format 3.0: constraint identity and placement by kind

Status: WS1 implemented 2026-10-23 (the amendment written into the metamodel ADR in place, not as an ADR 0003); WS2 implemented 2026-10-17 (stable constraint ids under 2.0; NORMA
import keeps constraint, fact type, subtype fact and fact instance ids); WS3
grounded 2026-10-18, 3a-i and the verbalization and validation parts of 3a-ii implemented 2026-10-19, and 3a-ii-c (query, describe, counterexamples, graph references and lineage) 2026-10-20, 3a-iii (id-first diff) 2026-10-21, 3b-i (vscode, learn and dbt readers) 2026-10-21, 3b-ii (diagram) 2026-10-21, 3b-iii (formats) 2026-10-21, and 3b-iv (llm) 2026-10-21, which completes 3b; 3c split 2026-10-21, 3c-i (test readers), 3c-ii (storage, diff and merge) and 3c-iii (writers) implemented 2026-10-21, which completes WS3; WS4 grounded 2026-10-21 (4a and 4b; Open decisions 10 and 11 open), 4a implemented 2026-10-21, 4b split into PRs and 4b-i (constraints over subtypes in memory) implemented 2026-10-21, 4b-ii (the stored identifier and format 3.0) 2026-10-21, and 4b-iii (`barwise migrate`) 2026-10-21; WS5 not started; open decisions 1 to 9
resolved by the owner (1 to 8 on 2026-10-17, 9 and the revision of 4 on
2026-10-18)
Created: 2026-10-16
Last-updated: 2026-10-27
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
kind once ADR `metamodel-evolution-policy`'s "inline and local" filter was on the table. Internal
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
// OrmModel.getConstraint(id): Constraint | undefined  (either kind)
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
   id (refined 2026-10-18: by id first and content for the rest, with a
   content-only mode for LLM samples, as Open decision 4's revision says). An id is derived once, at migration, and is stated in the file from
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

| Area                                                      | Today                                               | Verdict                                                                     |
| --------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `core/schemas/orm-model.schema.json`                      | `orm_version` const `2.0`; one constraint `oneOf`   | 3.0; internal and external `oneOf`s; ids required; flags removed            |
| `core/src/serialization/schemaVersion.ts`                 | migrations 1.0 to 1.1 to 2.0                        | adds 2.0 to 3.0                                                             |
| `core/src/serialization/migrations/`                      | `diagramReferencesToIds.ts`                         | adds the 3.0 migration                                                      |
| `core/src/serialization/yaml/constraint.ts`, `subtype.ts` | nested constraints; subtype flags                   | model-level constraints; subtype flags gone                                 |
| `core/src/model/FactType.ts`                              | mints missing constraint ids (line 108)             | fills missing ids (3a); `constraints` removed; `internalConstraints`        |
| `core/src/model/OrmModel.ts`                              | no constraint list                                  | `constraints`, `constraintsTouching`, `getConstraint`; `addConstraint` (3c) |
| `core/src/model/Constraint.ts`                            | one 16-kind union                                   | `InternalConstraint` / `ExternalConstraint`; subtype operands               |
| `core/src/model/SubtypeFact.ts`                           | `isExclusive`, `isExhaustive`                       | removed                                                                     |
| `core/src/model/identification.ts`                        | preferred = internal uniqueness flag                | preferred = the entity's referenced constraint                              |
| `core/src/validation/`, `verbalization/`, `mapping/`      | read external kinds from `ft.constraints`           | read `model.constraints`; compiler-guided                                   |
| `core/src/diff/`, `ModelMerge.ts`                         | match constraints by content key                    | by id first, then content; content-only mode for LLM samples (WS3)          |
| `core/src/project/splitModel.ts`                          | detects cross-domain constraints under hosts        | migrates the raw document to 3.0 before splitting; reads the model list     |
| `formats/src/norma/`                                      | drops constraint ids; first-holder host; flags      | keeps ids; places by kind; partition constraints 1:1; preferred both ways   |
| `diagram/src/graph/ModelToGraph.ts`                       | constraint nodes `constraint-<index>`               | node id = constraint id                                                     |
| `llm/src/parse/`                                          | attaches constraints to fact types                  | places by kind through the model API                                        |
| tracked `.orm.yaml` files (115)                           | 2.0                                                 | rewritten as 3.0 by the migration, in WS5                                   |
| `docs/NORMA_VS_ORM_YAML.md`                               | matrix overstates two rows (barwise-hnb)            | corrected in WS5                                                            |
| `docs/adr/`                                               | ADR `metamodel-evolution-policy` "inline and local" | Amended in place for external constraints (barwise-l5z)                     |

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
`-- barwise:v1` prefix whose reader accepts v1 only (corrected at WS4's grounding: it skips any other version with a warning, and requires both flags). WS4 moves
it to v2, writing the partition constraints, and keeps a v1 reader that
converts the flags with the migration's step 3, so DDL already exported
still imports.

## Alternatives considered

- **Every constraint at model level, as NORMA does.** One rule, closest to
  NORMA. Rejected by the owner once placement by kind was on the table: it
  moves 3,011 internal constraints away from the fact type they describe,
  breaks ADR `metamodel-evolution-policy`'s "inline and local" for every kind, and makes a hand author
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
reading and writing 2.0 without loss.** ADR `schema-versioning` allows a shared version
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
Recorded as `docs/adr/schema-versioning.md`.

### 1. The metamodel ADR and this spec (implemented 2026-10-23)

The owner's 2026-10-17 decision amends ADR `metamodel-evolution-policy`'s
"inline and local" filter, in place rather than as a new "ADR 0003" (the
living-ADR convention, `architecture-index.spec.md`; barwise-l5z): an internal constraint
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
  cardinality without an id gets one derived from its role
  (`cardinalityId`; until WS3a-i the writer shared it for a role cardinality without an id, and since then every constraint has its own; the writer spells an object type's with it too, but that cardinality is a property with no id in the metamodel, so its NORMA id is not kept: barwise-eok), under the same rule. Distinct
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
  subtype partition constraints (SubtypeFact flags until WS4 makes them
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
core, moves core's own readers, and changes each output together with its
consumers, 3b moves the other packages' readers,
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

cli, mcp, promptlab, code-analysis and diagram-ui do not read the getter,
though cli, mcp and vscode read a host through core outputs that change
(below). The draft's 52
files across nine packages was a text search, not a compile. Writes come by two
routes: 12 `addConstraint` calls in four source files (7 in
`llm/src/parse/constraints.ts`, 3 in NORMA's phase 3, and one each in
`dbt/src/dbtMapping/sqlPatterns.ts` and the DDL importer), and a
`constraints` list passed to `addFactType` or the `FactType`
constructor, which is how NORMA's phase 1 and `ModelMerge`'s
`addFactTypeToMerged` (through `toFactTypeConfig`) add external kinds. Tests are
not type-checked (barwise-944), so only a text search can size them:
`.constraints` appears on 373 lines in 54 test files (`git grep -c '\.constraints' -- 'packages/*/tests/**'`
from `barwise/`), a ceiling that also
counts other objects' fields. The 72 and 27 below count through the
loader; the 73 and 28 elsewhere in this spec count the raw YAML of every
tracked file, including one the loader refuses.

**Each read falls into one of three groups, and the group decides the
change.**

- **It reads only internal kinds.** That means a filter on mandatory,
  uniqueness, ring, frequency, value, value comparison or cardinality, or
  a read of `isPreferred`. The read becomes `internalConstraints`, with no
  change in behaviour. Examples: the ring and value population rules,
  `checkUniquenessViolations` (not its neighbour
  `checkExternalUniquenessViolations`, in the next group), `identification.ts`, `NormaXmlWriter.collectPreferredIdentifiers`,
  and dbt's `sqlPatterns.ts`.
- **It reads only external kinds.** These are the spanning, set-comparison,
  join, external-uniqueness and disjunctive-mandatory population rules.
  A file can hold both groups, as `population/uniqueness.ts` does, so the
  group is decided per read, not per file. They read
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
  `joinConstraintRules.ts` and `population/joinPath.ts`; the templates
  themselves, which take a single `ftName`, are in `validation/ruleId.ts`),
  and element ids are the host's (`ft.id`) or fall back to it
  (`c.id ?? ft.id`).
- Verbalization: a constraint's `Verbalization` carries the host's id, and
  its labels for roles in other fact types are worded relative to the host.
  The id is a contract: `ConstraintVerbalizer.ts` keeps every constraint
  row's `sourceElementId` a fact type id so that `barwise verbalize
  --format json` consumers can resolve each row with `getFactType`.
- Query: `ConstraintRef.factType` and `factTypeId`, which MCP's query
  output repeats.
- Describe: summary ids are positional (`${ft.id}-constraint-${i}`), and
  so is query's fallback id. Both shift when a constraint changes host.
- References: `ReferenceSource { kind: "constraint", factType }` in
  `model/graph.ts`, and lineage's `getConstraintName(c, ft)`.
- Counterexamples: `Counterexample.factTypeId`, "the constraint's owner",
  which `barwise verbalize --fact-type` and its JSON projection, MCP's
  verbalize, and the VS Code hover (`HoverProvider.ts`) filter or emit.
- Describe: `affectedFactType: ft.name` on each constraint summary, which
  MCP's `describe_domain` projects field by field.
- Diagram: node ids are `constraint-<index>`.
- Diff: a constraint change sits inside its host's fact type delta.

Open decision 9 (resolved: option (a)) sets what replaces the host: the
constraint's id wherever an element id is needed, and the fact types it
spans, in model order, wherever a name is. Signatures split the same way.
An internal constraint keeps its fact type as context,
`(c: InternalConstraint, ft)`; an external one takes the model,
`(c: ExternalConstraint, model)`.

**Diff and merge match constraints by id first, then by content.** This
revises Open decision 4 (owner, 2026-10-18). A constraint whose id occurs
on both sides is matched by id, and if its content differs that is one
modification rather than a removal and an addition: a new
`constraintsModified` change, beside `constraintsAdded` and
`constraintsRemoved` in `changeDescription.ts`, with its own
`describeChange` text and the `breakingLevel` `caution`, the level
`constraintsAdded` and `constraintsRemoved` already have. A constraint with no id is never matched by id. The constraints left
over are matched by content key, as today. The fallback is what keeps
merging a transcript import working: its ids are fresh, so nothing
matches by id and everything falls through to content. One mode opts out:
`llm/src/sampleAgreement.ts` and `TranscriptProcessor.ts` compare
independent LLM samples, whose ids are unrelated by construction, and ask
for content only, so a coincidental id never pairs two different
constraints. `diffModels` takes the mode as an option, with id-first as
the default, so `barwise diff`, `history`, `merge` and MCP's diff and
merge tools get it unchanged. This delivers barwise-18n in 3a, inside
today's per-fact-type deltas; until 3c an external constraint whose 2.0
host differs between the two sides is still a removal and an addition.

In 3c, when storage moves, external constraints get their own model-level
delta, `elementType: "constraint"`, alongside the six element types
`deltas.ts` already has, with the same four kinds, and `ModelMerge`
applies it in the same PR. Before 3c there is no model list to apply it
to, which is why neither lands earlier. Merge applies an accepted
constraint delta only when every role it names exists in the merged
model, and reports one it skips, so rejecting an added fact type cannot
leave a constraint with dangling roles. The delta also changes what
`sampleAgreement.differenceCount` counts: two samples that disagree on
an external constraint differ by one constraint delta rather than by a
changed fact type, which can move the chosen medoid; 3c's PR measures
this on the promptlab suite and records it. Merge treats an accepted
modification the way it treats every other element: the existing id is
kept and the incoming content is taken. The content key cannot be
today's, because today's is relative to the host: `roleKeys` writes a
host role as its position (`h<i>`) and any other role as its fact
type's name and position. With no host, every role takes that second
form, through the model-wide role holders `elementDiff.ts` already
builds, so the key no longer depends on where 2.0 put the constraint. One
limit carries over unchanged: `operandKey` keys a join operand's path by
raw role ids, so a join constraint never matches by content across
independent LLM samples, today or after.

**The 2.0 serializer keeps the file's nesting.** On load it lifts the
external kinds into the model list. This happens after `withDerivedIds`,
which hashes the host's id, so derived ids do not change. They keep file
order: by host, then by position. On save it writes each one under the
first fact type, in model order, that holds one of its roles, after that
fact type's internal constraints. From the second save on, a save
followed by a load gives back the same order. The first save of a file
with constraints off their first holder can reorder them: X on host C
and Y on host D load as [X, Y], but if Y's first holder is C and X's is
D, the save writes Y under C and X under D, and the reload gives [Y, X].
List order carries no meaning for external constraints, so this is
accepted along with the move itself.

Measured through the loader on the 78 tracked files it accepts:

- 72 external constraints, in 27 files.
- Every one comes after its host's internal constraints.
- 26 sit on a fact type other than their first holder, in 17 files. The
  draft said 27 in 18 from a text search, and the extra one is in a file
  the loader refuses. Those 26 move to their first holder on the next 2.0
  save, with ids kept; their order changes too in one file of the corpus
  (`trial/customers/C02-bank/kernel.orm.yaml`), by the first-save case
  above. That changes where they are written, not
  what they mean: the host in 2.0 is arbitrary by definition. So the move
  is accepted rather than carried as a hidden host field on the model. If
  a release is cut while 2.0 is still current, its notes say that a save
  may move a cross-fact-type constraint to the first fact type it
  references.
- None has no holder. One can still arise, from code or from a lenient
  load of a file whose role references dangle. The 2.0 save refuses such a
  constraint and names it, because 2.0 has nowhere to write it.

**Writers.** In 3c, `OrmModel.addConstraint(c: ExternalConstraint)` arrives,
and `FactType.addConstraint` narrows to `InternalConstraint`, as does
`FactTypeConfig.constraints`, so the constructor and `addFactType`
cannot take an external kind either. NORMA's phase 1
(`resolveConstraintsForFactType` in `mapping/factTypes.ts`) builds
external kinds into that config today; in 3c it adds them through
`model.addConstraint`, and its `holdsSame` check against the fact
type's list moves with them. `FactType.addConstraint` fills a missing
id from the installed generator from 3a, as the constructor already does,
which closes barwise-nkq and makes `NormaXmlWriter`'s positional fallback id
unreachable, so 3a removes it; `OrmModel.addConstraint` does the same from
its arrival in 3c. Duplicate checks compare external kinds
within one host today: NORMA's `holdsSame` in both phases and the LLM parser's
`isDuplicateConstraint`. Pointed at `model.constraints`, they compare
across the whole model, so two identical external constraints that 2.0 put
under different hosts become one. NORMA itself keeps every constraint at
model level, so this matches it.

**The three PRs.**

- **3a, core, and the consumers of what it changes.** Adds `InternalConstraint`, `ExternalConstraint` and
  `isInternalConstraint`; `FactType.internalConstraints`; and
  `OrmModel.constraints`, `constraintsTouching` and `getConstraint`.
  While storage stays on the fact types, the last three are computed from
  them. `FactType.addConstraint` fills a missing id from the installed
  generator (barwise-nkq), so from 3a on every constraint in memory has
  one, and the outputs below never fall back to a host. Core's 29 files
  move, together with the output changes of Open decision 9, id-first
  matching (barwise-18n) and verbalization's section for constraints
  across fact types. Every core output that changes shape changes in this
  one PR together with every consumer that projects or filters it, so no
  surface changes in two releases: the verbalization rows and the CLI's
  JSON projections of them (`cli/src/workspace/format.ts`,
  `cli/src/commands/verbalize.ts`), which list fields explicitly and gain
  `factTypeIds`; `ConstraintRef` and MCP's query output;
  `Counterexample`, with `barwise verbalize --fact-type` and its JSON,
  MCP's verbalize and the VS Code hover; describe's `affectedFactType` and
  MCP's `describe_domain`; and the `ruleId.ts` message templates. The two
  llm callers that compare samples (`sampleAgreement.ts`,
  `TranscriptProcessor.ts`) switch to content-only here as well, since
  id-first becomes the default in this PR. Golden files and query snapshots change here.
- **3b, the other packages.** The remaining readers of the getter in llm,
  formats, diagram, learn, dbt and vscode move. The diagram's constraint
  nodes take the constraint's id.
- **3c, storage.** External constraints are stored on `OrmModel`;
  `FactType.constraints` is removed; the serializer lifts and lowers them;
  the writers call `model.addConstraint`, which fills a missing id as
  `FactType.addConstraint` has since 3a, NORMA's phase 1 and
  `ModelMerge` included, merge with its id remapping; and diff's
  model-level constraint delta lands with merge's handling of it. It also lands the type test that `FactType.addConstraint`
  and `FactTypeConfig.constraints` reject every external kind.

The draft put all of this in one PR. The split costs a little: until 3c,
`OrmModel.constraints` walks the fact types on every read, so a rule that
calls `constraintsTouching` once per fact type does work proportional to
fact types times constraints. On the largest tracked model (121 fact types,
258 constraints) that is about 31,000 steps, which is negligible. What it buys is a
reviewable PR per package, against one PR touching 43 source files, tens
of test files, and every output above. It costs no safety, because 3c's
removal is the compile-time check the draft wanted.

Implementation notes (2026-10-19):

- **3a lands as three PRs, not one.** Measured against the list above, 3a
  still touched every core reader, every changed output with its
  consumers, and id-first diff, which is too much to review in one
  sitting. The cut is by behaviour. **3a-i** adds the API (`PLACEMENT`,
  the two types and guards, `internalConstraints`, `constraints`,
  `constraintsTouching`, `getConstraint`), makes `FactType.addConstraint`
  fill ids (barwise-nkq; the NORMA writer's positional fallback becomes an
  error), and moves the 20 core reads that look only at internal kinds,
  none of which can change any output. **3a-ii** changes the outputs of
  Open decision 9 with their consumers and moves the rest of core's
  readers. **3a-iii** is id-first matching (barwise-18n). Each is green on
  its own.
- **The placement table is the locality table.** `requiresLocalRoles`
  already classified the sixteen kinds the same way, in a total record,
  so 3a-i turned that record into `PLACEMENT` and derived both rules and
  both types from it, rather than adding a second classification.
- **Filling ids moved committed fixtures.** Six core tests built an
  id-less constraint through `addConstraint` to reach a host fallback;
  each now asserts that the output names the filled id instead. The ten
  promptlab reference models gained constraint ids, and the counter-drawn
  ids after them were renumbered (`npm run regen:references`).
- **Downstream internal-only readers stay for 3b**, as planned, even where
  the change is one word: dbt's `sqlPatterns.ts`, llm's `ModelContext.ts`,
  and NORMA's writer and population graph.
- **3a-ii lands one output family at a time**, each with every consumer
  that reads it: verbalization first, then validation diagnostics, then
  query, describe, counterexamples, lineage and graph references.
  Grounding 3a-ii found four families, each with its own consumers in
  cli, mcp and vscode, which is the same width problem as 3a.
- **Verbalization (3a-ii-a, 2026-10-19).**
  - `ConstraintVerbalizer.verbalize` ignores the fact type it is handed
    for a constraint across fact types and calls the new
    `verbalizeExternal(c, model)`. The external verbalizers take no host:
    `resolveCommonPlayer` resolves roles model-wide.
  - A subset or equality names each role's fact type unless all its
    resolved roles share one. Across fact types, both sides are now
    qualified: "If Appointment in Appointment has FollowUpNote then
    Appointment in Appointment has AppointmentStatus", where the host
    reading was "If Appointment then Appointment in ...". The DDL
    export's comment for an inexpressible constraint changes with it.
  - The new `section` category is the heading row, following the "Open
    questions" precedent. It comes after object cardinality and before
    subtypes. `formatVerbalizations` indents the rows under it, and the
    VS Code verbalize command prints it as a heading.
  - `verbalizeAll` and `verbalizeFactType` read `constraintsTouching`.
    The CLI's three JSON projections share one `verbalizationRow`, so
    `factTypeIds` cannot reach one form and miss another.
  - An object type's cardinality row keeps category `constraint` and
    names its object type, with `factTypeIds: []`: it is a property of the
    object type, not a constraint in a list (barwise-eok).
  - `isStatement` (core verbalization) tells a reading from the section
    heading: the VS Code count, the diagram tab's numbered list, MCP's
    summary and the gym's `requires_verbalization` use it.
  - `constraintsTouching` is the one per-fact-type view: `verbalizeAll`
    and `counterexamplesTouching` both ask it by the fact type's id, so
    they cannot disagree. Before this cut `verbalizeAll` read the fact
    type's own nested list, so it also answered a fact type the model did
    not hold. That case was carried for two review rounds and dropped: no
    surface asks it, and each way of answering it was wrong somewhere (role
    ids from another model's id space attached unrelated constraints, a
    twin listed a nested one twice, the nested list alone left out
    constraints nested elsewhere, and resolving against the model it was
    handed mixed two models' names in one row). `verbalizeAll` and
    `counterexamplesTouching` now take an id, like `constraintsTouching`,
    and a fact type the model does not have gets no constraints (a
    counterexample with no constraint id still matches by its fact type id).
  - `resolveCommonPlayer` takes the first role that resolves anywhere, not
    the first in the host. For an exclusion or disjunctive mandatory whose
    roles have different players -- malformed, since those kinds constrain
    one player -- the sentence's subject can change. `requiresLocalRoles`
    is gone; `isInternalConstraint` is the same question.
  - `--fact-type` and MCP's per-fact-type verbalize pick counterexamples
    with the new `counterexamplesTouching`, so they match the constraints
    the view now says. `Counterexample.factTypeId` itself is the later
    counterexample cut.
  - The section lists constraints in model-list order, which in 2.0 is
    file order (host, then position). A constraint's own sentence and row
    no longer depend on its host; their order in the list still follows
    the file, as every list does.
- **Validation diagnostics (3a-ii-b, 2026-10-19).**
  - Every rule that read an external constraint through a fact type's list
    now reads `model.constraints`: `constraintConsistency` (split into an
    internal pass per fact type and one external pass), the join structural
    and population rules, the four spanning set-comparison rules, the four
    local set-comparison rules, and the external uniqueness and disjunctive
    mandatory population rules. A diagnostic about one is located by
    `constraintElementId` (its id; a missing id throws, since loading and
    construction both fill one) and names its span with `constraintSpan`:
    `Subset constraint over fact types "A" and "B" ...`. Seventeen message
    templates changed from `in fact type "<host>"` to `over <span>`.
  - "Local" means every role in one fact type, whichever it is
    (`localFactType`), not every role in the host. Three behaviours change
    with it. An external uniqueness whose roles all sit in a fact type
    other than its host now draws `external-uniqueness-all-local`; before,
    the host-relative check missed it. And both completeness gates read
    `constraintsTouching`: a fact type touched only by a constraint nested
    in another one no longer draws `fact-type-without-constraints`, and,
    being constrained, a binary one now draws
    `fact-type-without-uniqueness` if it has no internal uniqueness;
    the host of a constraint that touches none of its roles is no longer
    counted as constrained by it.
  - `localFactTypeOf` answers "all local" for an external uniqueness, by
    its roles rather than its host. (While local population rules existed,
    they asked it too; the first cut asked "every role is in this fact
    type", which an empty role list passes for every population.) An
    external uniqueness with no roles keeps its all-local warning, now with
    its own message.
  - **Exclusion and exclusive-or are checked across the population,
    always -- decided by the owner 2026-10-19.** The per-instance rules for
    them are gone, and the cross-population rules take their names
    (`checkExclusionViolations`, `checkExclusiveOrViolations`, formerly
    `checkSpanning...`) and every constraint of the two kinds, local or not. The
    per-instance reading missed an object playing both excluded roles in
    different instances, and flagged every instance of an exclusive-or over
    a fact type that fills both roles -- every instance of a binary. Before
    this cut the host decided which reading a constraint got. Each kind is
    left with one message, now `default`. The two halves of exclusive-or
    read different sets: "plays more than one" is present data and counts
    sample populations, "plays none" reads the universe, which leaves them
    out. Subset and equality followed the next
    day, by the same decision (barwise-h2a): the local per-population rules
    padded an unfilled role with an empty value and reported it, and
    reported a tuple whose match sat in another population of the same fact
    type -- two false violations -- so
    `checkSubsetViolations` and `checkEqualityViolations` now take every
    one, `setComparison.ts` is gone, and their messages are `default` and
    `reverse`. A local one's diagnostic now points at the constraint rather
    than the population, and names the tuple rather than the instance: in an
    id-less 2.0 file it falls to line 0, the trade Open decision 9 accepted.
    The counterexample generator still treats them as local and out of
    scope; that is barwise-0od, with 3a-ii-c. No tracked model changes: all 27 set-comparison
    constraints in the 113 tracked files span fact types.
  - An id-less 2.0 file places these diagnostics at line 0 where they
    used to sit on the host's line: the trade Open decision 9 accepted,
    until the next save writes the ids.
  - `referenceDiagnostics` takes the model, so the two join messages it
    renders (`joinUnknownRoot`, `joinBadStep`) name the span too. Its other
    constraint branch -- a dangling role on a non-join kind, reported
    against the host with the internal kinds' templates -- moves with the
    graph references in 3a-ii-c.
  - `externalUniquenessViolationsFor` and `disjunctiveMandatoryViolationsFor`
    no longer take a fact type. `evaluateConstraintEnforcement` keeps its
    signature; its fact type now only matters for the internal kinds.
  - The editor needed no change: its source map indexes every mapping with
    an `id`, so a constraint's diagnostic lands on the constraint's own
    line. A 2.0 file that omits the id still falls to line 0.
- **3a-ii-c lands as four PRs, one family each:** query, describe,
  counterexamples (with barwise-0od), then graph references and lineage.
- **Query (3a-ii-c, 2026-10-20).**
  - `ConstraintRef.factType` and `factTypeId` become `factTypes` and
    `factTypeIds`, the fact types the constraint applies to in model order
    (one entry for an internal constraint). The id is the constraint's own;
    the positional fallback `${ft.id}-constraint-${i}` is gone.
  - Both come from the constraint's verbalization row, which has carried
    the id and `factTypeIds` since 3a-ii-a, so query and verbalize cannot
    disagree about which fact types a constraint spans.
  - `list-constraints` says each fact type's own constraints, then each
    constraint across fact types once. `fact-type`, `entity` and
    `constraints-of` say every constraint touching the fact types in view,
    once even when it spans two of them. Before, an entity whose two fact
    types a key spanned listed it under whichever one nested it, and the
    other fact type's view did not list it at all.
  - "Every constraint touching these fact types, once" is
    `OrmModel.constraintsTouchingAny`, beside `constraintsTouching`, which
    is now its one fact type case. Query reads it here and reads
    `model.constraints` once per view rather than once per fact type;
    describe, the next PR, reads the same walk. Each entry is a
    `ConstraintInView`: an internal constraint with its fact type, one
    across fact types with none, so the walk cannot hand a reader a host.
  - Order changed in two ways a positional consumer can see. Within a fact
    type, its own constraints now come first and those across fact types
    after, where the nested list interleaved them. And the constraints
    across fact types follow their position in a 2.0 file, so moving one
    to another fact type in the file reorders them. For constraints whose
    ids the file states, the set each view says does not change.
  - A constraint whose id a 2.0 file omits is the exception. WS2 derives
    its id from the fact type it is nested under, its content, and its
    place among identical constraints there, so a move changes its id and
    can renumber identical id-less constraints in the fact types it left
    and joined. Saving the file states the ids, which ends this for that
    file.
  - The CLI (`barwise query --json`) and MCP (`query_model`) print the
    result as it is, so their output changes shape with it and neither
    needed code. `mcp/tests/tools/queryModel.test.ts` pins the ids and the
    span of a constraint across fact types at the MCP surface.
- **Describe (3a-ii-c, 2026-10-20).**
  - `ConstraintSummary.affectedFactType` becomes `factTypes` and
    `factTypeIds`, and the positional id `${ft.id}-constraint-${i}` becomes
    the constraint's own, both from the verbalization row as in query.
    Query and describe now share every piece that decides what a view
    says: `OrmModel.everyConstraint` for the whole model,
    `constraintsTouchingAny` for some fact types, and
    `ConstraintVerbalizer.reportInView` for the id, sentence and span. Each
    adds only its own name for the kind (`type`, `constraintType`). An
    entity view selects its fact types with `factTypesForObjectType` in
    both, and lists those, not every fact type its constraints span: a
    constraint across fact types can name one the view does not describe.
  - The whole model says each fact type's own constraints, then each
    constraint across fact types once; an entity or fact type focus says
    every constraint touching it, once. `FactTypeSummary.constraintCount`
    counts the same set, so a fact type a key spans counts it whichever
    fact type nests it.
  - A constraint-type focus brings in every fact type a matching
    constraint spans, in model order, and tags each line of its summary
    with all of them (`[A, B] ...`); before, it brought in only the host.
  - MCP's `describe_domain` projects field by field, so its
    `affectedFactType` became `factTypes` there; `barwise describe --json`
    prints the description as it is. The projection now also carries the
    constraint's `id` and `factTypeIds`, since the id is stable now, and
    each fact type's `id`, so the two can be joined;
    `mcp/tests/tools/describeDomain.test.ts` pins them, the span and the
    count at the MCP surface.
  - `FactTypeSummary.constraintCount` costs a `constraintsTouching` call
    per fact type, which rebuilds `model.constraints` each time, as
    validation's completeness rules already do. WS3c stores that list,
    which removes the rebuild for every such reader at once.
- **Counterexamples (3a-ii-c, 2026-10-20).**
  - `Counterexample.factTypeId`, "the constraint's owner", becomes
    `factTypeIds`: the fact types the constraint applies to, in model
    order. `generateCounterexamples` reads `everyConstraint`, so the whole
    model lists each fact type's own constraints first, then each
    constraint across fact types once, as query and describe do.
  - The generators for constraints across fact types no longer take a
    fact type. `generateCounterexampleForConstraint(c, ft, model)` keeps its
    signature for its callers in formats and learn (3b), and does not hand
    `ft` on for those kinds, as `ConstraintVerbalizer.verbalize` ignores it.
  - `counterexamplesTouching(factTypeId, counterexamples)` filters on
    `factTypeIds`, the same set `constraintsTouching` reads, and lost its
    `model` parameter. The CLI's JSON row (`barwise verbalize
    --counterexamples`) projects `factTypeIds`; the VS Code hover shows a
    counterexample on every player of a fact type its constraint touches.
  - A subset or equality whose two role sequences sit in one fact type now
    gets a witness, one fact whose two sides read different tuples
    (barwise-0od), since validation checks those across the population
    too (barwise-h2a). The generator tries a few minted values on each
    side, so a value constraint that makes the first choice collide does
    not lose the witness; sequences that share only some roles, or reorder
    the same roles (the symmetric pair a1, a2 against a2, a1), get one.
    Only the same roles in the same order, or domains leaving one choice,
    get none. A subset or equality side whose roles sit in several fact
    types: on the absent side no fact holds them all, so validation finds
    no absent tuple and one present fact is the witness; on the present
    side no one fact can be written, so a subset has none, rather than a
    crash, and an equality tries its other side. Sides of different
    lengths are an arity mismatch validation reports itself, and get none.
    The local search compares tuples with validation's own
    `makeCompositeKey`, so the two agree on what matches.
  - Naming is `OrmModel.factTypesNaming(inView)`: an internal constraint by
    the fact type it lives in, as `constraintsTouching` lists it, even when
    a stale role id leaves its roles naming nothing; one across fact types
    by the fact types holding its roles (`factTypesOf`). Verbalization rows
    and counterexamples both read it, so they cannot name one constraint
    differently. Validation messages read `factTypesOf` directly, since
    they report what the roles say.
- **Graph references and lineage (3a-ii-c, 2026-10-20).**
  - `graphOf` walks `everyConstraint`, so a constraint's `ReferenceSource`
    carries the fact type it lives in, and none (`factType: undefined`)
    for one across fact types.
  - `referenceDiagnostics`' last host-relative branch moved: a role no fact
    type has, on a constraint across fact types, is the new
    `constraint/across-fact-types-unknown-role`, reported against the constraint's own id
    and naming its span ("Exclusion constraint over fact type ... references
    role id ..."), or, when none of its roles resolve, without a span
    ("Exclusion constraint references role id ..., which no fact type in
    the model has; none of its roles resolve"). It used to borrow the internal kinds' templates, which
    named the nesting fact type and the wrong kind ("Internal uniqueness
    constraint in fact type ..." for an exclusion). An internal
    constraint's dangling role keeps its per-kind template and its fact
    type.
  - Lineage looks a foreign key's constraint up with the new
    `OrmModel.getConstraintInView(id)` and traces it to every fact type
    `factTypesNaming` gives. RelationalMapper sets that id to an internal
    uniqueness (or a subtype fact or fact type) today, so a composite key
    tracing to both fact types it spans is the placement-correct reading
    rather than one an export reaches yet.
  - An entity's lineage lists the constraints touching its fact types
    once each, from one `constraintsTouchingAny` call, after the fact
    types, roles and players. `getConstraintName` names every kind by its span,
    including the four (disjunctive mandatory, exclusive-or, subset,
    equality) that had a bare label, so two subsets on one entity no longer
    read the same ("Subset: A and B"). One none of whose roles
    resolve reads as its label alone; that one touches no fact type, so no
    entity lists it. Validation reports one naming a role no fact type
    has. One with no roles at all, buildable only in code, is reported
    for every kind but subset and equality, which have no role-count
    rule; that gap is not this workstream's.
  - `ReferenceSource`'s constraint arm pairs an internal constraint with
    its fact type and one across fact types with none in the type, so
    `referenceDiagnostics` needs no assertion to read either.
- **Id-first diff (3a-iii, 2026-10-21).**
  - `diffModels(existing, incoming, { constraintMatching })` takes
    `"id-first"` (the default) or `"content"`; `diffFactType` passes it
    to `diffConstraints`. `barwise diff`, `history`, `merge`, the
    transcript imports and MCP's diff and merge tools take the default
    unchanged.
  - Id-first pairs a constraint whose id occurs exactly once in each
    model, within a fact type matched by name. A pair whose content key
    differs is one `constraintsModified` change carrying both versions (rendered "constraints modified:
    <kinds>", "<old> to <new>" for a kind that changed; breaking level
    `caution`). The rest pair by content key, as before, and a pair held
    out by id never also matches by content. An id given twice anywhere in
    a model pairs nothing and falls through to content (barwise-b2s),
    rather than pairing one copy arbitrarily; uniqueness is decided per
    model, not per fact type. Two constraints that swap ids read as two
    modifications, since under id-first the id is the constraint's
    identity.
  - A derived id is identity only as far as its derivation is stable. One
    edge pairs unrelated constraints: a file states id D on a constraint
    later edited, an id-less constraint whose content derives D steps to
    another id while D is taken, and deleting the first hands D to the
    second. That needs a stated id equal to another constraint's
    derivation; it is not handled in 3a.
  - A pair joined by id is compared with a key that reads each role both
    models hold, once each, by its id as well as its position (its host
    position, or its holder's name and position there); the content pass
    keeps the positional key alone. By position alone, a constraint moved
    onto the role that took the old position kept its key; the pair's id
    makes its roles' ids evidence, so it reads them. Position stays
    because readings address roles by it: two roles of a ring can share a
    player and a name, so a reorder under one reading changes what the
    constraint says while every per-role comparison agrees. A plain role
    swap therefore reads as a modification of the constraints on those
    roles, which is true of what they say. No fact type id is in the key,
    so a fact type that changed only its id changes nothing, which is
    what a merge leaves behind (an accepted fact type keeps the existing
    id); a renamed holder is a different fact type to a diff that matches
    by name, so it reads as a change. The content pass does not read
    role ids, because there a role id is as coincidental as a constraint
    id. The key's sorting and default folding hold in both, so a
    reordered role list or `isPreferred: false` written out reads as no
    change.
  - A value constraint's content key now reads its ranges as well as its
    values, JSON-quoted. It read values alone, so a range-only edit was
    invisible in either mode (the role-level counterpart of barwise-934),
    and joined them with commas, so `["a,b"]` keyed like `["a", "b"]`.
  - Transcript imports keep the default safely: extraction fills ids
    through `addConstraint`, which mints random UUIDs under the default
    generator, so an import never shares an id with its base by accident
    and falls through to content. A deterministic generator breaks that:
    promptlab's `withDeterministicIds` mints reference-model ids from a
    counter, so diffing two such references pairs constraints by mint
    order. Nothing in the repository diffs two of them; a person running
    `barwise diff` on them should pass content mode, which the CLI does
    not yet expose (barwise-uy7).
  - `sampleAgreement.ts` (the medoid fold and each sample's diff) and
    `TranscriptProcessor.ts` (an alternative framing's diff) pass
    `"content"`, through one shared `UNRELATED_IDS_DIFF`. The modes usually agree
    on whether a fact type changed, so the fold's count rarely moves, but
    not always: two constraints of equal content collapse under content
    keys, so dropping one of them is a change by id and none by content.
    A spy test pins both call sites; core's tests pin what each mode
    pairs.
  - Merge needed no change in 3a: it takes a modified fact type whole from
    the chosen side, constraints included. A constraint whose 2.0 host
    differs between the sides is still a removal and an addition until
    3c's model-level delta.

- **3b lands one package group at a time (2026-10-21).** A probe that
  renamed the getter and type-checked every package (then reverted) found
  14 files outside core: llm 4, formats 4, diagram 2, learn 2, dbt 1,
  vscode 1. 3b-i takes the three smallest, vscode, learn and dbt; diagram,
  formats and llm follow, one PR each.
- **vscode, learn and dbt (3b-i, 2026-10-21).**
  - The sidebar's model tree lists `constraintsTouchingAny([ft.id])`,
    pairs with their fact type, under each fact type, so a composite key shows under both fact types it spans and not
    under one it is only nested in. A constraint none of whose roles
    resolve, which no fact type lists, goes under a new "Unattached
    Constraints" category, described by the role ids it names, rather
    than vanishing. Core's new `constraintsTouchingNone()` is that set; it
    and `constraintsTouchingAny` read one `holdsAny` test, which
    `factTypesHolding` reads too.
  - Core: `evaluateConstraintEnforcement(model, inView)` takes the
    `ConstraintInView` pair instead of a fact type and a constraint, and
    `generateCounterexampleInView` is exported beside
    `generateCounterexampleForConstraint`. Both callers here held a
    constraint across fact types and had to invent a fact type the check
    never read; now they pass what `constraintsTouchingAny` and
    `getConstraintInView` return.
  - The gym's `forbids_population` reads `constraintsTouchingAny` over its
    carriers, each constraint once, so a candidate's external
    uniqueness or disjunctive mandatory counts wherever its file nests it;
    before, one nested under a fact type outside the carriers was missed.
    This also widens a known weakness: a disjunctive mandatory (for the
    mandatory kind) or an external uniqueness (for the uniqueness kind)
    touching a carrier counts whatever else it spans, as one nested under
    it did before (barwise-ra1).
    The reference side reads `internalConstraints`, which is every kind
    the check accepts.
  - The tutorial renderer finds a motivation's constraint with
    `getConstraintInView` and hands the pair to
    `generateCounterexampleInView`; its "already in the prior step" check
    is `getConstraint`, by id alone.
  - dbt's three SQL-pattern checks read `internalConstraints`: each asks
    about an internal kind only.

- **Diagram (3b-ii, 2026-10-21).**
  - A constraint node takes its constraint's own id, where a counter
    numbered them `constraint-0`, `constraint-1` in walk order, so a
    selection, a view or a diff names the same node however the file
    orders its constraints. Node ids are decided once from the whole
    model, so a constraint has the same node id in every view and whether
    or not a view draws it: a constraint keeps its own id when no other
    constraint and no element of the model holds it, and otherwise (a
    second constraint's copy, barwise-b2s, or an element's id) gets the
    first `#2`, `#3` free of every reserved id, the unique stated ones
    included. An id-less constraint, which construction rules out, is
    numbered. Which of two same-id constraints is suffixed follows file
    order. Internal constraint ids are not reserved: a badge has no node
    id, and reserving them would rename a node whenever an internal
    constraint with its id was added. Nor are the ids of kinds never drawn
    (those `NOT_DRAWN` lists), so an undrawn constraint cannot push a suffix onto a
    drawn one.
  - `modelToGraph` walks `model.constraints` and draws a constraint when
    it touches a fact type that got a node, with edges to drawn fact
    types only. One touching only absorbed fact types, only fact types a
    neighbourhood view leaves out, or none at all is not drawn. It used
    to skip any constraint nested under an absorbed fact type, whatever
    it spanned, and to draw the rest whatever the view, including
    floating nodes and edges to fact types with no node.
  - `NOT_DRAWN` is total over every kind that is not drawn, internal
    kinds included, so the barwise-869 compile check still covers kinds
    the constraint-node walk no longer sees.
  - The four per-fact-type badge reads (uniqueness, mandatory, frequency,
    ring) read `internalConstraints`.
  - The webview's model summary calls `constraintsTouching` per fact
    type, the core authority, so its tree badge and inspector agree with
    the sidebar. Its order changes with it: the fact type's own
    constraints first, then those across fact types, where it was file
    order under the nesting fact type.
  - A ghost preview that widens a view's filter can now bring in a
    constraint, which renders solid beside its dimmed fact type: ghost
    ids name elements, not constraint nodes (barwise-ejs). Before, every
    constraint was drawn solid in every view. A
    constraint touching no fact type is in no list; the sidebar shows it
    and the webview has no place for it yet (barwise-f2r).

- **Formats (3b-iii, 2026-10-21).**
  - DDL routing walks `everyConstraint`. A constraint across fact types
    that spills goes to the table of the first fact type it spans, in
    model order, that has one, where it went to the table nearest the
    fact type nesting it; its `ConstraintSpec` verbalization and
    counterexample come from `reportInView` and
    `generateCounterexampleInView`, and the pseudocode and the
    verbalization's fallback name the fact types it spans. Clause and
    spill order change with the walk: a table's clauses from constraints
    across fact types now follow those from fact types' own. One whose
    roles resolve to nothing spills with no table, where it took its
    host's. An external uniqueness that cannot be one UNIQUE clause still spills
    beside its first resolved column; one with no column at all spills
    "the roles map to no column" to the nearest table. A key missing a
    column says "a role maps to no column" (with "more than one table"
    too when its columns span tables), where it used to read only "more
    than one table".
  - The NORMA writer writes each fact type's own constraints from
    `internalConstraints`, and those across fact types once each from
    `model.constraints`, after every fact type's. The serializer groups
    constraints by element type, so only groups holding both placements
    change order: an external uniqueness now follows every internal one,
    and a disjunctive mandatory every simple one, where each sat after
    its host's. Where an internal and an external constraint share an id
    (barwise-b2s), the writer keeps the internal one, as every fact
    type's own are written first; file order used to decide.
    `populationGraph`, the preferred-identifier map and the role's
    mandatory and cardinality reads take `internalConstraints`.
  - NORMA import's phase 3 keeps a constraint across fact types only when
    no constraint anywhere in the model says the same thing; it used to
    check only the fact type phase 3 attaches it to, so a copy phase 1
    had attached to another fact type was kept twice. `holdsSame` now
    compares kinds before content, since the check covers the model. A
    copy dropped this way loses its NORMA id, as one dropped within a fact
    type always has. Phase 1 still
    deduplicates within one fact type, which the "listed in two fact
    types" id test pins.

- **llm (3b-iv, 2026-10-21).**
  - The review prompt's constraint summary and the extraction log's
    built count read `everyConstraint`, and `ModelContext`'s
    identifier test reads `internalConstraints`; each counts or tests
    the same constraints as before.
  - The draft parser's duplicate check reads the fact type's
    `internalConstraints` for a constraint of one fact type, and
    `model.constraints` for one across fact types. Exclusion,
    exclusive-or, disjunctive mandatory and external uniqueness resolve
    every role within the fact type the extraction names, so a copy
    elsewhere comes only from a model that already nests one there; an
    equality spans two, and the same equality stated from each fact type
    is a duplicate a single draft reaches, so its check is now symmetric.
  - With this, no source outside core reads `FactType.constraints`: a
    probe that renamed the getter in core's emitted declarations and
    type-checked the other eleven packages found no read (2026-10-21).
    Core's own readers are 3c's.

Implementation notes (2026-10-21, WS3c):

- **3c lands as two PRs.** The same probe, run with each
  package's tests included, found 273 test reads of the getter in 45
  files (core 88 in 21, formats 148 in 14, llm 21 in 3, dbt 12 in 5,
  cli 4 in 2), beside 9 source reads in 5 core files. The draft said
  removing the getter makes the compiler name every reader; that holds
  for source only: the packages' `tsconfig` files exclude `tests/` and
  vitest strips types, so a test read would surface as a runtime
  failure at best. **3c-i** moves the test readers to the APIs that
  survive the move (`internalConstraints`, `model.constraints`,
  `constraintsTouching`, `everyConstraint`) with no source change,
  keeping only the tests whose subject is the getter or 2.0 nesting.
  **3c-ii** is the storage move as listed above, with the serializer,
  the writers, diff's constraint delta and merge, which cannot be
  separated: once a fact type no longer holds its external
  constraints, diff's per-fact-type deltas no longer see them.

Implementation notes (2026-10-21, WS3c-ii):

- **3c-ii, storage.**
  - `OrmModel` stores the constraints across fact types, in the order
    added, and `OrmModel.addConstraint` fills a missing id.
    `FactType` holds only its own; `FactType.constraints` is gone.
  - The writers did not move in this PR. A runtime probe (a fact type
    throwing on any external kind) failed about 380 tests across ten
    packages, the 2.0 loader among them, so moving every writer to
    `OrmModel.addConstraint` at once would bury the storage change.
    Instead a fact type built by `OrmModel.addFactType` hands an external
    constraint to the model, from its config or from
    `FactType.addConstraint`, and one built on its own refuses one.
    That forward is what keeps the 2.0 loader working unchanged: it adds
    fact types after `withDerivedIds`, so derived ids do not move, and
    the constraints keep file order. **3c-iii** moves the writers to
    `OrmModel.addConstraint`, narrows `FactType.addConstraint` and
    `FactTypeConfig.constraints` to the internal kinds, removes the
    forward, and lands the type test.
  - `removeFactType` drops a constraint across fact types every role of
    which was in the removed fact type. One that also spans another stays,
    its roles there dangling, so validation reports it; before, one went
    when nested there whatever else it spanned, and one nested elsewhere
    stayed. A merge differs on purpose: there the removal is a reviewed
    decision, and a constraint left dangling would fail the merged model,
    so it is left out, as above.
  - The 2.0 save writes each under the first fact type, in model order,
    holding one of its roles, after that fact type's own constraints. One
    none of whose roles is in a fact type goes under the first fact type:
    the draft said the save refuses it, but a lenient load reads one and
    merge carries one through, so a refusal would fail the save of every
    model holding one, `barwise import transcript` and MCP's merge
    included. Only a model with no fact type refuses, naming the id.
    A model whose file nests one off its first holder, or lists one
    before its host's own, therefore saves to different text unchanged,
    once, and `hashModel` (lineage) reads that as a model change: an
    export recorded before the upgrade reads stale until re-exported.
    `factTypeLayout.test.ts` changed order only: its fixture interleaved
    the two kinds in one list. One promptlab reference
    (`vendor-onboarding`) moved one subset to its first holder.
  - Diff: `ConstraintDelta`, `elementType: "constraint"`, carrying the fact types it spans and
    named by its kind and its roles ("fact type (role)", in its own order),
    with the four kinds: by fact types alone, two exclusions over the same
    two fact types read alike in the review panel. Pairing is by
    id, then by content keyed with no host (every role by its fact type's
    name and position), taken one to one, so a second identical copy reads
    as added or removed where a fact type's list compares keys as a set.
    Added and removed read `caution`, as `constraintsAdded` and
    `constraintsRemoved` on a fact type did; a fact type's delta now
    compares its own constraints only. A constraint whose 2.0 host
    differs between the sides is now unchanged.
  - Merge applies the delta after fact types. An existing constraint's
    roles go through the remap for fact types that took the incoming
    roles, an incoming one's through the remap for fact types that kept
    the existing roles. One naming a role the merge itself took (a
    rejected fact type addition, an accepted removal) is left out
    silently, as a population depending on it is; the draft said merge
    reports one it skips, and it does not, because that population
    precedent already covers the case and the reviewer made the
    decision. One naming a role neither model held is carried through, so
    validation reports it. An accepted modification whose incoming version
    needs a fact type the merge left out keeps the existing version.
  - `getConstraintInView` with an id given twice (barwise-b2s) finds a
    fact type's own constraint before the model's, where file order
    decided; the two are stored apart.
  - Sample agreement: measured with `npm run measure:sample-medoids`
    against an llm build of the base commit and of this change, over the
    192 recorded payloads of the 10 eval cases, each case's samples
    being every recorded run of it across arms, models and dates. No
    case's medoid or
    disagreement count moved. The disagreement report still covers
    object types and fact types only, so a disagreement on a constraint
    across fact types is counted toward the medoid but not reported
    (barwise-avb).

Implementation notes (2026-10-21, WS3c-iii):

- **3c-iii, writers.**
  - `FactType.addConstraint` and `FactTypeConfig.constraints` take the
    internal kinds only, and the forward from 3c-ii is gone. A fact type
    still refuses an external kind at run time, naming
    `OrmModel.addConstraint`: the type is asserted, not checked, for a
    parsed value, and one stored there would be read by nothing that
    reads the model's constraints. The type test is
    `tests/types/constraintPlacement.test-d.ts`, which also pins
    `OrmModel.addConstraint` to the external kinds.
  - Source writers, found by the narrowed types: the 2.0 loader, NORMA
    phases 1 and 3, the DDL importer's composite unique, and the llm
    parser's external branches now call `OrmModel.addConstraint`. dbt
    and the OpenAPI importer build internal kinds only and were retyped.
    `ModelMerge` already used `model.addConstraint` from 3c-ii, which the
    draft did not foresee.
  - The 2.0 loader is the one place both kinds still meet under a fact
    type. It derives ids under the nesting fact type, as before, then
    gives the fact type its own and adds the external ones to the model
    after every fact type, in file order. `model.constraints` reads in
    the same order as under the forward, and no derived id moves.
  - Test writers: 52 files across seven packages. Tests whose point was
    "whichever fact type nests it" built the same model on every pass
    once a model built in code has no host, so they now save, nest the
    constraint under each host in the file, and load: a core test helper
    (`tests/helpers/nestedUnder.ts`) and one small copy each in formats,
    learn and vscode, and a hand-written document in diagram, which has no
    `yaml` dependency. Validation's fixture cannot go through a file,
    because the schema refuses the malformed constraints it exists to
    hold, so its passes vary only the order of addition. A planted loader
    defect that keeps only the first fact type's nested constraints
    fails 15 of the reworked tests.

### 4. Format 3.0 (grounded 2026-10-21)

**WS4 is two PRs: 4a changes only how the preferred identifier is read,
and 4b changes what is stored and the file format** (Open decision 10).
The draft kept WS4 in one PR so that no build between PRs could save a 2.0
file that loses what memory holds. 4a stores nothing new: it computes
today's answer from today's flags, so a 2.0 file loads and saves exactly as it does now; what
changes is what the nine readers answer, and so what their outputs say.
Everything that changes storage stays in 4b, as drafted.

Grounding first tried a different split, with the reference and the
subtype constraints stored in memory ahead of the format and written back
to 2.0 flags. Code review of that draft showed it loses content both ways
between PRs:

- **Some 2.0 content has no in-memory home.** Two flagged identifiers for
  one entity (decision 8 keeps the first), the four flags the rule cannot
  place, and a one-member exclusive group are all dropped by the first
  save.
- **Some in-memory states have no 2.0 syntax.** A merge or an MCP edit can
  build two exclusions on one supertype; written back as flags, they read
  as one exclusion over all four subtypes, which means something else.
- **Write-back moves flags.** The reference names the value's role's
  uniqueness, where 286 of the 376 corpus flags sit on the entity's role,
  so every save would rewrite them.

A load, save, load law would have passed on every one of those cases,
because it compares models after the first load.

**4a. One answer to "which constraint identifies this entity"** (Open
decision 8; its own PR). Closes barwise-971.

- `model/identification.ts` gains one model-wide answer: decision 8's
  rule applied once to today's flags, giving a map from each entity to its
  identifying uniqueness and the inverse, from a uniqueness to the entity
  it identifies. Readers that ask per fact type or per constraint use the
  inverse rather than calling a per-entity function in a loop, which would
  make each of them quadratic. Every reader that asks which constraint
  identifies an entity reads it. Grounding found nine such readers, not
  the five barwise-971 lists, each with its own rule:
  - the query anchors (`query/evaluate.ts`);
  - the population renderer (`export/populationRenderer.ts`);
  - the annotator (`annotation/OrmYamlAnnotator.ts`);
  - `identificationSources` and, through it, `completenessWarnings`;
  - `preferredIdentifyingBinary`, which sets the mapper's key type;
  - `absorbedReferenceModes` (diagram, NORMA diagrams and export);
  - NORMA's `findIdentifyingSeat` and `collectPreferredIdentifiers`;
  - llm's `ModelContext`.
- Two conventions meet here, and decision 8's rule exists because of
  them. The importers (dbt, DDL, OpenAPI) and NORMA export's synthesized
  expansion (`populationGraph.ts`) flag the uniqueness on the value's
  role. The extraction prompt, and `Constraint.ts`'s own doc comment, flag
  the entity's role. A query anchor therefore finds no identifier on an
  imported model, and NORMA export finds none on an extracted one.
- `completeness/multiple-preferred-identifiers` keeps counting every flag.
  Decision 8's rule resolves two flagged identifiers to one, so a check
  that read only the resolved answer could never fire, and the release
  notes' advice to validate with a 2.x build before upgrading would find
  nothing. `identificationSources` therefore lists every flag, as today,
  and only the readers that need one answer use the resolved map.
- Two readers describe a constraint as an identifier and move with the
  entity side, or the outputs contradict themselves: NORMA export's
  `writeConstraint` writes `IsPreferred` from the inverse map, so it marks
  the uniqueness `PreferredIdentifier` names, and the VS Code badge marks
  the same one. `RelationalMapper.associativeKey` and diff's constraint
  key describe the stored flag and keep reading it until 4b.
- Decision 8 says no table's key moves, but its "first in document order"
  tie-break can move one: an objectified type with a flagged spanning
  uniqueness that also has its own flagged reference binary is named by
  both flags, and when the fact type comes first the mapper loses the
  reference binary it keys on today. Open decision 11 settles which wins.
- **Acceptance:** before and after, over every tracked model, capture each
  of the nine readers' outputs: `barwise validate`, the relational
  mapping, query anchors, the population renderer, the annotator's
  comments, diagram and NORMA diagram shapes, NORMA export (including the
  synthesized expansions `findIdentifyingSeat` builds and the
  `IsPreferred` attributes), the VS Code badge, and `ModelContext`'s
  prompt text. Every change is listed in the PR, because converging nine
  rules changes some of them by design. How a model loads and saves does
  not change.

**4b. The 3.0 format, with what only it can store** (one PR, in commits
that each keep the suite green). Closes barwise-loo and barwise-alg.

- **The preferred identifier, stored** (Open decision 3).
  - `EntityType` gains `preferredIdentifierId`. 4a's function returns it,
    so the nine readers do not change again.
  - Every writer sets it through the model API: the three importers, NORMA
    import (from `PreferredIdentifier`, which it parses and discards
    today, an external uniqueness included) and the llm parser, which
    translates the extraction's `is_preferred` with decision 8's rule, as
    Scope says.
  - The llm parser's duplicate check drops a preferred duplicate of an
    unflagged uniqueness together with its flag, although its comment
    says it promotes it. With the reference stored on the entity, the
    parser sets the reference to the existing uniqueness instead, so
    the entity keeps its identifier and no constraint has to be replaced.
  - `associativeKey` and diff's constraint key read whether a constraint
    is some entity's reference. Diff drops the flag from its constraint key
    and reports a changed identifier once, as a change to the entity,
    rated breaking where the key moves.
  - `ModelMerge` remaps the reference with the constraint ids, and leaves
    it out when its constraint is left out. Two sides naming different
    identifiers for one entity are one entity modification for the
    reviewer to accept or reject, not two references.
- **Subtype constraints** (Open decision 2, option a).
  - `exclusion`, `disjunctive_mandatory` and `exclusive_or` take either
    `roleIds` or `subtypeFactIds`. Fourteen files read those kinds'
    `roleIds` directly, and the compiler finds them once `roleIds` is
    optional on those three kinds.
  - Nine more read them through `roleIdsOf`: `OrmModel`, `ModelDiff`,
    `ModelMerge`, `graph`, `splitModel`, `referenceDiagnostics`, `span`,
    `ConstraintVerbalizer` and the VS Code tree. Its body,
    `[...c.roleIds]`, stops compiling. The easy repair, `c.roleIds ?? []`,
    would make a subtype constraint touch nothing in all nine with no
    error. So `roleIdsOf` stays for role operands, a sibling returns the
    subtype facts, and each caller decides which it needs.
  - `SubtypeFact.isExclusive` and `isExhaustive` are removed. Their
    readers move to the constraints: diff, with its `subtypeExclusive` and
    `subtypeExhaustive` change kinds and their breaking levels; NORMA
    export; the DDL annotation writer; the VS Code tree; and
    `toSubtypeFactConfig`, which `ModelMerge` copies subtype facts with.
    Their writers create constraints instead: the DDL importer, NORMA
    import (`mapping/subtypes.ts`) and the llm parser
    (`parse/subtypes.ts`).
  - `OrmModel`'s removals cascade: `removeSubtypeFact` drops a subtype
    constraint whose operand it was, as `removeFactType` drops a
    constraint every role of which was in it, and `removeFactType` and
    `removeObjectType` clear an entity's `preferredIdentifierId` when its
    constraint goes. Without that, an MCP or VS Code edit leaves a model
    that fails to load after its next save.
  - The corpus has 14 flagged groups, none mixed: six become an
    `exclusive_or` and eight an `exclusion` (counted by supertype over
    every tracked file).
  - Nothing reads the flags for meaning today: no validation rule, no
    mapper code and no verbalization. 4b adds verbalization ("each Person
    is at most one of: Male, Female") and the counts step 3 gives
    validation: one subtype fact or more in `disjunctive_mandatory`, two
    or more in `exclusion` and `exclusive_or`.
  - Tests pin that verbalization, validation, diff, merge, split and the
    removals above each see a subtype constraint.
- **The schema**: `orm_version` const `"3.0"`, constraint ids required, an
  internal `oneOf` under fact types and an external one in a new
  `model.constraints`, the `subtype_facts` operand, `preferred_identifier`
  on entity types, and the flags removed. `OrmYamlDocument` follows.
- **The migration**, a pure step on the raw document registered in
  `schemaVersion.ts` after 1.1 to 2.0. Steps 1 to 5 run as listed under
  Target architecture. Step 1 reuses `derivedId.ts` (`withDerivedIds`), so
  a migrated file's ids are the ids WS2 already gives it on load.
- **The 3.0 serializer.** A load refuses a constraint in the wrong place
  and a duplicate id, naming the constraint. `lowerConstraints` goes.
- **NORMA and the DDL annotation.**
  - NORMA maps partition constraints one to one, and reads and writes
    `PreferredIdentifier` both ways.
  - The DDL annotation moves to v2. Its reader matches only v1 today,
    skipping any other version with a warning and requiring both flags to
    be booleans. So v2 needs a reader change as well as a writer, and the
    v1 reader converts the flags with step 3.
- **Raw-document readers.**
  - `splitModel` works on the raw document. It migrates first, then
    distributes `model.constraints` as it distributes fact types' own: a
    constraint goes to the domain holding every role and subtype fact it
    names, and one spanning domains is dropped with the warning the
    fact-type loop gives today. A `preferred_identifier` naming a dropped
    constraint is dropped with a warning too.
  - The annotator's section reset list learns `constraints`.
  - Scripts that read the flags on raw YAML: `trial/lib/model.mjs` and
    `trial/lib/generators/norma.mjs` pick keys by `is_preferred`, and
    `scripts/measure-comparison.mjs` builds 2.0 documents with
    `is_exclusive`. Nothing compiles them against the schema, so each is
    moved to 3.0 here, before WS5 rewrites the corpus they read.
  - `hashModel` hashes the serialized model, so it changes for every file
    once, at load. Lineage manifests recorded before 3.0 read stale until
    re-exported, and the release notes say so.
- **Validating before upgrading.** A 3.0 build migrates a 2.0 file on
  load, and decision 8's rule resolves an entity with two identifiers
  before any rule can report it. The release notes therefore tell users
  to run `barwise validate` with their current 2.x build before
  upgrading, not after.
- `barwise migrate` (Open decision 5) with its capability-matrix row.
- **Acceptance:** the risks below, with the corpus rewritten in WS5.

Implementation notes (2026-10-21, WS4a):

- **The rule.** `preferredIdentifiers(model)` in `model/identification.ts`
  returns the map from each entity to its identifying uniqueness, the
  inverse, and every flag naming each entity before the tie-break
  (`candidates`), computed once. Every reader listed above uses it, and
  `preferredIdentifyingBinary` is its answer when that is an entity-value
  binary. `identificationSources` reads the candidates, so
  `completeness/multiple-preferred-identifiers` still fires on two flags
  naming one entity, and fires before the missing-identifier check, but
  no longer on a flag that names someone else; tests pin both.
  `isIdentified` is the one answer to whether an entity has an identifier,
  read by validation, the anchors, the annotator and NORMA export.
- **Two guards the rule needs.** A flag leaving more than one role
  uncovered identifies nothing, and a ring binary does not identify its
  player by itself: the one uncovered role's player must play none of the
  covered roles. And in an entity-value binary whose flagged uniqueness is
  itself on the value's role, that one is the identifier, not another
  uniqueness listed before it on the same role.
- **Decision 8, refined.** A flagged uniqueness on an objectified fact type
  identifies the objectifying type when it spans every role or all but
  one. Decision 8 named only the spanning case. The auction models' four
  objectified ternaries, each in two copies, are identified by a two-role
  uniqueness, as NORMA allows. Read literally, decision 8 handed those
  eight flags to the third role's player, an entity that has its own
  reference binary, and `preferredIdentifiers` then dropped them. Decision
  11 is implemented as recommended (the reference binary wins a tie).
- **The corpus.** Of the 376 flags in tracked models, 374 identify an
  entity. The two dropped are `order-management`'s "Customer has Name", in
  both copies: the flag is on Customer's role, and no uniqueness covers the
  name's.
- **What changed**, over the 88 tracked models that load, before and after,
  capturing each reader's output:
  - validation, in 6 models: 27 `multiple-preferred-identifiers`
    warnings go, every one counting a flag that identifies another entity,
    and 9 `info` missing-identifier notes arrive. Two of the nine are
    `order-management`'s Customer; seven are auction-domain entities
    defined in another domain, whose only flag here sat on a neighbouring
    ternary and identified something else. No entity in the corpus now has
    two candidate identifiers: decision 8's four, to be fixed by hand in
    WS5, were the literal reading handing the objectified ternaries' flags
    to role players with their own binary, so WS5 has none to fix;
  - DDL: 2 models, the two `order-management` copies, where Customer's
    key moves from `name` to its reference mode's `customer_id`;
  - query anchors and annotator TODOs: 26 models each, through one
    answer to "is this entity identified" (`isIdentified`): an identifying
    uniqueness, an objectification, or an identifying subtype. 155
    entities stop reading as unidentified -- objectified and subtype
    entities, and those the importers' convention hid (`shop`, the
    payments domain) -- and the nine above start;
  - diagram folding and `ModelContext`: the two `order-management` copies;
  - NORMA export: 31 models. 310 more `PreferredIdentifier` links, 30
    fewer synthesized reference-scheme expansions, because the real
    identifying binary is now found, and `IsPreferred` on the linked
    uniqueness;
  - population examples: no model changed.
- **Test fixtures.** `ModelBuilder`'s `uniqueness: "both"` now honours
  `isPreferred`, and the fixtures that flagged role1 of an entity-value
  binary with no uniqueness on the value's role use it: that shape
  identifies nothing. The model arbitrary adds the value role's
  uniqueness when it draws a preferred identifier, which moves the
  counterexample stray ratchet from 135 to 141 (six new internal
  uniqueness counterexamples, all tripping rules already listed).
- **promptlab.** The suite goes to 2.13.0: one recorded payload of 115,
  `sonnet5-3-train/order-management-run4`, loses a false two-identifier
  warning and rises 0.807143 to 0.832143.
- barwise-jir records a NORMA export limitation this work exposed and did
  not cause: an entity identified other than by a value binary has its
  instances seated on a synthesized expansion.
- barwise-pm7: a flag that identifies nobody is dropped without a
  diagnostic naming it. The entity still gets the missing-identifier note
  when nothing else identifies it.

Implementation notes (2026-10-21, WS4b-i, subtype constraints in memory):

- **4b lands as more than one PR.** The draft planned one PR in commits
  that each keep the suite green. The first commit alone touches 45 files
  across five packages and keeps 2.0 on disk unchanged, so it ships as
  4b-i; the stored `preferredIdentifierId` and schema 3.0 follow as their
  own PRs, each green.

- **The operand.** `RoleOrSubtypeOperand` makes `exclusion`,
  `disjunctive_mandatory` and `exclusive_or` take `roleIds` or
  `subtypeFactIds`, exactly one. `roleIdsOf` returns no roles for one over
  subtypes, `subtypeFactIdsOf` returns its subtype facts, and each of the
  nine `roleIdsOf` callers decides which it needs.
- **Step 3 has one home, and the 2.0 format keeps the flags.**
  `serialization/subtypeFlags.ts` converts flags to constraints
  (`subtypeConstraintsFromFlags`) and back (`subtypeFlagsFromConstraints`)
  over plain records. The 2.0 loader and writer and the DDL annotation v1
  reader and writer call it, so a 2.0 file and a DDL export write exactly
  what they wrote before. Commit 3's migration reuses the same function.
- **NORMA maps partitions one to one now, not in a later PR.** Each NORMA
  exclusion or non-simple mandatory over supertype meta-roles imports as
  one constraint over the subtype facts, with its modality and NORMA's id;
  an exclusion and a mandatory over the same subtypes are one
  exclusive-or. Export writes each constraint over its own subtype facts.
  Code review found that going through the flags, in either direction,
  merged two exclusions over one supertype into a wider one, dropped
  modality, and wrote a partition over every subtype of a supertype. The
  draft placed this in the later PR; it moved here because the flag path
  was wrong, not only lossy. No tracked model has a partial group, so no
  export moves. A disjunctive mandatory over one subtype is not written,
  because NORMA reads a mandatory over one role as a simple one
  (barwise-yx8).
- **`removeSubtypeFact` keeps what still holds, rather than mirroring
  `removeFactType`.** The draft said it should drop a constraint "whose
  operand it was", as `removeFactType` drops one every role of which was
  in it, leaving a constraint that names others dangling. A dangling
  subtype fact id would make a model fail to load after its next save, so
  the removed id leaves every constraint naming it, and each keeps only
  what is still true without it: an exclusion narrows; an exclusive-or
  keeps its exclusion half over the rest; a disjunctive mandatory goes,
  because "each Person is at least one of Male, Female" without Male is
  not "each Person is a Female". An exclusion left over one subtype goes
  too. A first version narrowed every kind, which made a disjunctive
  mandatory or exclusive-or stronger than the modeller stated; code review
  caught it. `withoutSubtypeFacts` in `model/Constraint.ts` holds the rule,
  and the merge reads it too, so a subtype fact the merge leaves out
  leaves the same constraint a removal by hand does.
- **The 2.0 writer is lossy beyond the draft's two cases**, for models
  built in code or by a merge mixing two sides: modality, a stated id, and
  an exclusive-or beside a disjunctive mandatory over other subtypes,
  which reloads weaker. `subtypeFlagsFromConstraints` lists every case;
  the 3.0 serializer ends them.
- **Validation** adds three rules: too few subtypes (one for a
  disjunctive mandatory, two for the other kinds), subtype facts of more
  than one supertype, and a subtype fact id the model does not have. The
  last is reported from the model graph, as a dangling role is.
- **Readers.** Diff labels a subtype constraint's operands as the
  relationships they state ("Male is a Person"), and its
  `subtypeExclusive` and `subtypeExhaustive` change kinds are gone: the
  change is a constraint delta now. Merge adds subtype constraints after
  subtype facts, mapping each id to the merged subtype fact with the same
  subtype and supertype, and drops one whose subtype facts were not
  accepted. `constraintsTouchingNone` leaves them out unless none of their
  subtype facts resolve, so the VS Code tree lists only a dangling one as
  unattached; its subtype rows still say
  "exclusive" and "exhaustive", read from the constraints. DDL routing
  leaves them to the annotation, as it left the flags. The diagram does
  not draw them, as it never drew the flags (barwise-yeq). Lineage lists
  each as a source of its supertype and the subtypes it names.
- **The llm parser writes no flags.** The draft listed
  `llm/src/parse/subtypes.ts` among the flags' writers; it never set them.
  Its constraint dedupe now compares subtype operands as well as roles.

Implementation notes (2026-10-21, WS4b-ii, the stored identifier and format 3.0):

- **The reference and the format ship together.** WS4b-i's note planned
  the stored reference and schema 3.0 as separate PRs. They cannot be:
  a stored reference saved to 2.0 has to become a flag again, and the
  2.0 flag cannot say which of a binary's two uniquenesses it means, so
  the 286 entity-role flags of decision 8 would move to the value role on
  the first save. One PR keeps every save lossless.
- **The reference lives on the model, not on the object type.**
  `OrmModel.preferredIdentifierOf`, `setPreferredIdentifier` and
  `preferredIdentifierRefs` hold a map from entity to constraint id; the
  draft's `ObjectType.preferredIdentifierId` would have needed the object
  type to learn about constraints, and every removal path to reach into
  object types. `removeObjectType`, `removeFactType` (its own
  constraints) and `removeConstraint` clear a reference to what they
  remove. `setPreferredIdentifier` refuses a value type and does not look
  the constraint up, so a merge or a lenient load can carry a reference
  validation then reports.
- **One rule, split in two.** `identifiedBy` is decision 8 for one
  constraint. The 2.0 reader and the llm parser place flags with it
  (`placePreferredFlags`, `storePreferredFlags`); every reader checks a
  stored reference against it (`resolvePreferredIdentifier`), so
  `preferredIdentifiers` reads only the references and has no candidates.
  `completeness/multiple-preferred-identifiers` is gone, because a stored
  reference cannot name two identifiers; `completeness/preferred-identifier-invalid`
  (an error) reports a reference that dangles, names something other than
  an internal uniqueness, or names one that identifies another entity.
  The release notes tell users to validate 2.0 files with their 2.x build
  first, as the draft said.
- **The migration reads the model, not the raw document.** A 2.0 file is
  checked against the 2.0 schema, frozen as
  `schemas/orm-model-2.0.schema.json`, and read by `readDocument20`: ids
  derived (step 1), constraints placed by kind (step 2), subtype flags to
  constraints (step 3), flags to references after objectifications
  (step 4). Saving writes 3.0. Files below 2.0 migrate to 2.0 first, as
  before. The draft's "pure step on the raw document" would have
  restated, on YAML, the placement rules the model already enforces.
- **A flag stays in the content an id is derived from.** Measurement
  caught this: without it, the 271 flagged uniquenesses of id-less 2.0
  files derived new ids, and their NORMA export ids moved. The reader
  hashes the constraint with the flag, as earlier releases did, and drops
  it once the id is fixed.
- **What did not move, over the tracked corpus.** Every reader of the
  identifier (88 loadable models), DDL and NORMA export (80), and all 115
  promptlab payload scores are identical before and after. Each model's
  old 2.0 save and its new 3.0 save load to the same model; one
  (`C02-bank`) lists `model.constraints` in a different order, because
  its 2.0 save nested an external uniqueness under a later fact type.
  The promptlab reference models are regenerated as 3.0, and
  `order-management` gains no reference: its flag on "Customer has Name"
  identifies nothing, as WS4a recorded, and the llm parser now warns when
  it drops one.
- **Writers that set an identifier set the reference**: the dbt and DDL
  importers' key, the OpenAPI importer's id property, NORMA's
  `PreferredIdentifier` (its `IsPreferred` flags when the reference names
  no internal uniqueness), the llm parser, and every package's
  `ModelBuilder`.
- **Deferred, each with an issue.** The DDL annotation stays v1 and keeps
  writing flags through `subtypeFlags.ts` (barwise-n9n.q21). The
  raw scripts (`trial/lib/`, `scripts/measure-comparison.mjs`,
  `scripts/lib/malformed-score.mjs`) still build 2.0 documents, which load
  unchanged, and move with the corpus in WS5 (barwise-n9n.psp). `barwise migrate` (decision
  5, barwise-n9n.a6d) is its own PR next, because reporting the flags a file loses needs
  the 2.0 reader to return them. An external uniqueness as an identifier
  (barwise-alg) was not stored here; `external-preferred-identifier.spec.md`
  stores it.
- **Code review found three places the flag had been doing a second job.**
  Merge kept a reference only when the merged model held its id, but a
  merged fact type can hold the other side's copy of the uniqueness, so a
  transcript merged into its base lost every identifier; the merge now
  follows the reference to the uniqueness over the same roles. NORMA
  import read a flagged and an unflagged uniqueness over the same roles as
  duplicates once the flag left the constraint, and could drop the one
  `PreferredIdentifier` names; the dedupe still tells them apart. And
  diff named an identifier's roles by role name, so a rename read as a
  breaking change; it names them by position and player now.
- **What the 2.0 reader drops, it drops silently.** Two flags naming one
  entity resolve to one (decision 8 accepted this, and the corpus has
  none), and a flag that identifies nothing is dropped. The model cannot
  carry either, so no validation rule can see them after the load;
  `barwise migrate` (barwise-n9n.a6d) is where they are reported.
- **The schema's two constraint lists are a copy of `PLACEMENT`**, so
  `tests/serialization/format30.test.ts` checks them against it.

### 4b-iii. `barwise migrate` (grounded 2026-10-21)

Open decision 5 asked for the command; WS4b-ii left it for its own PR,
because what a 2.0 file loses on load is known only inside the 2.0
reader. The command rewrites files; the reader stays the migration.

- **Core.** `OrmYamlSerializer.migrate(yaml)` returns the model, the
  version the file stated, and what the 2.0 reader could not carry: each
  `is_preferred` flag that identifies no entity, and each entity whose
  flags named more than one identifier, with the one kept. Both come from
  `placePreferredFlags`, which `readDocument20` already calls and whose
  `dropped` and `candidates` it discarded. `deserialize` is `migrate`'s
  model, so the two cannot disagree. Nothing new is read: a 3.0 file
  reports nothing, and a file below 2.0 reports what its 2.0 form loses.
- **CLI.** `barwise migrate <files...>`:
  - When a named file states a version below 3.0, the command shall
    rewrite it in place as 3.0 and print the version it came from and
    every note the reader returned.
  - When a file already states 3.0, the command shall leave it untouched
    and say so.
  - When `--check` is given, the command shall write nothing, and exit 1
    if any file would be rewritten.
  - When a file cannot be read or does not load, its 3.0 form would not
    load back, or it names elements it does not define and carries
    `is_preferred` flags (whom a flag identifies can turn on what is
    missing, a player or an objectification, so none is placed from a
    fragment), the command shall report it, write nothing to it, go on
    with the rest, and exit 2: the gate contract's "could not answer",
    which `--check`'s 1 must not be confused with.
  - `--format json` prints one record per file.
  - It loads leniently, as `barwise validate` does: a fragment naming an
    element it does not define is rewritten with the reference intact, for
    validation to report. Run over the 115 tracked files with `--check`, 78
    would migrate, 10 are current, and the 27 refused are the deliberately
    malformed fixtures under `core/tests/fixtures/malformed/`; the one note
    is `order-management`'s dropped flag that WS4a recorded.
- **Surfaces.** CLI only, a deliberate capability-matrix row: it rewrites
  files, and MCP and VS Code already write 3.0 on the next save of a file
  they edit. It is the one CLI command that modifies its inputs, and the
  row says so beside `merge`'s.
- **Acceptance:** command tests through `runCli` for each requirement
  above, a core test that the notes name the flags `placePreferredFlags`
  drops, and a `docs/CLI.md` entry.

### 5. Corpus, docs, release notes (provisional: not yet grounded)

The tracked 115 files (113 when drafted) rewritten by the migration (a script under `scripts/`,
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
- **Diff and merge** match constraints by id first and by content for the
  rest; an id match with changed content is a modification. External
  constraints get their own model-level delta (WS3).
- **Verbalization output** moves external constraints into their own section;
  golden files change in WS3.

## Open decisions (1 to 9 resolved: 1 to 8 on 2026-10-17; 9, and a revision of 4, on 2026-10-18; 10 to 12 open)

1. **ADR 0003 amends ADR `metamodel-evolution-policy`'s "inline and local" -- resolved 2026-10-17 by the owner: yes,
   as recommended.** Recommend: yes, as
   WS1 states it -- internal inline, external model-level by reference.
   Recorded 2026-10-23 as an in-place edit of that ADR, not a new ADR 0003
   (barwise-l5z).
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
   2.0 file give the same constraint the same id. (Superseded 2026-10-18,
   by the revision below: diff and merge do not match by id alone, and an
   edited constraint whose id is unchanged is one modification.)

   Revised 2026-10-18 by the owner, after WS3's grounding found that diff
   also compares models whose ids are unrelated by construction
   (independent LLM samples, a transcript import against its base):
   matching by id stays the general case, and matching by content is the
   fallback and a specialization for LLM samples. Diff and merge match a constraint by id where the
   id occurs on both sides, and by content for the rest, so an edited
   constraint whose id is unchanged is one modification and an import with
   fresh ids still matches by content. Comparing independent LLM samples
   asks for content only (WS3). This delivers barwise-18n.
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
   with five different rules today (barwise-971; WS4's grounding counts nine), and the corpus does not
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
   host -- resolved 2026-10-18 by the owner: option (a), with `factTypeIds`
   on every constraint row (below).** Raised by WS3's grounding. Today several
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
     ids. The sixteen other sites that report an external constraint as
     `c.id ?? ft.id` (thirteen join and spanning reports, the external
     uniqueness and disjunctive mandatory population rules, and the
     constraint branch of `referenceDiagnostics.ts`) have already behaved
     like that since WS2 for a model loaded from a file, where they always
     find an id. A model built in code still fell back to the host at the
     time of writing (the LLM parser's subset and equality constraints,
     and the DDL importer's external uniqueness); 3a fills those ids
     (barwise-nkq), so those models change at these sites too.

     Verbalization rows are the one place (a) changes a stated contract.
     The owner confirmed this shape on a Room, Building and RoomNumber
     model: every constraint row's `sourceElementId` becomes its
     constraint id, resolvable with a new `model.getConstraint(id)`, and
     every constraint row gains `factTypeIds`, the fact types it applies
     to (one entry for an internal constraint). A consumer then has one
     rule for every constraint row instead of one per kind:

     ```json
     {
       "category": "constraint",
       "text": "The combination of Building and RoomNumber is unique across fact types.",
       "sourceElementId": "c-room-key",
       "factTypeIds": ["ft-in", "ft-nr"]
     }
     ```

     The text output lists such a constraint once, under a "Constraints
     across fact types" heading after the fact types; `--fact-type`
     shows it under each fact type it touches. The sentence's wording is a
     separate defect (barwise-irx).
   - **(b)** Compute an anchor: the first fact type holding one of the
     constraint's roles, the same rule the 2.0 save uses. Most output
     keeps its current shape, since 46 of the 72 constraints already sit
     on their anchor. But it keeps the arbitrary host alive in every
     output under a new name, and the anchor moves whenever a role edit
     changes which fact type comes first.

10. **Land 4a ahead of the format -- open; recommended: yes.** Raised by
    WS4's grounding (2026-10-21). The draft planned WS4 as one PR.
    - **(a)** Recommended. 4a, the nine readers converging on one rule over
      today's flags, as its own PR first, then 4b with every storage and
      format change, as drafted. 4a stores nothing new, so the draft's
      reason for one PR (no 2.0 save may lose what memory holds) does not
      reach it. It ships diagnostic and key changes ahead of the format
      change, and each is listed in its PR. Proceeding on (a) in the
      owner's absence, because it keeps the draft's guarantee.
    - **(b)** One PR, as drafted. One release carries every change a user
      sees, and 4b grows by 4a's nine readers.
    - **(c)** Considered and rejected at grounding: storing the reference
      and the subtype constraints in memory ahead of the format, written
      back to 2.0 flags. It loses content both ways (WS4).

11. **Which identifier wins when two flags name one entity -- open;
    recommended: the reference binary.** Raised by WS4's grounding
    (2026-10-21). Decision 8 resolves two flagged identifiers for one
    entity by document order, and also promises that no table's key
    moves. The two disagree for an objectified type that has its own
    flagged reference binary, when the objectified fact type comes first.
    - **(a)** Recommended. A flagged entity-value binary outranks a
      flagged spanning uniqueness, then document order breaks the rest.
      No key moves, as decision 8 intends, and an objectified type with
      a reference scheme keeps it.
    - **(b)** Document order alone, as decision 8 reads literally. Simple
      to state, and the acceptance list in 4a shows each key that moves.

    Implemented as (a) in 4a, with the objectification refinement its
    implementation notes record.

12. **Which additions ship in 3.0 -- open; recommended: the three below, as
    a gate on releasing 3.0.** Raised by the corpus comment audit
    (2026-10-22). Format 3.0 is merged (semantic-praxis/barwise#708) and in no
    release: `v1.7.0` and `edge` both predate it. Three specs add optional
    fields to the format: `constraint-notes.spec.md` (a `note` on every
    constraint), `model-open-questions.spec.md` (`model.open_questions`) and
    `subject-areas.spec.md` (`model.subject_areas` and a `subject_area` on
    object types and fact types).
    - **(a)** Recommended. Each addition whose first workstream lands before
      3.0 is released is part of 3.0; the release waits for none of them. A
      file written by any 3.0 build is then readable by every later 3.0
      build, and no 3.0-to-3.1 step exists for fields that never shipped
      without them.
    - **(b)** Release 3.0 as merged, and add all three in 3.1, which the
      loader reads with no migration step (each field is optional).
    - **(c)** Hold the 3.0 release until all three land.

    Whichever is chosen, an addition that misses the 3.0 release is 3.1, and
    that spec says so in its Status line.

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
