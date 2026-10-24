# Apache Ossie ontology import and export

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-pf2.1
Touches: +barwise/packages/formats/src/ossie/,
barwise/packages/formats/src/registration.ts,
barwise/packages/formats/src/index.ts,
barwise/packages/formats/tests/,
barwise/packages/formats/CLAUDE.md,
barwise/packages/formats/package.json

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

- When `barwise import ossie <file>` (or `import_model` with
  `format: ossie`) reads an Ossie ontology document at version
  `0.2.0.dev0`, the system shall produce a model in which:
  - each `EntityType` concept is an entity object type, and each
    `ValueType` concept a value type whose data type is the built-in it
    extends, directly or through other value types (`String` to `text`,
    `Integer` to `integer`, `Decimal` to `decimal`, `Float` to `float`,
    `Boolean` to `boolean`, `Date` to `date`, `DateTime` to `datetime`);
  - each relationship is a fact type whose first role is played by the
    concept it is declared under and whose further roles are its `roles`,
    in order, with role names kept;
  - each `verbalizes` pattern is a reading, `{Concept}` and
    `{Concept:role}` placeholders becoming role positions;
  - `multiplicity: ManyToOne` is an internal uniqueness over all roles
    but the last, `OneToOne` an internal uniqueness on each role of a
    binary, and no multiplicity a uniqueness spanning every role
    (relationships have set semantics: no link repeats);
  - `extends` between entity types is a subtype fact per supertype;
  - `identify_by` is the entity's preferred identifier: the uniqueness on
    the identifier's role for one relationship, an external uniqueness
    over the identifiers' roles for several;
  - `description` is the element's definition;
  - a `derived_by` list on a relationship is the fact type's derivation
    rule, and on a concept the defining rule of its subtype fact, carried
    as informal text (the expressions joined, one per line);
  - a `requires` expression of one of two recognized shapes is a value
    constraint: an enumeration (`X == 'A' OR X == 'B' ...`) and a range
    (`X >= lo`, `X <= hi`, strict or not, alone or as a pair). Any other
    `requires` expression is kept in the element's note and named in a
    warning.
- When the document's `version` is not `0.2.0.dev0`, the importer shall
  refuse it, naming the version it read and the one it supports.
- When an ontology carries an `iri`, a `prefixes` map, an ontology-level
  `requires`, a value type that extends another user value type, or a
  deprecated embedded `ontology_mappings`, the importer shall name each in
  `warnings` and keep what barwise can hold (the data type from the chain's
  root, for the value type).
- When a model is exported with `--format ossie`, the system shall write an
  ontology document that `ontology/ontology.json` at the pinned commit
  accepts, inverting each mapping above, and shall list in
  `constraintSpecs` every constraint it cannot express (mandatory, ring,
  frequency, exclusion, exclusive-or, subset, equality, value comparison,
  cardinality, the join kinds, and any uniqueness other than the shapes a
  multiplicity states).
- When `examples/flights.ontology.yaml` at the pinned commit is imported
  and the result exported, the second document shall equal the first in
  every construct the import did not warn about.

Out of scope:

- **The core layer** (datasets, fields, metrics) and **mapping documents**
  (`ontology/mapping.json`), which bind ontology concepts to dataset fields.
  barwise's relational mapper is the natural home for that binding, and it
  is barwise-pf2.3's question (logical schema to model), not this one.
- **Parsing Ossie's expression language.** `derived_by` and `requires` are
  carried as text, with only the two `requires` shapes above recognized.
  A formal expression language is barwise-pf2.2.
- **IRIs and prefixes as model fields.** barwise has no field for them;
  barwise-rqb (custom attributes) is where they would go.

## Inventory

| Area                                            | Current state                            | Verdict                                       |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `formats/src/ossie/` (new)                      | none                                     | parser, mapper, writer, `requires` recognizer |
| `formats/src/registration.ts`                   | five descriptors                         | adds `ossieFormat`, importer and exporter     |
| `formats/tests/fixtures/ossie/` (new)           | none                                     | the pinned `flights.ontology.yaml` and schema |
| core `ImportResult.warnings`, `constraintSpecs` | exist; NORMA returns no warnings         | used as is                                    |
| core metamodel, serializer, schema              | carries every barwise target named above | untouched                                     |
| surfaces (CLI, MCP, VS Code)                    | reach every registered format            | untouched; the capability matrix row holds    |

Nothing in `@barwise/core` changes. The capability matrix's
"export, import" row already reads "none" for divergence, and a registered
format reaches all three surfaces through the registry, so it stays true.

## Target architecture

```
@barwise/formats/src/ossie/
  OssieTypes.ts        the document shape, as the pinned schema states it
  parseOssie.ts        YAML text -> OssieDocument (version check)
  mapOssieToOrm.ts     OssieDocument -> OrmModel + warnings
  requiresShapes.ts    the two recognized requires shapes <-> value constraints
  writeOssie.ts        OrmModel -> OssieDocument + constraintSpecs
  OssieImportFormat.ts / OssieExportFormat.ts   the two adapters
registration.ts: ossieFormat { name: "ossie", extension: "yaml",
                               importer, exporter }
```

Element ids on import derive from Ossie names (`derivedId` over the
concept and relationship names), so one document always imports to the same
ids -- the determinism rule, and what lets a re-import diff by id.

## Alternatives considered

- **Map every `requires` expression to a value constraint, or drop the
  ones that do not fit.** Mapping all of them needs the expression
  language barwise-pf2.2 owns; dropping them silently is the failure this
  spec exists to avoid. The two recognized shapes cover the example's
  enumerations and ranges, and the rest is kept as a note and reported.
- **Export barwise constraints as `requires` expressions** (a mandatory
  role as `EXISTS(...)`). It would write expressions in a language barwise
  does not parse, so an Ossie consumer could not tell a faithful rendering
  from a guess, and a re-import could not read them back. `constraintSpecs`
  already carries a verbalization and pseudocode for every such constraint.
- **A new `@barwise/ossie` connector package.** The connector packages
  exist to own I/O (`@barwise/dbt`'s subprocess, `@barwise/code-analysis`'s
  LSP sessions). Ossie is a text format with no I/O of its own, which is
  what `@barwise/formats` holds.

## Workstreams (each independently shippable)

### 1. Import

`OssieTypes`, `parseOssie`, `mapOssieToOrm`, `requiresShapes`, and
`OssieImportFormat`, registered on `ossieFormat` with the importer only.
Tests: each mapping in Scope against a small document; the version refusal;
every warning named; and the pinned `flights.ontology.yaml` imported, its
model validating with no errors, and its warnings listed in the test so a
change to what is carried is a visible diff. The fixture keeps its Apache
license header, which is what redistributing it requires.

### 2. Export and the round trip

`writeOssie` and `OssieExportFormat`, added to `ossieFormat`. Tests: each
inverse mapping; every unexpressible constraint kind in `constraintSpecs`;
the exported flights document accepted by the pinned `ontology.json`
(validated in the test with `ajv`, which the workspace already locks for
`@barwise/core`; WS2 adds it to `@barwise/formats` as a devDependency); and
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
   has nothing to report, and export omits it again as implied); or emit
   nothing (the model carries a fact type with no uniqueness, which
   barwise's validation warns about). **Recommend emitting it**: it is
   what the Ossie document states, and leaving it out would make a valid
   Ossie relationship import as a validation warning.

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
