# Apache Ossie ontology import and export

Status: In progress -- WS1 (import) implemented; WS2 (export) provisional, not started

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-pf2.1
Plan-reviewed: 9a7009d1 (code-review, pr-review)
Touches: +barwise/packages/formats/src/ossie/,
barwise/packages/formats/src/registration.ts,
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
    an external uniqueness over their far roles, kept but not named as the
    preferred identifier, with a warning: core reads only an internal
    uniqueness as one (barwise-alg), and the NORMA importer treats the same
    shape the same way;
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
  accepts, inverting each mapping above, and shall list in
  `constraintSpecs` every constraint it cannot express (ring, frequency,
  exclusion, exclusive-or, subset, equality, value comparison, cardinality,
  the join kinds, a mandatory role other than a first role, an external
  uniqueness that is not an entity's identifier, and any internal
  uniqueness other than the shapes a multiplicity or an identifier states).
  An entity's `identify_by` is its preferred identifier's relationship,
  or, for an entity with none, the relationships of an external uniqueness
  whose every role is the far role of a binary declared under that entity
  (the import's composite shape). Every other loss -- a semiderived rule,
  a data type with no Ossie built-in, a value type with no data type, a
  note, a reference mode no fact type carries -- is named in the export's
  loss report (Open decision 5).
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

| Area                                            | Current state                      | Verdict                                       |
| ----------------------------------------------- | ---------------------------------- | --------------------------------------------- |
| `formats/src/ossie/` (new)                      | none                               | parser, mapper, writer, `requires` recognizer |
| `cli/tests/importerIds.test.ts`                 | a fixture per registered importer  | adds an Ossie fixture (R3)                    |
| `vscode/package.json` tool `format` enums       | hand-listed, import and export     | `ossie` added; drift tests vs the registry    |
| `formats/src/registration.ts`                   | five descriptors                   | adds `ossieFormat`, importer and exporter     |
| `formats/tests/fixtures/ossie/` (new)           | none                               | the pinned `flights.ontology.yaml` and schema |
| core `ImportResult.warnings`, `constraintSpecs` | exist; NORMA returns no warnings   | used as is                                    |
| core metamodel, serializer, schema              | carries every target above but one | untouched; external preferred id: barwise-alg |
| surfaces (CLI, MCP)                             | reach every registered format      | untouched; the capability matrix row holds    |

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

**Provisional: not yet grounded.** Drafted before WS1 was built, and the
plan review of WS1 raised these for WS2 to settle when it is grounded:
`constraintSpecs` reaches no surface today (nothing in the CLI, MCP or
editor reads it), so an unexpressible constraint needs the loss report as
well (Open decision 5); the pinned schema's `"format": "iri"`, which ajv's
strict mode refuses unless the format is declared; a value constraint that
is a disjunction (values and a range, two ranges, a role-level one), which
Ossie's all-hold `requires` items cannot state; role order, since barwise
does not put the declaring concept first (a fact type is declared under the
entity whose role makes it expressible, and a reference fact type under its
referent); how a value type named like a built-in is recognized as one (no
definition, no constraint, the built-in's data type); the per-kind
`ConstraintSpec` builder, which today is private to the DDL router and
would be shared rather than copied; a `derived_by` expression that itself
spans lines, which the one-per-line join cannot split back; and the
`<snake_name>_id` reference mode the importer makes for a composite
identifier, which the exporter must not report as a loss. Populations and
objectification join the loss report.

`writeOssie` and `OssieExportFormat`, added to `ossieFormat`. Tests: each
inverse mapping; every unexpressible constraint kind in `constraintSpecs`;
the exported flights document accepted by the pinned `ontology.json`
(validated in the test with `ajv`'s draft 2020-12 build, `ajv/dist/2020`,
which the workspace already locks for `@barwise/core`; WS2 adds it to
`@barwise/formats` as a devDependency). The schema's two remote `$ref`s
name `core-spec/ossie-schema.json` on Ossie's moving `main`, so that file is
vendored too, from the pinned commit, and registered under the URL the
`$ref` names: no network, and no drift from the pin. `ossie` joins the
editor's `barwise_export_model` enum, which the WS1 drift test then holds;
and
the round trip in Scope, construct by construct. Depends on WS1.

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
   core field when a second format needs the same channel.

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
