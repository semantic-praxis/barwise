# IRI identity: readable names replace UUIDs (format 4.0)

Status: In progress -- WS1 and WS2 implemented 2026-10-28 (the loader reads a
minor of the current major, barwise-jj8; `localName()` and the name checks);
WS3 folded into WS6; WS4 (with barwise-y1b) planned; WS5 to WS7 to come

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-wcg, barwise-y1b
Plan-reviewed: e7acea95 (code-review, pr-review; re-pointed after WS3 was folded into WS6)
Touches: barwise/packages/core/src/model/,
barwise/packages/core/src/serialization/,
barwise/packages/core/schemas/,
barwise/packages/core/src/validation/,
barwise/packages/core/src/diff/,
barwise/packages/core/src/project/,
barwise/packages/core/src/lineage/,
barwise/packages/formats/src/,
barwise/packages/dbt/src/,
barwise/packages/llm/src/,
barwise/packages/diagram/src/,
barwise/packages/vscode/src/,
barwise/packages/cli/src/commands/,
barwise/packages/mcp/src/tools/,
barwise/docs/adr/determinism-in-core.md,
barwise/docs/adr/schema-versioning.md,
barwise/docs/specs/importer-role-ids.spec.md

Every barwise element gets one identifier built from its name, in place of
the random UUID it carries today. A file stores each element's local name -- `Customer`, `Customer_places_Order.places` -- and a model's namespace is
declared once, so an element's full IRI is its namespace followed by its
local name. Identity becomes something a person can read and a second tool
can rebuild. It is a structural change to `.orm.yaml`, so it ships as format
4.0 with a migration that works one file at a time, after workstreams that each land alone
and keep 3.x files readable and lossless.

## Principle

**Determinism in core.** Today the same input imported twice yields two
models that differ in every id: `generateId()` returns a random UUID
(`core/src/model/id.ts`), every importer calls it
(`importer-role-ids.spec.md`, R1), and code that needs stable output strips
ids back out -- `hashModel` replaces each id with its order of appearance
before hashing (`core/src/lineage/manifest.ts`, `canonicalizeIds`). An id
built from the element's name is a function of the input: the same model
gets the same identity wherever it is built.

**Explicit over implicit.** A model declares its namespace, and declares
each other domain it refers to as an import with an alias, the way XML
namespace prefixes work. Today `split` copies a shadow object type into each
domain that uses it with the owner's UUID, so one id sits in several files
and only a free-text `source_context` says which copy is the owner
(`core/src/project/splitModel.ts:341-360`). Under this spec the shadow's id
is the owner's qualified name, `billing:Invoice`, and the import says what
`billing` means; `source_context` goes, so ownership is stated once.

**Composability.** A standard IRI is what RDF and OWL tools, Apache Ossie
(`docs/adr/ossie-interchange.md`, decision 5) and a future linked-data export
read. A UUID is not.

## Is a readable name stable enough to be an identity? (resolved: yes, with rename as an operation)

Names are already unique where they are used -- object type names per model
(`OrmModel.ts:202-206`) and fact type names per model (`OrmModel.ts:534-538`)
-- so the owner's choice of readable IRIs (2026-10-28) holds, with one cost:
renaming an element changes its identity, where today a rename is a text
edit that keeps the UUID, and `id-first` diff counts "a rename or an edit
that keeps the id" as one modification (`core/src/diff/identity.ts`). Two
mechanisms repay it, both in WS5, which lands before the format change: a
rename operation that rewrites every reference across the project, and a
diff that reports a rename it can recognize. An opaque IRI would avoid the
cost; it is under Alternatives.

## Scope

In scope:

- When a model is saved as 4.0, the system shall store each element's
  local name as its `id`, and every reference to an element as either its
  local name, for an element of the same model, or `alias:LocalName`, for
  an element of an imported domain. `alias:LocalName` is a QName, as in
  Ossie's `prefixes` and XML, not a relative IRI; `iriOf` expands it.
- When a model belongs to a project, its namespace shall be the project's
  declared `iri_base`, the project name, and the domain's context name, most
  general first (`https://data.acme.com/acme/ordering/`). A standalone model
  may declare a `namespace` in its header; a domain file loaded through a
  project that declares one is refused, so the namespace has one source.
  A model with no namespace is decision 11.
