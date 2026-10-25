# Apache Ossie ontology import and export

Status: Implemented -- WS1 (import) and WS2 (export and round trip)

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-pf2.1
Plan-reviewed: 9a7009d1 (code-review, pr-review)
Touches: +barwise/packages/formats/src/ossie/,
barwise/packages/formats/src/registration.ts,
+barwise/packages/formats/src/constraintSpec.ts,
barwise/packages/formats/src/ddl/constraintRouting.ts,
barwise/packages/formats/src/index.ts,
barwise/packages/formats/tests/,
barwise/packages/formats/CLAUDE.md,
barwise/packages/formats/package.json,
barwise/packages/cli/tests/importerIds.test.ts,
barwise/packages/vscode/package.json,
barwise/docs/CLI.md

barwise reads and writes Apache Ossie ontology documents through one
`ossie` format descriptor in `@barwise/formats`, mapping each Ossie
construct to the barwise element that already means the same thing and
reporting, rather than dropping, every construct it cannot carry.

Apache Ossie is the standard the tracker calls OSI: the Open Semantic
Interchange project was renamed and moved to the Apache incubator
(`apache/ossie`). It has two layers. Its **core** specification describes a
BI semantic layer -- datasets, fields, metrics -- and its **ontology**
specification describes a conceptual model in ORM terms: entity and value
types, relationships with roles and verbalizations, preferred identifiers,
subtyping, and derivation and constraint expressions. This spec covers the
ontology layer only, which is the one that overlaps barwise's metamodel;
the core layer and the mapping documents that bind the two are out of scope
(Scope, below).

Both Ossie specifications are at `0.2.0.dev0`, unreleased, and say of
themselves that the schema is mutable and not for production. Everything
below is pinned to commit `01a5488d840deda309aac68cc0b312c195369b8d` of the
Ossie repository (2026-10-24), which carries `ontology/ontology.md`,
`ontology/ontology.json` and `examples/flights.ontology.yaml` (Open decision
2).

## Principle

**Composability.** `@barwise/formats` already registers DDL, OpenAPI,
Avro, NORMA and SQL through the `FormatDescriptor` registry, and every
surface -- `barwise import` and `export`, the MCP `import_model` and
`export_model` tools, the editor -- reaches a registered format without
code of its own. An Ossie descriptor is one more registration, and the
three surfaces gain it at once; nothing in core changes, because core ships
no interop format.

**Explicit over implicit.** An Ossie ontology carries things barwise cannot
hold today: arbitrary `requires` and `derived_by` expressions in Ossie's
expression language, IRIs, namespace prefixes. The importer's
`ImportResult.warnings` names each one it could not carry, and the
exporter's `ExportResult.constraintSpecs` names each barwise constraint Ossie
cannot express. A round trip that loses something says what it lost.

## Should the adapter live in core, as the tracker says? (resolved: no, in `@barwise/formats`)

The tracker issue asks for the descriptor and its tests in
`packages/core`. Since it was filed, every interop format moved out of
core ("core ships no interop format at all", root `CLAUDE.md`), and
`@barwise/formats` is where a text-based, dependency-free interop format
lives. The Ossie adapter needs only `yaml`, which `@barwise/formats`
already depends on.

## Scope

In scope:

