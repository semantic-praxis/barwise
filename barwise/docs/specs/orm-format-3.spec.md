# `.orm.yaml` format 3.0: constraint identity and placement by kind

Status: Draft -- no workstream implemented
Created: 2026-10-16
Last-updated: 2026-10-16
Tracking: barwise-n9n (constraint ids and placement); barwise-loo (one subtype
partition per supertype); barwise-alg (external uniqueness as preferred
identifier); barwise-971 (five rules for "the preferred identifier", Open
decision 8); barwise-hnb (NORMA comparison doc correction)

In one sentence: every constraint gets a required, stable id; a constraint
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
// FactType.constraints: readonly InternalConstraint[]
// OrmModel.constraints: readonly ExternalConstraint[]
// OrmModel.constraintsTouching(factTypeId): readonly Constraint[]
```

A consumer that switches over `factType.constraints` and handles `subset`
stops compiling, because `"subset"` is no longer a member of that union. 52
source files across nine packages read `.constraints` today; the type
split turns each one that needs the model-level list into a compile error
rather than a silent omission.

**The migration (2.0 to 3.0)** is pure, runs on the raw document before
validation like `diagramReferencesToIds.ts`, and registers in
`schemaVersion.ts`:

1. Every constraint without an id gets one derived from its position: a hash
   of the fact type id, the constraint's index in that fact type, and its
   kind. The same unmigrated file always yields the same ids. Open decision 4
   sets the shape.
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
| `core/src/model/FactType.ts`                              | mints missing constraint ids (line 108)           | requires ids; holds internal kinds only                                   |
| `core/src/model/OrmModel.ts`                              | no constraint list                                | `constraints`, `constraintsTouching`                                      |
| `core/src/model/Constraint.ts`                            | one 16-kind union                                 | `InternalConstraint` / `ExternalConstraint`; subtype operands             |
| `core/src/model/SubtypeFact.ts`                           | `isExclusive`, `isExhaustive`                     | removed                                                                   |
| `core/src/model/identification.ts`                        | preferred = internal uniqueness flag              | preferred = the entity's referenced constraint                            |
| `core/src/validation/`, `verbalization/`, `mapping/`      | read external kinds from `ft.constraints`         | read `model.constraints`; compiler-guided                                 |
| `core/src/diff/`, `ModelMerge.ts`                         | match constraints by content key                  | by id where both files state it (3.0); content key otherwise              |
| `core/src/project/splitModel.ts`                          | detects cross-domain constraints under hosts      | reads the model-level list                                                |
| `formats/src/norma/`                                      | drops constraint ids; first-holder host; flags    | keeps ids; places by kind; partition constraints 1:1; preferred both ways |
| `diagram/src/graph/ModelToGraph.ts`                       | constraint nodes `constraint-<index>`             | node id = constraint id                                                   |
| `llm/src/parse/`                                          | attaches constraints to fact types                | places by kind through the model API                                      |
| tracked `.orm.yaml` files (113)                           | 2.0                                               | rewritten as 3.0 by the migration, in WS6                                 |
| `docs/NORMA_VS_ORM_YAML.md`                               | matrix overstates two rows (barwise-hnb)          | corrected in WS6                                                          |
| `docs/adr/`                                               | ADR 0001 "inline and local"                       | ADR 0003 amends it for external constraints                               |

Not in the table because they need no design decision, but in WS3 to WS5's
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
`-- barwise:v1` prefix whose reader already matches any version. WS5 moves
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
- **Keep ids optional and derive a stable id from content when missing.**
  No migration, but an id that changes whenever the constraint is edited is
  not an identity, and two identical constraints collide.
- **Keep the host, and fix only the host rule.** Smallest change; the
  constraint still dies with an arbitrary host, and subtype exclusion still has
  nowhere to live.

## Workstreams (each independently shippable)

**The format changes in one workstream, WS5; everything before it keeps
reading and writing 2.0.** ADR 0001 allows a shared version bump across
several PRs only for additive minor changes; a breaking change bumps the
major version "with a real migration". Bumping to 3.0 in an early workstream
and adding to it later would let any build in between save a file stamped
3.0 that later 3.0 readers refuse, and no migration would ever run on it,
because it already claims the current version. So WS2 to WS4 change the
in-memory model behind the 2.0 file format, and WS5 bumps the version, adds
the one migration and changes the schema and serializer in a single PR.

### 1. ADR 0003 and this spec

ADR 0003 amends ADR 0001's "inline and local" filter: an internal constraint
lives inline on its fact type; an external constraint, which has no single
element to be local to, lives in the model's constraint list and refers to
roles and subtype facts by id. Records the owner's two decisions above.

### 2. Stable ids under 2.0 (provisional: not yet grounded)

The user-visible defect, fixed without a format change: when a 2.0 file
omits a constraint id, the loader derives one with the migration's step 1
rule instead of minting a random one, so the same file always loads to the
same ids. The NORMA importer keeps NORMA's constraint ids. The test that
fails today: loading one 2.0 file twice yields the same constraint ids, and
two NORMA exports of it are byte-identical.

### 3. Placement by kind, in memory (provisional: not yet grounded)

The type split, `OrmModel.constraints`, and every consumer of the old
list. `FactType.constraints` is removed rather than narrowed, and the
internal list gets a new name (`internalConstraints`), so every one of the
52 reading files stops compiling and is decided one by one -- not only the
ones that switch on `type`. Largest radius. The 2.0 serializer keeps the file's nesting: on load
it lifts external kinds into the model list, and on save it writes each one
under the first fact type that holds one of its roles (the NORMA importer's
rule today). External constraints come after a host's internal ones in
every tracked file, so order within a host is kept; but 27 of the 73 sit on
a host other than the first holder (in 18 files), and those move to the
first holder on the next 2.0 save. That churn is accepted rather than
carried as a hidden host field on the model: it touches only files saved
between WS3 and WS5, on unreleased builds, and WS6 rewrites the corpus as
3.0 anyway. Verbalization gains a section for constraints across fact
types (Open decision 7). The diagram's constraint nodes take the
constraint's id.

### 4. Subtype constraints and the preferred identifier, in memory (provisional: not yet grounded)

`exclusion`, `disjunctive_mandatory` and `exclusive_or` accept subtype
facts in place of roles (Open decision 2), with the validation in the
migration's step 3; `ObjectType` gains its preferred-identifier reference
(Open decision 3), read by the mapper and `identification.ts`. The 2.0
serializer converts to and from the flags by steps 3 and 4. A model that 2.0
cannot express -- two partitions of one supertype, or a preferred external
uniqueness -- is refused on save with a message saying format 3.0 is needed;
nothing creates one before WS5, so no user meets it.

### 5. Format 3.0 (provisional: not yet grounded)

One PR: `orm_version` 3.0, the schema (ids required, the two `oneOf`s,
`model.constraints`, `subtype_facts` operands, `preferred_identifier`,
flags removed), the 2.0-to-3.0 migration (steps 1 to 5), the 3.0 serializer,
and NORMA import and export placing by kind and mapping partition
constraints one to one. Closes barwise-loo and barwise-alg.

### 6. Corpus, docs, release notes (provisional: not yet grounded)

The tracked 113 files rewritten by the migration (a script under `scripts/`,
or the CLI command of Open decision 5); `docs/NORMA_VS_ORM_YAML.md` corrected
(barwise-hnb); CLI and format docs; release notes naming the migration. It
can share WS5's PR if the radius allows.

## API and migration impact

- **Every 2.0 file loads unchanged**, migrated in memory, and is written as
  3.0 on its next save. A 2.x build refuses a 3.0 file by version, as the
  schema `const` already makes it.
- **Core's public API changes**: `FactType.constraints` narrows to internal
  kinds, `OrmModel.constraints` is new, `SubtypeFact.isExclusive` and
  `isExhaustive` and `isPreferred` are removed. Downstream packages follow in
  the same workstreams; the full monorepo build gates each.
- **Diff output** names constraints by id where both sides are 3.0 files.
- **Verbalization output** moves external constraints into their own section;
  golden files change in WS3.

## Open decisions (for review)

1. **ADR 0003 amends ADR 0001's "inline and local".** Recommend: yes, as
   WS1 states it -- internal inline, external model-level by reference.
2. **Shape of subtype constraints.**
   - **(a)** Reuse `exclusion`, `disjunctive_mandatory` and `exclusive_or`
     with a `subtype_facts` operand. Recommended: it is NORMA's own
     representation (an exclusion or mandatory constraint over the subtype
     links' supertype roles), adds no kinds, and verbalizes as "each Person
     is at most one of: Male, Female".
   - **(b)** Three dedicated kinds (`subtype_exclusion` and so on). Clearer
     in a switch; three more kinds for every consumer to handle.
3. **Preferred identifier by reference, in 3.0.** Recommend: yes. 3.0 is the
   one breaking bump, required ids are what make the reference possible, and
   it closes barwise-alg. The alternative, `is_preferred` added to
   `external_uniqueness`, keeps a flag the entity cannot see.
4. **Shape of migration-derived ids.** Recommend: a UUIDv8 built from a
   SHA-256 of the inputs, so derived ids look like every other id and a
   collision with an author's id is improbable. Improbable is not
   impossible, so the loader refuses two constraints with the same id in
   one model, whatever their origin; that check, not the id shape, is what
   guarantees uniqueness. The alternative, readable ids such as
   `<fact-type-id>-c0`, is easier to read in a diff and collides with any
   author id spelled the same way.

   **Derived ids are not for matching across revisions.** They come from
   position, so two revisions of an unsaved 2.0 file can give one id to
   different constraints. A model migrated in memory claims 3.0 and cannot
   tell its ids' origin, so the decision is made where the version is
   still visible: core's diff and merge take an explicit option to match
   constraints by id, and the callers that read files (CLI, MCP, the
   editor) set it only when both files were 3.0 on disk. Otherwise they
   keep today's content-key matching.
5. **A `barwise migrate` command.** Recommend: yes, CLI-only, rewriting files
   in place to the current version; it serves the 113 tracked files and every
   user's repository, and gets a deliberate capability-matrix row. The
   alternative is relying on each file's next save.
6. **Order against the Effect adoption.** Recommend: format 3.0 on `main`
   first, with the hand-written serializers. It fixes user-visible defects
   now, and the Effect spike's schemas then describe 3.0 -- which also removes
   that spec's optional-id complication (its WS1b part C).
7. **Verbalizing external constraints.** Recommend: one section for
   constraints across fact types, each verbalized once. The alternative,
   repeating each under every fact type it touches, reads well per fact type
   and states every rule two or more times.
8. **What 2.0's `is_preferred` meant, for the migration's step 4.** Five
   modules answer "which constraint is this entity's preferred identifier"
   with five different rules today (barwise-971), and the corpus does not
   follow any one of them: of the 376 preferred uniquenesses, 286 cover the
   entity's own role in an entity-value binary, 68 cover the value's role in
   one, 12 span every role of an objectified fact type, and 10 sit on
   n-ary fact types (8 with one uncovered entity player, 2 with an uncovered
   value player). `NormaXmlWriter.collectPreferredIdentifiers` -- the rule an
   earlier draft of this spec used -- finds no entity for the 286. Format
   3.0 ends the ambiguity for new files, because the entity names its
   identifier; the migration has to read the old flag once.
   - **(a)** Recommended, in order: an objectified fact type whose
     uniqueness spans every role identifies its objectifying type; a binary
     between one entity and one value type identifies the entity, whichever
     role is covered (the mapper's rule, `preferredIdentifyingBinary`, which
     decides primary keys today, so no table's key moves); otherwise, when
     one entity type plays every uncovered role, that entity. Anything else
     is dropped, as step 4 says. On the corpus this places 374 of the 376
     flags and drops 2 (one ternary, `WonItemHasSoldPriceAtTimestamp`, in
     two copies of the auction model). When two flags land on one entity (4
     entities in the corpus), the first in document order wins and the rest
     are dropped; validation already reports an entity with two identifiers.
   - **(b)** Use `collectPreferredIdentifiers`'s rule alone. Matches NORMA
     export today, and drops 286 flags the mapper currently honours.
   - **(c)** Keep `is_preferred` in 3.0 alongside the reference. No
     migration judgment, and barwise-971 stays open in the new format.

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
  reader fail to compile, and the WS3 PR lists each of the 52 files with its
  decision.

## Non-goals

- Constraint names, templated or otherwise.
- New constraint kinds (barwise-kw5, barwise-vc3).
- Any change to the LLM extraction format.