- When a model refers to an element of another domain, the model shall
  declare `imports`, each binding an alias to a context name or to an
  absolute namespace IRI; a reference with an undeclared alias is a
  validation error in 4.0, and a declared alias whose context no loaded
  project supplies is a warning, so a standalone domain file still loads. Mapping files keep
  their `context:Name` references, whose contexts their own
  `source_context` and `target_context` fields declare.
- When an element is created, its local name shall come from the rule for
  its kind, through one normalizer, `localName()` in core, which reserves
  `:` for aliases and `.` for the role separator (decision 3):
  - object type: its name;
  - fact type: decision 2;
  - role: its fact type's local name, `.`, and its role name, which is
    required today;
  - constraint, subtype fact, objectification: a name minted from its
    canonical verbalization when the element is given its id, and stored, with
    the content key it was minted from (owner decision, 2026-10-28; WS6);
  - population and fact instance: decision 7.
- When a rule would give an element a local name another element of the
  model already holds, the system shall append `_2`, `_3`, and report it,
  except where decision 5 refuses instead. The order is a function of
  the input: object types before fact types before everything else, then
  document order, so two builds of one input agree.
- When an element's stored id no longer matches the name it was made from,
  validation shall warn, naming both (decisions 13 and 14). Neither
  changes on its own.
- When the user renames an element, the system shall change its local name
  and every id that embeds it -- a fact type's roles, and the population and
  fact instance ids decision 7 chooses -- and rewrite every reference to
  each: in its own model, its population rows and diagram layouts, the
  shadows and `alias:` references in the project's other domains, and the
  project's mapping files. `renameInModel` serves a standalone model and
  `renameInProject` names the domain; both are pure and return the
  old-to-new id map, which the surface's rename command uses to rewrite the
  lineage manifests it can see.
- When diff or merge compares two models, it shall pair elements by id,
  then by name, as today, and then recognize renames by the rule Open
  decision 8 chooses.
- When a 3.x file is loaded, the 3.x reader shall assign local names by
  these rules from that file alone, rewrite references, population rows and
  layout keys, report each suffix it added, and keep each element's
  original UUID in memory, so that diffing two 3.x revisions (`barwise
  history`) still pairs exactly. A shadow, which in 3.x carries its owner's
  name and `source_context`, becomes `<source_context>:localName(name)`,
  and the reader adds the import that alias needs; so domains of one
  project can be migrated in any order and still agree, and a surface may
  write any one of them as 4.0 on its next edit, as
  `schema-versioning.md` decision 4 already says. The one case a single
  file cannot see is an owner whose local name took a suffix; a 4.0
  project load reports the shadow's alias as unresolved, naming the owner,
  and `barwise migrate` given the project fixes both sides.
- When a 4.0 build checks lineage against a manifest whose element ids are
  UUIDs, which only a 3.x model can have written, it shall report each export as stale with the reason "ids
  changed to 4.0" rather than as an ordinary change, and impact analysis
  given a UUID shall say the manifest predates 4.0 instead of returning
  nothing. `barwise migrate` restamps the exports that were fresh under the
  3.x hash, so a stale export stays stale (decision 15).

Out of scope:

- **Subprojects.** barwise has none: a project holds a flat list of domains
  (`OrmProject.ts`). The namespace grammar leaves room for them between
  project and domain; adding them is its own decision.
- **Data products.** Element IRIs never include a product
  (`ossie-interchange.md`, decision 5). A product's own IRI is deferred.
- **Mapping to an outside vocabulary** beyond the field decision 1
  chooses. An OWL or RDF export is later work.
- **Publishing or dereferencing IRIs.** barwise forms them; it does not
  serve them.
- **Transcript samples.** Sample agreement and alternative framings diff
  with `matching: "content"` (`llm/src/sampleAgreement.ts`,
  `UNRELATED_IDS_DIFF`), because sample ids "may coincide", and keep doing
  so. Whether they should move to `id-first` once ids are names is a
  question for the extraction lane.

## Inventory

Grounded on main at `ca83b642` by a full read of id use across the
workspace, and corrected by two rounds of plan review.