- When `barwise import model <file> --format ossie` (or `import_model`
  with `format: ossie`, or the editor's `#barwiseImportModel`) reads an
  Ossie ontology document at version `0.2.0.dev0`, the system shall
  produce a model in which:
  - the ontology's `name` is the model's name unless the caller names the
    model -- and the CLI always does, its `--name` defaulting to the file
    name, as for every format -- and its `description` is the model's
    note;
  - each `EntityType` concept is an entity object type, and each
    `ValueType` concept a value type whose data type is the built-in at
    the root of its `extends` chain (`String` to `text`, `Integer` to
    `integer`, `Decimal` to `decimal`, `Float` to `float`, `Boolean` to
    `boolean`, `Date` to `date`, `DateTime` to `datetime`);
  - a built-in a role names without declaring it (`concept: String`) is
    one value type of that name and data type, made on first use; the
    exporter writes such a value type back as the built-in, not as a
    declared concept;
  - an entity type's reference mode, which core requires, is the name of
    its single identifying relationship, else `<snake_name>_id` (the NORMA
    importer's rule, through the same `snakeCase`);
  - each relationship is a fact type named `Concept.relationship` -- what
    Ossie's own expressions call it, and unique where a bare relationship
    name is not (`code` and `name` each recur across the example's
    concepts) -- whose first role is played by the concept it is declared
    under and whose further roles are its `roles`, in order, each named by
    its Ossie role name, else its player;
  - each `verbalizes` pattern is a reading, `{Concept:role}` and
    `{Concept}` placeholders becoming role positions (`{Concept}` names the role whose name is that concept -- the first
    role, or one with no role name -- else the only role that concept
    plays; a placeholder matching none, or a pattern that names one role
    twice and so leaves another out, is refused), the text otherwise kept
    as written (Open decision 4 for the hyphen);
  - `multiplicity: ManyToOne` is an internal uniqueness over all roles
    but the last, `OneToOne` an internal uniqueness on each role of a
    binary, and no multiplicity a uniqueness spanning every role
    (relationships have set semantics: no link repeats). A unary's
    spanning uniqueness is its one role, which the exporter omits again as
    implied; `OneToOne` off a binary, or `ManyToOne` on a unary, is read
    as no multiplicity, with a warning;
  - `extends` between entity types is a subtype fact per supertype, the
    first identifying the subtype unless it names its own `identify_by`;
    `Any`, which every entity implicitly extends, adds nothing;
  - `identify_by` naming one relationship is the entity's preferred
    identifier: the uniqueness on that relationship's far role, added with
    a warning when the multiplicity did not state it. Naming several, it is
    an external uniqueness over their far roles, stored as the preferred
    identifier, each relationship gaining the uniqueness on the entity's
    role with a warning when the multiplicity did not state it
    (`external-preferred-identifier.spec.md`, WS2; barwise-alg);
  - `description` is the element's definition;
  - a `derived_by` list on a relationship is the fact type's derivation
    rule, and on an entity with a supertype the defining rule of each of
    its subtype facts, carried as text (the expressions joined, one per
    line) of kind `derived` -- Ossie has no semiderived notion, so the
    exporter names a semiderived fact type in its warnings. On an entity
    with no supertype, or a value type, it is kept in the note with a
    warning;
  - three `requires` shapes are constraints. On a value type, an
    enumeration (`X == 'A' OR X == 'B' ...`) or bounds (`X >= lo`,
    `X < hi`, `lo <= X`, either operand order, strict or not, at most one
    per side) become one value constraint. On an entity type, a bare
    `Entity.rel` naming one of its relationships is a mandatory first role
    on `rel`. The items of a `requires` list all hold, while a barwise
    value constraint's values and ranges are alternatives, so an enumeration
    is never combined with another item: the first enumeration item is the
    constraint, and a second enumeration, or a bound beside an enumeration,
    goes to the note.
    Any other expression is kept in the element's note and named in a
    warning.
- When the document's `version` is not `0.2.0.dev0`, the importer shall
  refuse it, naming the version it read and the one it supports.
- When a document is malformed in a way the mapping depends on -- a concept
  declared twice or redeclaring a built-in, a relationship name repeated on
  one concept, two roles with one name, an empty `verbalizes`, a placeholder naming no
  role, a pattern leaving a role out, an unknown multiplicity, an entity
  extending a value type or a value type extending no built-in, an
  `identify_by` naming a relationship the entity does not itself declare
  (a supertype's included) or one that is not binary, a
  role or supertype that is not declared, an `extends` cycle -- the
  importer shall refuse it with an `OssieImportError` naming the place.
  An empty or null `description` is read as absent.
- When an ontology carries an `iri`, a `prefixes` map, an `ai_context`,
  an ontology-level `requires`, a value type extending more than one
  concept (its data type from the first), a value type that extends another
  user value type (naming any `requires` on the chain that the flattening does
  not carry), an `identify_by` on a value type, or a deprecated embedded
  `ontology_mappings`, the importer shall name each in `warnings` and keep
  what barwise can hold.
- When an importer creates an element, it shall take the id from
  `generateId()` (`importer-role-ids.spec.md`, R1), and
  `cli/tests/importerIds.test.ts` shall run it over a fixture that
  reaches every id path -- which means the test's id collector also reads
  subtype-fact ids, which it does not today, for every importer. Elements are found again by name, and a re-import
  diffs by content, which diff falls back to when ids differ.
- When a model is exported with `--format ossie`, the system shall write an
  ontology document that `ontology/ontology.json` at the pinned commit
  accepts and the importer reads back without refusal, inverting each
  mapping above by the rules WS2 states, and shall name every construct it
  cannot write in the document's loss report (Open decision 5): every
  constraint it cannot express (ring, frequency, exclusion, exclusive-or,
  subset, equality, value comparison, cardinality, disjunctive mandatory,
  the join kinds, a mandatory role other than a first role, and any
  uniqueness other than the shapes a multiplicity or an identifier states),
  each also a `constraintSpecs` entry where the shared builder can describe
  it, and every other loss WS2 lists.
- When `examples/flights.ontology.yaml` at the pinned commit is imported
  and the result exported, the second document shall equal the first in
  every construct the import did not warn about, compared by meaning: a
  recognized `requires` as the constraint it reads as (`1 <= X` and
  `X >= 1` are one bound) and a placeholder as the role it names, since the
  import keeps neither spelling. Everything else compares as written.

Out of scope:

- **The core layer** (datasets, fields, metrics) and **mapping documents**
  (`ontology/mapping.json`), which bind ontology concepts to dataset fields.
  barwise's relational mapper is the natural home for that binding, and it
  is barwise-pf2.3's question (logical schema to model), not this one.
- **Parsing Ossie's expression language.** `derived_by` and `requires` are
  carried as text, with only the three `requires` shapes above recognized.
  A formal expression language is barwise-pf2.2.
- **IRIs and prefixes as model fields.** barwise has no field for them;
  barwise-rqb (custom attributes) is where they would go.
- **Hyphen binding in verbalization** (`has average- departure {Delay}`),
  which barwise's verbalizer does not implement for any source:
  barwise-iiw (Open decision 4).

## Inventory

| Area                                            | Current state                      | Verdict                                                                         |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `formats/src/ossie/` (new)                      | none                               | parser, mapper, writer, `requires` recognizer                                   |
| `cli/tests/importerIds.test.ts`                 | a fixture per registered importer  | adds an Ossie fixture (R3)                                                      |
| `vscode/package.json` tool `format` enums       | hand-listed, import and export     | `ossie` added; drift tests vs the registry                                      |
| `formats/src/registration.ts`                   | five descriptors                   | adds `ossieFormat`, importer and exporter                                       |
| `formats/tests/fixtures/ossie/` (new)           | none                               | the pinned `flights.ontology.yaml` and schema                                   |
| core `ImportResult.warnings`, `constraintSpecs` | exist; NORMA returns no warnings   | used as is                                                                      |
| core metamodel, serializer, schema              | carries every target above but one | untouched; external preferred id: done, `external-preferred-identifier.spec.md` |
| surfaces (CLI, MCP)                             | reach every registered format      | untouched; the capability matrix row holds                                      |

Nothing in `@barwise/core` changes. The capability matrix's
"export, import" row already reads "none" for divergence, and a registered
format reaches all three surfaces through the registry, so it stays true.

## Target architecture

```
@barwise/formats/src/ossie/
  OssieTypes.ts        the document shape, as the pinned schema states it
  parseOssie.ts        YAML text -> OssieDocument (version check)
  mapOssieToOrm.ts     OssieDocument -> OrmModel + warnings
  requiresShapes.ts    the three recognized requires shapes <-> constraints
  writeOssie.ts        OrmModel -> OssieDocument + constraintSpecs
  OssieImportFormat.ts / OssieExportFormat.ts   the two adapters
registration.ts: ossieFormat { name: "ossie", extension: "yaml",
                               importer, exporter }
```

Element ids come from `generateId()`, as every importer's do except NORMA's,
which keeps the source file's ids; elements are found again by name. `writeOssie` is a renderer living in `@barwise/formats`
rather than a thin shell over core, as the NORMA writer already is: the
package convention that export descriptors call back into core describes
the DDL, OpenAPI and Avro shells, and WS2 amends formats `CLAUDE.md` to say
a format with no core renderer keeps its writer here.

## Alternatives considered

- **Map every `requires` expression to a value constraint, or drop the
  ones that do not fit.** Mapping all of them needs the expression
  language barwise-pf2.2 owns; dropping them silently is the failure this
  spec exists to avoid. The three recognized shapes cover the example's
  enumerations, ranges and mandatory roles, and the rest is kept as a note
  and reported.
- **Export every barwise constraint as a `requires` expression.** Beyond
  the three recognized shapes, which the exporter does write (a mandatory
  first role as `Entity.rel`), it would write expressions in a language
  barwise does not parse, so an Ossie consumer could not tell a faithful
  rendering from a guess, and a re-import could not read them back.
  `constraintSpecs` already carries a verbalization and pseudocode for
  every such constraint.
- **Derive ids from Ossie names**, so a re-import matches by id. It breaks
  `importer-role-ids.spec.md` R1, whose Alternatives considered rejected a
  sanctioned exception to `generateId()` outright; diff's content fallback already matches a
  re-import.
- **A new `@barwise/ossie` connector package.** The connector packages
  exist to own I/O (`@barwise/dbt`'s subprocess, `@barwise/code-analysis`'s
  LSP sessions). Ossie is a text format with no I/O of its own, which is
  what `@barwise/formats` holds.

## Workstreams (each independently shippable)

### 1. Import

`OssieTypes`, `parseOssie`, `mapOssieToOrm`, `requiresShapes`, and
`OssieImportFormat`, registered on `ossieFormat` with the importer only;
`ossie` added to the editor's `barwise_import_model` `format` enum, with a
drift test holding that enum and `barwise_export_model`'s to the registry; an Ossie fixture in `importerIds.test.ts`; the format named
where docs list the formats package's descriptors. Tests: each mapping in
Scope against a small document; the version refusal and each malformed
shape; every warning named; and the pinned `flights.ontology.yaml` imported, its
model validating with no errors, and its warnings listed in the test so a
change to what is carried is a visible diff. The fixture keeps its Apache
license header, which is what redistributing it requires.

### 2. Export and the round trip

Grounded 2026-10-24, after WS1 merged, and revised after its plan review.
`writeOssie` (model to document) and `OssieExportFormat`, added to
`ossieFormat`, which then has both directions. Each rule below is stated so
a test can fix its output.

- **Role order and the declaring concept, by precedence; the first rule
  that applies decides.** An Ossie relationship is declared under the
  concept playing its first role, and barwise puts no concept first.
  1. A fact type named `X.rel` -- `X` the text before the first `.` -- where
     `X` plays one of its roles: that role first (the first such role in
     barwise order, when `X` plays several), the others in their barwise
     order. This is the importer's own
     record of where the relationship was declared, so an imported
     document comes back where it was.
  2. A binary that holds an entity's preferred identifier: the identified
     entity's role first.
  3. A binary with a single-role uniqueness on exactly one of its roles:
     that role first, so the relationship reads as `ManyToOne`.
  4. A fact type of three roles or more with one uniqueness over all roles
     but one: that role last, the others in their barwise order.
  5. Otherwise the barwise order.
     Then, if the first role is played by a built-in (below), the first role
     whose player is declared moves to the front, keeping rule 4's last role
     last; a fact type all of whose roles are built-ins is a loss. Readings follow the order, since a template names roles by position:
     `{0}` becomes `{Concept}`, and a later role `{Player:name}` when it is
     named (below) or `{Player}` when it is not. A reading with brace text
     that is not a role position has the braces written as parentheses, so
     the importer's placeholder grammar does not read it as one, and that is
     a loss.
- **What is written from constraints, after ordering.** `ManyToOne` for a
  uniqueness over exactly every role but the last; `OneToOne` for a binary
  with a single-role uniqueness on each role; nothing for a uniqueness
  spanning every role, or a unary's, which are implied. `identify_by` names
  a relationship when the entity's preferred identifier is a single-role
  uniqueness on role 2 of a binary declared under that entity; an entity with no preferred identifier gets `identify_by` over the
  relationships of an external uniqueness whose every role is role 2 of a
  binary declared under it whose role 2 the entity itself does not play
  (the importer's composite shape; it refuses a ring binary there). Any other preferred
  identifier -- on an n-ary fact type, on an objectification, on a binary
  declared elsewhere -- is a loss, not an `identify_by` the importer would
  refuse. A mandatory first role is a bare `Entity.rel` in the entity's `requires`
  when the declaring concept is an entity type; the importer reads that
  shape only there, so on a value type it is a loss. A value constraint of values only, none containing what the importer
  splits an enumeration at (its `\s+OR\s+`, shared from `requiresShapes`
  rather than restated), is one enumeration item, each `'` doubled; one whose single range
  has numeric bounds (the importer's number shape) is its bound items;
  every other value constraint -- values and ranges, several ranges, a
  non-numeric bound, a role's -- is a loss. Every other uniqueness, and
  every other constraint kind (disjunctive mandatory and constraints over
  subtypes included), is a loss.
- **Names, held to what the importer reads back.** A fact type named
  `X.rel` declared under `X` is written as `rel`; any other name as its
  words joined by `_`. A relationship or role name keeps only letters,
  digits and `_` (each other character becomes `_`, and a leading digit
  gets a `_` before it), so `Entity.rel` and placeholders parse; a name
  repeated under one concept gets a numeric suffix. The first role is never named: Ossie keys it by its concept. A later role
  is named where Ossie needs it -- its player also plays another role, or
  its barwise name differs from its player's -- and never by the declaring
  concept's name or a key another role already has; then
  `{Player}_{position}`. barwise role names are otherwise not written and
  not reported: they are verbalization aids the readings carry, and Ossie
  has no field for them. A concept name with `{`, `}` or `:` (which break
  placeholders), or an object type named like a built-in or `Any` that is
  not written as the built-in (below), is renamed -- the characters to
  `_`, a colliding name with `_` appended -- and the rename is a loss.
- **Built-ins.** A value type named like a built-in, with that built-in's
  data type and no definition, value constraint or note, is written as the
  built-in and not declared. Any other object type with a built-in's name
  or `Any` is declared under a renamed name, since the importer refuses a
  concept that redeclares one.
- **Subtypes.** `extends` lists an entity's supertypes in subtype-fact
  order. A subtype fact whose `providesIdentification` differs from the
  importer's rule (the first supertype identifies unless the entity names
  its own `identify_by`), and supertypes with different defining rules
  (one `derived_by` per concept), are losses.
- **Text.** A derivation is written as `derived_by` items split at blank
  lines; WS2 changes the importer to join a list's items with a blank line
  (it joins with a line end today), so one multi-line expression stays one
  item, and a list item that itself holds a blank line is named in an
  import warning. A note's lines that begin `requires: ` go back to `requires`, after the
  items written from a value constraint (the importer takes the first
  enumeration and the first bound on each side as the constraint, so the
  constraint's own items lead), and `derived_by: ` lines to `derived_by`; the model note's
  `requires: ` lines go to the ontology's `requires` and the rest is its
  `description`, and WS2 changes the importer to warn when a description
  has a line beginning `requires: `, since the export would read it as one.
- **Data types.** `text`, `integer`, `decimal`, `float`, `boolean`, `date`
  and `datetime` are their built-ins. The rest are written as one and are a
  loss: `money` as `Decimal`, `timestamp` as `DateTime`, `auto_counter` as
  `Integer`, and `time`, `binary`, `uuid` and `other` as `String`; so is a
  `length` or `scale`, and a value type with no data type (`String`).
- **Other losses**: a semiderived rule, whose text is still written as
  `derived_by` (which reads back as fully derived); a stored derivation's
  storage; a note line that is not one of the
  two kinds above; a population; an objectification; an object type's aliases, `independent`, default value, cardinality and
  source context; an identified entity's reference mode where it differs
  from its identifying relationship's name (the importer reads that name
  back as the reference mode); and an entity written with no `identify_by`
  and no supertype that identifies it, whose reference mode is then the
  only identifier barwise had (the importer's `<snake_name>_id` for an unidentified concept
  included -- that import already warned, so the round trip excludes it).
- **The loss report (Open decision 5, now taken).** Every loss is a line
  `# barwise: <element>: <what was not written>` in a comment block at the
  top of the document, with the text made one line as the importer's
  warnings are, so a lost note's line end cannot escape the comment. A
  constraint loss is also a `constraintSpecs` entry, built by the per-kind
  builder moved out of the DDL router into a shared
  `formats/src/constraintSpec.ts` (one copy, both callers) -- for the
  constraints that builder can describe, those with roles; a value type's
  own value constraint and a constraint over subtypes have none, and
  appear in the block only. The block is not optional: nothing in the CLI,
  MCP or editor reads `constraintSpecs` today, for DDL either
  (barwise-wc0), so without it an unexpressible constraint would vanish
  unseen.

Tests: each rule above against a small model (each precedence step, each
written and lost constraint shape, each rename, each data type); a native
barwise model -- not one the importer made -- exported and accepted by the
pinned schema, then re-imported without refusal; every loss kind in the
block; and the round trip in Scope. The schema test validates with
`ajv`'s draft 2020-12 build, `ajv/dist/2020`, added to `@barwise/formats`
as a devDependency (the workspace already locks it for `@barwise/core`).
The schema's `$ref`s name `core-spec/ossie-schema.json` on Ossie's moving
`main`, so that file is vendored from the pinned commit and registered
under the URL the `$ref` names: no network, and no drift from the pin. The
schema's `"format": "iri"` is not one `ajv-formats` defines, and ajv's
strict mode refuses an unknown format, so the test declares it: an
absolute IRI (a scheme, a colon, no whitespace or `<>"{}|\^` characters),
which still refuses a relative or space-bearing one. `ossie` joins the
editor's `barwise_export_model` enum, which the WS1 drift test then holds.
Depends on WS1.

**Implementation note (WS2).** The schema test runs ajv in strict mode
with one rule off, `strictRequired`: the pinned `ontology.json` writes
`required` inside an `anyOf` for properties its parent declares, valid JSON
Schema that ajv's strict mode refuses as a style matter. The rule is about
how the schema is written, not the document under test, so turning it off
loses no check on the export. The loss report predicts, construct by construct,
what the importer reads back; three review rounds each found another
construct where a prediction diverged, so barwise-5bv tracks verifying the
report by re-importing the written document instead.

## API and migration impact

- `@barwise/formats` exports `ossieFormat`; `registerStandardFormats()`
  registers it. No public type changes elsewhere.
- No migration: no barwise file changes.

## Open decisions (for review)

1. **Value types that extend value types.** Ossie lets `Capacity` extend
   `NrPounds` extend `Integer`; barwise has no value-type subtyping
   (`canAddSubtypeFact` refuses a value-type end). Options: flatten to the
   chain root's data type and warn (lossy on round trip: `Capacity` comes
   back extending `Integer`); keep the chain in the note and restore it on
   export (round-trips, but a note becomes load-bearing); or add value-type
   subtyping to core (a metamodel change for one format). **Recommend
   flatten and warn**; the warning keeps the loss visible, and a second
   format needing value-type subtyping would justify the core change.
2. **Pinning a mutable spec.** Options: support exactly `0.2.0.dev0` at
   the pinned commit and refuse anything else; or accept any version and
   read best-effort. **Recommend the pin and the refusal.** The spec says it
   will break; a refusal that names both versions is a clear signal to
   update, where best-effort reading of a changed schema would import wrong
   models without a word.
3. **Implied spanning uniqueness.** A relationship with no multiplicity
   has set semantics, so its links never repeat: a uniqueness spanning
   every role. Options: emit that uniqueness on import (validation then
   reports what it reports for any many-to-many fact type -- the
   `spanningAllRoles` note, info on a binary and a warning from a ternary
   up -- and export omits it again as implied); or emit nothing (the model
   carries a fact type with no uniqueness, which validation reports as
   missing). **Recommend emitting it**: it is
   what the Ossie document states, and leaving it out would make a valid
   Ossie relationship import as a validation warning.

4. **Ossie's hyphen binding.** The example writes `has average- departure
   {Delay}`: in ORM tooling the hyphen binds the adjective to the role
   player when a constraint is verbalized. barwise's verbalizer implements
   no hyphen binding for any source. Options: keep the reading as written
   and warn per reading (verbalization shows the stray hyphen until barwise
   binds it, and the round trip is exact); strip the hyphen (clean output,
   the export loses it); implement hyphen binding in core's verbalizer (a
   core change this spec rules out). **Recommend keeping it and warning**,
   with hyphen binding in core filed as barwise-iiw, since NORMA readings use
   the same convention.

5. **Where export reports a loss that is not a constraint.**
   `ExportResult` carries `constraintSpecs` for constraints and
   `annotations` shaped for tables (`tableName`, `columnName`); a
   semiderived rule, an unmapped data type or a dropped note has no field.
   Options: a comment block at the top of the written document listing each
   loss (`# barwise: <element>: <what was not written>`), which needs no
   core change and is seen by whoever opens the file, though the CLI and
   MCP summaries do not show it; or an optional `warnings` field on
   `ExportResult`, which every surface could print, but is a core interface
   change this spec rules out. **Recommend the comment block**, and the
   core field when a second format needs the same channel. Taken when WS2
   was grounded: the block carries constraint losses too, since nothing
   reads `constraintSpecs` (barwise-wc0).

## Risks and testing

- **The pinned fixture is the contract.** If Ossie changes its schema, the
  refusal (decision 2) keeps barwise from misreading new documents, and
  updating the pin is a deliberate change with a visible fixture diff.
- **A round trip that hides loss.** WS2's round-trip test compares
  construct by construct and excludes only what WS1's warnings named, so a
  construct dropped without a warning fails it.
- Run the full monorepo build and tests after each workstream; the
  registry change reaches every surface.

## Non-goals

- No change to core, its schema, or `.orm.yaml`.
- No Ossie core-layer (datasets, metrics) or mapping-document support.
- No parser for Ossie's expression language.