| Area                                                                | Current state                                                                                                                                                                                                   | Verdict                                                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `serialization/OrmYamlSerializer.ts`                                | brings older files forward only to 2.0, then reads 2.0; a version between 2.0 and current is refused (barwise-jj8)                                                                                              | reads every minor of the current major (WS1)                                                                                                     |
| `core/src/model/id.ts`                                              | `generateId()` (v4, or the v7 a surface installs); `createUuidv7Generator`                                                                                                                                      | element ids stop using it (WS6)                                                                                                                  |
| element ids                                                         | object type, fact type, role, constraint, subtype fact, objectification, population, fact instance; required by the schema, no pattern                                                                          | become local names (WS6)                                                                                                                         |
| `OrmModel` stores                                                   | one map per kind; `refuseHeldId` checks within a kind, so an object type and a fact type may share an id                                                                                                        | a cross-kind local-name index (WS2 reports, WS6 enforces)                                                                                        |
| `SubtypeFact`, `ObjectifiedFactType` names                          | synthetic, built from ids (`subtype:<sub>:<super>`)                                                                                                                                                             | replaced by minted names, which are their ids (WS6)                                                                                              |
| names (`model/name.ts`, `validation/rules/structural.ts`, schema)   | object type and fact type names unique per model, in separate namespaces; `role_name` required (minLength 1) but unique nowhere; no character rule                                                              | `localName()` and the cross-kind and per-fact-type checks (WS2)                                                                                  |
| `diff/identity.ts`, `elementDiff.ts`                                | pair by id, then by name or content key; the name pass keeps a transcript import working against its base                                                                                                       | a content pass after the name pass, reporting renames (WS5)                                                                                      |
| `diff/ModelMerge.ts`                                                | keeps the existing id; `mergedId` derives a UUIDv8 on a clash                                                                                                                                                   | a clash takes the suffix rule (WS6)                                                                                                              |
| `project/splitModel.ts`                                             | shadow object types carry the owner's UUID and `source_context`; cross-domain constraints dropped                                                                                                               | shadows keep their data, take the owner's `alias:Name` as id, drop `source_context`; split writes imports (WS6)                                  |
| other `source_context` readers                                      | `mcp/src/tools/split.ts` tells shadows from owned types by it; diff has a `sourceContext` change kind (`breakingLevel.ts`); standalone files set it by hand (`trial/customers/C04-marketplace/kernel.orm.yaml`) | read the alias prefix of the id instead; a standalone file's alias binds to the context name and stays unresolved until a project loads it (WS6) |
| `OrmModel.addFactType`                                              | refuses a role whose player is not in the model                                                                                                                                                                 | unchanged: the shadow is in the model, so a split domain still loads, maps and verbalizes alone                                                  |
| `EntityMapping`, `OrmProject.parseQualifiedRef`                     | `context:Name`, split on the first colon                                                                                                                                                                        | unchanged; `localName()` never emits `:`, and absolute IRIs appear only in `iri_base` and `imports`                                              |
| `lineage/manifest.ts`, `impact.ts`                                  | per-directory `.barwise/lineage.yaml` with `elementId` and a `modelHash`; `canonicalizeIds` maps every string equal to an id to `#n`; impact matches by id                                                      | `canonicalizeIds` removed; `migrate` rewrites ids and restamps only exports that were fresh (WS6)                                                |
| `Population` and fact instances                                     | rows keyed by role id; six population rules, `YamlSourceMap`, NORMA's population mapping and `getInstance`/`removeInstance` use the instance id                                                                 | decision 7; rows re-keyed by role local name (WS6)                                                                                               |
| `DiagramLayout`                                                     | positions keyed by object type or fact type id, in one record                                                                                                                                                   | re-keyed (WS6); the cross-kind index keeps keys distinct                                                                                         |
| importers (`formats`, `dbt`, `llm`, code-analysis)                  | call `generateId()`; NORMA keeps its source ids; `cli/tests/importerIds.test.ts` requires minted ids, exempting NORMA                                                                                           | build local names; the test checks the naming rules (WS6)                                                                                        |
| exporters                                                           | NORMA writes `_<id>`; DDL comments name `(<id>)`; Ossie's loss block names ids; SVG writes `data-id`                                                                                                            | NORMA per decision 12; the rest print local names (WS6)                                                                                          |
| surfaces                                                            | `impact_analysis` and `lineage impact` take an id; diagnostics, verbalization, describe and query return ids; VS Code finds elements by the `id:` scalar                                                        | same fields, local-name values (WS6); rename is new (WS5)                                                                                        |
| `determinism-in-core.md` decision 4, `importer-role-ids.spec.md` R1 | ids minted only at creation; importers never build ids from names                                                                                                                                               | amended in WS6's PR                                                                                                                              |
| `schema-versioning.md` decisions 2 and 4                            | a minor bump registers a migration; a surface writes the current version on its next edit                                                                                                                       | WS1 makes a minor loadable; decision 4 stands, because migration works per file                                                                  |

Verbalization needs no change: it is deterministic and gives one sentence
per constraint, subtype fact and objectification (`Verbalizer.ts:188-243`,
`ConstraintVerbalizer`), which WS6 mints from. VS Code's source map and
completion keep working because the field stays `id`. No lineage manifest is
tracked in the repository, so WS7 has none to migrate.

## Target architecture

```
.orm-project.yaml                       domains/ordering.orm.yaml (4.0)
  project:                                orm_version: "4.0"
    name: acme                            model:
    iri_base: https://data.acme.com/        name: Ordering
    domains:                                imports:
      - path: domains/ordering.orm.yaml       billing: billing         # a context name
        context: ordering                   object_types:
      - path: domains/billing.orm.yaml        - id: Customer
        context: billing                        name: Customer
                                              - id: billing:Invoice   # shadow of billing's
                                                name: Invoice
                                            fact_types:
                                              - id: Customer_places_Order
                                                name: Customer places Order
                                                roles:
                                                  - id: Customer_places_Order.places
                                                    role_name: places
                                                    player: Customer

namespace(ordering)                = https://data.acme.com/acme/ordering/
iriOf(ordering, "Customer")        = https://data.acme.com/acme/ordering/Customer
iriOf(ordering, "billing:Invoice") = https://data.acme.com/acme/billing/Invoice
```

```ts
// @barwise/core
export function localName(name: string): string; // the one normalizer (WS2)
export function namespaceOf(
  model: OrmModel,
  project?: OrmProject,
): string | undefined; // WS4
export function iriOf(
  model: OrmModel,
  id: string,
  project?: OrmProject,
): string | undefined; // WS6
export function renameInModel(
  model: OrmModel,
  from: string,
  to: string,
): RenameResult; // WS5
export function renameInProject(
  project: OrmProject,
  context: string,
  from: string,
  to: string,
): RenameResult; // WS5
```

Changing `iri_base` rewrites no domain file: inside a project, ids are local
names and imports name contexts, so only `iri_base` holds an absolute IRI.
Core forms an IRI; it does not dereference one.

## Alternatives considered

- **Opaque IRIs** (`<namespace>e7f3...`). Stable through a rename, and the
  smallest change. Rejected by the owner: an opaque IRI is a UUID with a
  prefix, and keeps the property this spec removes, that the identifier
  means nothing to a reader or a second tool.
- **Full IRIs in every reference.** Thousands of repetitions of one
  namespace, and a base change rewrites every line. Relative names with one
  declaration are how XML and Turtle do it.
- **Imports instead of shadows.** A split domain would hold only
  `billing:Invoice` references and load the owner's model to resolve them.
  Rejected for now: `OrmModel.addFactType` refuses a player it does not hold,
  and mapping and verbalization read the player's reference mode and kind,
  so every domain would stop loading or mapping on its own.
- **Ossie's `Concept.relationship` for fact types.** decision 2's
  option (b).
- **A category segment** (`object-type/Customer`). Rejected by the owner;
  the suffix rule and decision 4 handle where it would bite.
- **A `renamed_from` list on each element.** A second set of identifiers for
  one element, which is what this spec removes.

## Workstreams (each independently shippable)

WS1, WS2 and WS4 change only what a 3.x file can say, and WS5 adds
operations, so no build before WS6 writes a file a later build cannot migrate; that is the
pattern `orm-format-3.spec.md` used. WS3 was folded into WS6 and ships
nothing of its own. WS5 lands before WS6, so diff
recognizes a rename before any build changes identity on one. WS7 follows.

### 1. The loader reads a minor bump (barwise-jj8)

`OrmYamlSerializer` brings a 3.0 file forward to the current 3.x through the
registered migrations instead of refusing it, and
`docs/adr/schema-versioning.md` says so in place. Without it, the first
minor bump refuses every tracked 3.0 file. No format change.

### 2. One normalizer and the name checks

`localName()` in `core/src/model/name.ts`, exported from core with
`localNameEncodes()`, and three rules in `validation/rules/structural.ts` that preview on 3.x what 4.0 will
do:

- `structural/local-name-collision` (warning): an object type and a fact
  type, or two of one kind whose names differ, with one local name. An
  objectified fact type named like its objectifying type gets its own
  message, which says the migration will rename the fact type (decision 4);
- `structural/duplicate-role-name` (warning): roles of one fact type with
  one local name, reported once per group; a role named `population` on a
  populated fact type takes its population's id (decision 7) and is
  reported as a collision;
- `structural/encoded-local-name` (info): an object type, fact type or role
  name whose local name is more than its whitespace turned to `_`. Information, not a warning, because
  an encoded id is correct, only worth seeing once.

`localName()` applies Unicode NFC first, as RFC 3987 advises, so names
that print alike share an id, and keeps exactly RFC 3987's `ucschar`
beyond ASCII, less the bidirectional formatting characters its section
4.1 bars. No format change. Over the 84 tracked models that load, the rules report
exactly the 22 objectified fact types decision 4 names, and nothing else.
The cross-kind index is the validation rule's own map for now: an
`OrmModel` store that refuses a held local name is WS6's, where ids become
local names and a refusal at construction means something.

### 3. Minted names for unnamed elements (folded into WS6)

Folded into WS6 by the owner on 2026-10-28, after grounding and three plan
review rounds showed that a separate 3.x phase of stored names leaks. It was
designed to mint when a model is saved, through one save function, but the
main editing path -- typing in the YAML editor and saving -- never passes
through barwise's serializer, so files edited that way would never be named;
and merge and split each needed a rule of their own. In 4.0 a minted name is
the element's id, so minting belongs where ids are given, which is WS6's to
design. What the reviews established, for WS6 to start from:

- **Where ids are given is not one place today.** `OrmModel.addConstraint`
  and `FactType` fill an absent constraint id; `ModelElement`'s constructor
  fills a subtype fact's and an objectification's; and importers, the LLM
  parser (`llm/src/parse/constraints.ts`) and the dbt mapping set ids
  themselves with `generateId()`. None of these places has the whole model,
  which minting needs: the verbalization reads players and readings, and a
  fact type's constraints are given ids before it joins a model. Nor should
  minting be a process-wide namer installed the way `setIdGenerator` is:
  that exists because a UUID needs a clock and randomness, and minting is
  pure, so it belongs in core with no installation step, or a caller that
  did not install one would get other ids for the same model. A model-level
  pass after an element joins a model, or a creation API that takes the
  model, are the candidates.
- **The content key for decision 14 is barwise's own, derived from the
  serializer, and stored.** `mintedKey` takes the element's serialized form
  -- the authority on what it states, so ring types, frequency and
  cardinality ranges, value ranges, comparison operators, subset sides and
  subtype-fact operands are in it without being listed again -- drops its id
  and name, and replaces each reference by name: an object type by its name,
  a role by its position in its fact type and that fact type's readings and
  players (what a constraint's sentence is built from, not the fact type's
  name). A subtype fact's key is its two types' names and its defining
  rule; an objectification's, its fact type's key and its object type's
  name. The 4.0 schema stores it as `minted_from` beside the id. It is not
  diff's `constraintKey`, which keeps ids in places (another fact type's
  role, a join path, an unresolved reference), and storing which would make
  every later change to how diff pairs constraints a format change.
- **Nothing is minted from a verbalization that is not of the element:** not
  in a model `graphOf` refuses, where a dangling player reads as its role
  name, and not from the verbalizer's "Malformed:" fallback, which `graphOf`
  does not catch (a role of the wrong fact type). The closing period is
  dropped before `localName()`.
- **`stale-minted-name` is a graph rule**, run only when the graph builds,
  so a dangling reference is reported once, as itself. An id with no stored
  key was written by a person or a tool and is never stale.
- **Merge needs a change.** Today an accepted modification takes the
  incoming side's constraint ids: `addFactTypeToMerged` keeps only the fact
  type's id, and internal constraints pass through with the incoming ids.
  In 4.0 merge keeps the base's id and the base's stored key for an element
  it pairs, so a modification that changed what the element says is
  reported stale by key, as decision 14 chooses, rather than renamed
  silently or judged by its wording.
- **Lineage and diff ignore the stored key**, which is derived.

### 4. Versioned project and mapping files, and namespace declarations (with barwise-y1b)

Grounded 2026-10-28, and merged with barwise-y1b by the owner the same day:
both change the project file's schema, and WS4 cannot ship without y1b, so
they ship as one change.

**The version (barwise-y1b).** `.orm-project.yaml` and `.map.yaml` each gain
a top-level `format_version`, beside `project:` or `mapping:` the way
`orm_version` sits beside `model:`. It is `format_version`, not
`project_version`, because a user reads "project version" as the version of
their own project. Each file kind has its own current version
(`CURRENT_PROJECT_FORMAT_VERSION`, `CURRENT_MAPPING_FORMAT_VERSION`, both
`"1.0"`), and its schema pins the same value as a `const`, so the two
evolve independently, as `orm_version` does. The serializers stamp it on
every file they write (`schema-versioning.md` decision 1). It is optional on
read: a file without it was written before this change and is read as 1.0,
whose schema it already satisfies, because every 1.0 addition is optional.
A file stating a newer version is refused with "written by a newer barwise"
before schema validation; any other version this build cannot reach is
refused naming it. The check is the `.orm.yaml` one: `planMigration` with
the file kind's version and an empty step list, so "newer" and "no path"
mean what they mean for a model, and a future minor registers a step the
same way. The nine tracked project files and twelve mapping files are left
unstamped: they load as 1.0 and are stamped when a surface next writes
them.

What the version does not buy: released v1.7.0 closes both files with
`additionalProperties: false` and reads no version, so it refuses a stamped
file with a schema error, not "newer barwise". That costs nothing extra,
because v1.7.0 already refuses every 3.0 domain file a current project
refers to. Decision 16 holds for every build from this one on.

**The namespace fields.** Optional, and joining 3.0 and project 1.0 while
both are unreleased (owner decision, 2026-10-28):

- `iri_base` on the project: an absolute IRI ending in `/` -- a scheme, a
  colon, no whitespace -- so the project name and context can follow it as
  path segments.
- `namespace` on a model's header: an absolute IRI ending in `/` or `#`, the
  two endings RDF vocabularies use.

The schemas check the shape with one pattern each; core does not
dereference either.

**`namespaceOf(model, project?)`** in `core/src/model/namespace.ts`, pure:

- with a project that declares `iri_base`: `iri_base`, then
  `localName(project.name)`, then `localName(domain.context)`, each followed
  by `/` (`https://data.acme.com/acme/ordering/`). `localName()` is WS2's
  normalizer, so a project named `Acme Corp` contributes `Acme_Corp`, and
  neither segment can hold a `/`;
- otherwise, the model's own `namespace`, or `undefined` (decision 11);
- given a project the model is not a domain of, it throws: that is a caller
  passing the wrong pair, not a model without a namespace.

**One source per domain.** `assembleProject` refuses a domain file that
declares a `namespace` when the manifest declares `iri_base`, reporting it
in `problems` as it reports any domain that fails to load ("declares a
namespace, but the project's iri_base gives it one"), so the domain is not
attached. A project without `iri_base` keeps each domain's own namespace.

**What carries the field.** The `.orm.yaml` serializer reads and writes
`namespace`; `OrmModel` holds it as `namespace?: string` beside
`domainContext`; merge keeps the base's, as it keeps `domainContext`; split
writes new domain headers and does not copy the source's namespace, because
the domains need the project's `iri_base` instead; a source that had one gets
a `SplitResult.warnings` entry saying so, which every surface already prints. The 2.0 reader has
no `namespace` to read. No surface gains a command: the fields are declared
by editing the file, and `namespaceOf` has no caller outside tests until
WS6's `iriOf`.

**Tests**, in core: each serializer stamps its version, reads an unstamped
file, refuses a newer one with "newer barwise" and not a schema message,
and its schema `const` equals its constant; `iri_base` and `namespace`
round-trip and a malformed one fails the schema; `namespaceOf` for each of
its three cases; `assembleProject` reports the double declaration and
attaches neither half of it silently. `schema-versioning.md` is edited in
place: its decisions cover all three file kinds, and the y1b Consequences
bullet becomes the test that checks it.

Imports and `iriOf` wait for WS6, where references become names; in 3.x
they would only hold UUIDs.

### 5. Rename and rename recognition (provisional: not yet grounded)

`renameInModel` and `renameInProject` in core, with the cascade the Scope
states, exposed as `barwise rename`, an MCP tool and an editor command, with
a capability-matrix row in the same PR; `rename` modifies its input, which
among CLI commands only `migrate` does today, so the row says so. Diff and
merge add rename recognition after the name pass, by decision 8. Built on 3.x, where a rename
keeps the UUID, and exercised again on 4.0 by WS6.

### 6. Format 4.0: local names are the ids (provisional: not yet grounded)

The 4.0 schema, the 3.x reader, and `barwise migrate`, which keeps its
`--check` and `--format json` contract and, given a project, migrates its
domains in one run, which also settles a suffixed owner's shadows. Lineage follows the Scope: `migrate` restamps only exports that were fresh,
and an edit-path upgrade reports "ids changed to 4.0".

Every importer builds local names, and an element with no name of its own
takes a minted one, stored with its `minted_from` key, by the mechanism and
rules WS3 records; exporters follow the Inventory;
`canonicalizeIds` goes; merge's clash rule takes the suffix rule; split's
shadows take the owner's `alias:Name` and drop `source_context`;
`cli/tests/importerIds.test.ts` checks the naming rules. The same PR amends
`determinism-in-core.md` decision 4 (identity is assigned from the name at
creation, stored, and changed only by rename) and supersedes
`importer-role-ids.spec.md` R1. It may need the 4a/4b split `orm-format-3`
used, with no release between.

### 7. Migrate the tracked corpus

`barwise migrate` over the 119 tracked `.orm.yaml` files (25 carry UUIDs,
about 5,100 occurrences), the goldens, and the fixtures with hand-written
ids (`ot-customer`, `r-places-order`). `core/tests/helpers/ModelBuilder.ts`,
which builds `<FactType>::role1` ids for 48 test files, moves to local
names.

## API and migration impact

- `@barwise/core` gains `localName`, `namespaceOf`, `iriOf`, `renameInModel`
  and `renameInProject`; `generateId()` stops minting element ids. Every
  downstream package rebuilds; the id-shape tests
  (`core/tests/model/id.test.ts`, `cli/tests/entryIdGenerator.test.ts`,
  `vscode/tests/unit/activateIdGenerator.test.ts`,
  `mcp/tests/serverSpawn.test.ts`) change in WS6.
- An `.orm.yaml` stays 3.x until it is edited or migrated, one file at a
  time; domains of one project may sit at 3.x and 4.0 together.
- `barwise rename` and its MCP tool change the capability matrix and the
  pinned tool lists (`mcp/tests/serverSpawn.test.ts`,
  `vscode/tests/unit/toolRegistration.test.ts`).

## Decisions (resolved by the owner, 2026-10-28)

Each was put to the owner with its options; every recommendation was
accepted. The options stay, so a later reader sees what was weighed.

1. **An outside IRI such as `foaf:Agent`.** (a) barwise's identity is always
   its own, and an optional `equivalent_iri` states that the element means
   the outside one, as `owl:equivalentClass` does; an Ossie export writes
   `equivalent_iri` into Ossie's `iri` when present, and the identity IRI
   otherwise. (b) an element may take the outside IRI as its identity, as
   Ossie allows; one field, but it breaks the namespace rule, and two
   domains reusing `foaf:Agent` collide in one project. **Decided: (a)**:
   the field is a statement about the element, not a second way to find it.
2. **A fact type's local name.** (a) its own name, normalized:
   `Customer_places_Order`. (b) Ossie's `Concept.relationship`, which needs a
   rule for which player owns a fact type; 363 roles in the corpus collide on
   `<player>.<role name>` across fact types (two `SalesOrder.has` in
   `examples/getting-started/shop.orm.yaml`). **Decided: (a).**
3. **Normalization.** (a) keep case, replace each run of whitespace with
   `_`, and percent-encode `:`, `.`, `/`, `#`, `?`, `%` and anything else an
   IRI path segment cannot hold, so a local name never reads as an alias or
   a role separator. (b) PascalCase-join (`CustomerPlacesOrder`), which reads
   worse and collides more. **Decided: (a).** A minted name with a
   defining rule (`... defined as: ...`) is then encoded, not parsed.
4. **An objectified fact type named like its object type.** 22 fact types in
   the corpus share their objectifying type's name (11 in
   `docs/auction.orm.yaml`, 11 in `examples/auction-project/`), from NORMA's
   convention. (a) the migration renames the fact type to its first reading,
   which is unique and readable. (b) the pair shares one id, since ORM treats
   them as one thing, at the cost of an exception to the cross-kind index.
   **Decided: (a).**
5. **Two roles of one fact type with the same role name.** Required, but
   unique nowhere today. (a) the suffix rule (`.has`, `.has_2`). (b) refuse,
   and make the author rename one. **Decided: (a) for the migration and (b)
   for new authoring**, which WS2's warning prepares.
6. **Minted names that are long.** A constraint's local name is a sentence
   (`Each_Person_either_drives_some_Car_or_rides_some_Bus_but_not_both`).
   **Decided: keep it whole**, as the owner chose: truncation collides.
   Recorded so the length is a decision, not a surprise.
7. **Populations and fact instances.** (a) a population's local name is its
   fact type's local name plus `.population`, under the suffix rule; a fact
   instance keeps an `id`, its population's local name plus the next number
   that population has not used (`.1`, `.2`), never reused, because six
   population rules, the editor's source map and the NORMA population
   mapping key on it. (b) fact instances drop their id and every one of
   those sites moves to positions. **Decided: (a).**
8. **How diff recognizes a rename.** (a) after the id and name passes, pair
   the rest by content (same kind, roles, players and constraints) and
   report a pair whose names differ as a rename. (b) report a rename only
   when told (`--rename old=new`). **Decided: (a) for diff**, with (b) as the override for an edit that
   renamed and changed content at once, **and never for merge**: a content
   pair can be two different entity types of one shape (a transcript's new
   `Supplier` beside the base's `Vendor`), so merge adds it and diff reports
   it as a possible rename. The pass runs last, on what the name pass left.
9. **A moved element.** Split and a move between domains change an IRI. (a)
   no forwarding record; the old IRI is in git history. (b) a project-level
   table of moved IRIs. **Decided: (a)** until a consumer outside the
   project needs (b).
10. **The metamodel-evolution filters.** Identity is metadata, not a
    construct, so _verbalizable_ does not apply; it is inline and local, and
    more deterministic than today. It fails _bounded cost_, whose budget is a
    shared minor bump: this is a major. **Decided: accepting the major
    knowingly**, as `orm-format-3` did, and saying so in the release notes.
11. **A model with no namespace.** (a) allowed: its ids are local names, and
    `iriOf` returns nothing until a namespace is declared; exporting to Ossie
    or RDF asks for one. (b) every 4.0 file must declare one, so an import or
    a new model must be told one. **Decided: (a)**: a quick transcript import
    should not need a domain name.
12. **NORMA ids.** NORMA accepts any unique token as an id
    (`formats/src/norma/normaId.ts`), and today barwise keeps a NORMA file's
    own ids across a round trip. (a) export derives each id from the local
    name with `derivedId`, so one model exports the same ids however it was
    loaded, and a NORMA round trip gets new ids. (b) store the source GUID
    in a `norma_id` field, which is a second identifier. (c) write `_` plus
    the local name, which reads well but must pass NORMA's id syntax for
    every encoded name. **Decided: (a)**; ground (c) before WS6.
13. **Does `name` stay beside `id`?** (a) yes: `name` is the display text
    (`Customer places Order`, with its spaces and case), `id` is
    `localName(name)` at creation, and an edit to `name` that is not a
    rename leaves them apart, which validation reports and rename repairs.
    (b) no: `name` is dropped and read back from the id, which loses the
    difference between `Customer Account` and `Customer_Account` and prints
    an encoded name wherever a name is shown. **Decided: (a).**
14. **When a minted name counts as stale.** (a) when its text differs from
    the current verbalization, which also fires on every constraint after a
    release changes the verbalizer's wording. (b) when the element's content
    -- kind, roles, values -- differs from what it was minted from, which
    needs a stored content key and ignores wording changes. (c) never; a
    minted name is a name. **Decided: (b).**
15. **Lineage across the format change.** (a) a 3.x manifest reads stale
    once, with the reason named, and a re-export or `migrate` restamps it.
    (b) keep `canonicalizeIds` in 4.0, fixed to replace only `id` values and
    reference fields, so a 3.x hash and a 4.0 hash of one model agree and
    nothing reads stale. (b) is quieter but keeps code whose reason the
    format removes. **Decided: (a).**
16. **The project file and older builds.** (a) do barwise-y1b first, so the
    project file carries a version and an older build refuses `iri_base`
    with "written by a newer barwise" instead of a schema error. (b) ship
    `iri_base` unversioned and name the break in the release notes.
    **Decided: (a).**

## Risks and testing

- **A rename that misses a reference** leaves a dangling id in another file.
  WS5's tests rename each element kind inside a split project and validate
  every domain, mapping and manifest, not only the renamed model.
- **The migration renames something a person relies on.** Every suffix and
  rename it adds is reported; `migrate --check` shows them before writing.
- **A content pass pairs the wrong elements.** It runs after the id and name
  passes, on what they left; WS5's tests include two entity types of one
  shape, one removed and one added under new names, in diff and in merge.
- Run the full monorepo build and tests after each workstream; WS6 changes
  core's public API.

## Non-goals

- No change to verbalization, validation semantics or mapping output beyond
  the identifiers they print.
- No RDF or OWL export, and no publishing of IRIs.
- No subprojects, and no IRI for a data product.
- No change to how transcript samples are compared.
