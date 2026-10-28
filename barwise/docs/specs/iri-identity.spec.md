# IRI identity: readable names replace UUIDs (format 4.0)

Status: Draft -- no workstream implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-wcg
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

Every barwise element gets one identifier, a readable name, in place of the
random UUID it carries today. A file stores each element's local name --
`Customer`, `Customer_places_Order.places` -- and a model's namespace is
declared once, so an element's full IRI is its namespace followed by its
local name. Identity becomes something a person can read and a second tool
can rebuild. It is a structural change to `.orm.yaml`, so it ships as format
4.0 with a migration, after three workstreams that each land alone and keep
3.x files readable and lossless.

## Principle

**Determinism in core.** Today the same input imported twice yields two
models that differ in every id: `generateId()` returns a random UUID
(`core/src/model/id.ts`), every importer calls it
(`importer-role-ids.spec.md`, R1), and code that needs stable output has to
strip ids back out -- `hashModel` replaces each id with its order of
appearance before hashing (`core/src/lineage/manifest.ts`,
`canonicalizeIds`). An id built from the element's name is a function of the
input: the same model gets the same identity wherever it is built, and the
canonicalization step becomes unnecessary.

**Explicit over implicit.** A model declares its namespace, and declares
each other domain it refers to as an import with an alias, the way XML
namespace prefixes work. Today `split` copies a shadow object type into each
domain that uses it with the owner's UUID, so one id sits in several files
and only a free-text `source_context` says which copy is the owner
(`core/src/project/splitModel.ts:341-360`). Under this spec the copy's id is
the owner's qualified name, `billing:Invoice`, and the import says what
`billing` means.

**Composability.** A standard IRI is what RDF and OWL tools, Apache Ossie
(`docs/adr/ossie-interchange.md`, decision 5) and a future linked-data export
read. A UUID is not.

## Is a readable name stable enough to be an identity? (resolved: yes, with rename as an operation)

Names are already unique where they are used -- object type names per model
(`OrmModel.ts:202-206`) and fact type names per model (`OrmModel.ts:534-538`)
-- so the owner's choice of readable IRIs (2026-10-28) holds, with one
cost: renaming an element changes its identity, and today a rename is a text
edit that keeps the UUID. Under `id-first` diff, "a rename or an edit that
keeps the id is one modification" (`core/src/diff/identity.ts`); with
name-based ids it would read as a removal plus an addition. Two things repay
that cost, and both land before the format change, so no release loses rename
tracking: diff recognizes a rename by content, and rename becomes an
operation that rewrites every reference across the project. Both are WS5,
which lands before the format change in WS6.
An opaque IRI would avoid the cost; it is under Alternatives.

## Scope

In scope:

- When a model is saved as 4.0, the system shall store each element's local
  name as its `id`, and every reference to an element as either a local
  name, for an element of the same model, or `alias:LocalName`, for an
  element of an imported domain.
- When a model belongs to a project, its namespace shall be the project's
  declared `iri_base`, the project name, and the domain's context name, most
  general first (`https://data.acme.com/acme/ordering/`). A standalone model
  may declare a `namespace` in its header; a model inside a project that
  also declares one is refused, so the namespace has one source.
- When a model has no namespace, its ids are still valid relative IRIs, and
  `iriOf` reports the absence instead of inventing a base (Open decision
  11).
- When a model refers to an element of another domain, the model shall
  declare `imports`, each binding an alias to a context name of the same
  project or, outside a project, to an absolute namespace IRI. A reference
  whose alias is not declared is a validation error in 4.0. Mapping files
  keep their `context:Name` references, whose contexts their own
  `source_context` and `target_context` fields already declare.
- When an element is created, its local name shall be given by the rule for
  its kind:
  - object type: its name;
  - fact type: Open decision 2;
  - role: its fact type's local name, a dot, and Open decision 5's rule;
  - constraint, subtype fact, objectification: a name minted once from its
    canonical verbalization and stored (owner decision, 2026-10-28);
  - population and fact instance: Open decision 7.
- When any name becomes a local name, the system shall normalize it with
  one function, `localName()` in core (Open decision 3).
- When two elements of one model, of any kinds, have the same local name,
  the system shall refuse the model in 4.0; `OrmModel` keeps one index
  across element kinds for this, beside its per-kind stores.
- When an element's stored minted name no longer matches its current
  verbalization, validation shall warn, naming the current verbalization.
  The name never changes on its own.
- When the user renames an element through `barwise rename`, an MCP tool or
  an editor command, the system shall change its local name and rewrite
  every reference to it: in its own model, its population rows and diagram
  layouts, the `alias:` references and shadows in the project's other
  domains, the project's mapping files, and its lineage manifests.
- When diff or merge compares two models, it shall pair elements by id,
  then by content, and report a content pairing whose names differ as a
  rename (Open decision 8).
- When a 3.x file is loaded, the system shall read it through the 3.x
  reader, assign local names by the rules above, rewrite references,
  population rows and layout keys, and report each name it had to make
  unique. `barwise migrate` writes the result as 4.0, and also rewrites the
  lineage manifests beside it from the reader's old-to-new id map.

Out of scope:

- **Subprojects.** barwise has none: a project holds a flat list of domains
  (`OrmProject.ts`). The namespace grammar leaves room for them between
  project and domain; adding them is its own decision.
- **Data products.** Element IRIs never include a product
  (`ossie-interchange.md`, decision 5). A product's own IRI is deferred.
- **Mapping to an outside vocabulary** beyond the one field Open decision 1
  chooses. An OWL or RDF export is later work.
- **Publishing or dereferencing IRIs.** barwise forms them; it does not
  serve them.
- **Transcript samples.** Sample agreement and alternative framings diff
  with `matching: "content"` (`llm/src/sampleAgreement.ts`,
  `UNRELATED_IDS_DIFF`) because sample ids "may coincide". Name-based ids
  coincide more often, which that mode already ignores. Whether samples
  should switch to `id-first` is a separate question for the extraction
  lane.

## Inventory

Grounded on main at `ca83b642` by a full read of id use across the
workspace, and corrected by the plan's `/code-review`.

| Area                                                                                        | Current state                                                                                                                                                | Verdict                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `serialization/OrmYamlSerializer.ts`                                                        | brings older files forward only to 2.0, then reads 2.0; a version between 2.0 and 3.0 is refused (barwise-jj8)                                               | must read 3.0 and 3.1 in one build before any minor bump (WS1)                                           |
| `core/src/model/id.ts`                                                                      | `generateId()` (v4, or v7 a surface installs); `createUuidv7Generator`                                                                                       | element ids stop using it (WS6)                                                                          |
| element ids                                                                                 | object type, fact type, role, constraint, subtype fact, objectification, population, fact instance; the schema requires each, with no pattern                | become local names (WS6)                                                                                 |
| `OrmModel` stores                                                                           | one map per kind; `refuseHeldId` checks within a kind, so an object type and a fact type may share an id                                                     | a cross-kind local-name index (WS2 warns, WS6 refuses)                                                   |
| `SubtypeFact`, `ObjectifiedFactType` names                                                  | synthetic, built from ids (`subtype:<sub>:<super>`)                                                                                                          | replaced by minted names (WS3)                                                                           |
| name rules (`model/name.ts`, `validation/rules/structural.ts`)                              | object type and fact type names unique per model in separate namespaces; role names have no rule; no character rule                                          | `localName()` and cross-kind rules (WS2)                                                                 |
| `diff/identity.ts`, `elementDiff.ts`                                                        | pair by id, then name or content; a rename keeps the UUID, so it is one modification                                                                         | pair by id, then content; report renames (WS5)                                                           |
| `diff/ModelMerge.ts`                                                                        | keeps the existing id; `mergedId` derives a UUIDv8 on a clash                                                                                                | a clash takes the next free local name (WS6)                                                             |
| `project/splitModel.ts`                                                                     | shadow object types with the owner's UUID and `source_context`; cross-domain constraints dropped                                                             | shadows keep their data and take the owner's `alias:Name` as id; split writes the import (WS6)           |
| `OrmModel.addFactType`                                                                      | refuses a role whose player is not in the model                                                                                                              | unchanged: a shadow is in the model, so a split domain still loads, maps and verbalizes alone            |
| `EntityMapping`, `OrmProject.parseQualifiedRef`                                             | name-based `context:Name`, split on the first colon                                                                                                          | unchanged; an absolute IRI never appears in a reference, only in `iri_base` and `imports` values         |
| `lineage/manifest.ts`, `impact.ts`                                                          | stores `elementId` and `elementName`; `canonicalizeIds` maps every string equal to an id to `#n`, which would erase names equal to ids; impact matches by id | stores local names; `canonicalizeIds` removed; `migrate` rewrites manifests (WS6)                        |
| `Population` and fact instances                                                             | rows keyed by role id; six population rules, `YamlSourceMap`, NORMA's population mapping and `getInstance`/`removeInstance` use the instance id              | instances keep an `id` (Open decision 7); rows re-keyed by role local name (WS6)                         |
| `DiagramLayout`                                                                             | positions keyed by object type or fact type id in one record                                                                                                 | re-keyed; the cross-kind index keeps the keys distinct (WS6)                                             |
| importers (`formats`, `dbt`, `llm`, code-analysis)                                          | call `generateId()`; NORMA keeps its source ids; `cli/tests/importerIds.test.ts` requires minted ids, exempting NORMA                                        | build local names; the test checks the naming rules (WS6)                                                |
| exporters                                                                                   | NORMA writes `_<id>`; DDL comments name `(<id>)`; Ossie's loss block names ids; SVG writes `data-id`                                                         | NORMA derives its ids from local names (Open decision 12); the rest print local names (WS6)              |
| surfaces                                                                                    | `impact_analysis` and `lineage impact` take an id; diagnostics, verbalization, describe and query return ids; VS Code finds elements by the `id:` scalar     | same fields, local-name values (WS6); `barwise rename` and its MCP tool and editor command are new (WS5) |
| `determinism-in-core.md` decision 4; `importer-role-ids.spec.md` R1; `schema-versioning.md` | ids minted only at creation; importers never build ids from names; the minor-bump rule                                                                       | amended in WS6's PR; `schema-versioning.md` in WS1's                                                     |

Verbalization needs no change: it is deterministic and gives one sentence
per constraint, subtype fact and objectification (`Verbalizer.ts:188-243`,
`ConstraintVerbalizer`), which WS3 mints from. VS Code's source map and
completion keep working because the field stays `id`.

## Target architecture

```
.orm-project.yaml                       domains/ordering.orm.yaml (4.0)
  project:                                orm_version: "4.0"
    name: acme                            model:
    iri_base: https://data.acme.com/        name: Ordering
    domains:                                imports:
      - path: domains/ordering.orm.yaml       billing: billing        # a context name
        context: ordering                   object_types:
      - path: domains/billing.orm.yaml        - id: Customer
        context: billing                      - id: billing:Invoice  # shadow of billing's
                                                kind: entity
                                                reference_mode: nr
                                            fact_types:
                                              - id: Customer_places_Order
                                                roles:
                                                  - id: Customer_places_Order.places
                                                    player: Customer
                                              - id: Order_is_billed_as_Invoice
                                                roles:
                                                  - id: Order_is_billed_as_Invoice.Invoice
                                                    player: billing:Invoice

namespace(ordering)             = https://data.acme.com/acme/ordering/
iriOf(ordering, "Customer")     = https://data.acme.com/acme/ordering/Customer
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
): string | undefined; // WS4
export function renameInProject(
  project: OrmProject,
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
  Rejected for now: `OrmModel.addFactType` refuses a player it does not
  hold, and mapping and verbalization read the player's reference mode and
  kind, so every domain would stop loading or mapping on its own. Keeping
  the shadow and giving it the owner's qualified id makes ownership
  explicit with no change to what a model can do alone.
- **Ossie's `Concept.relationship` for fact types.** Kept as Open decision
  2's option (b).
- **A category segment** (`object-type/Customer`). Rejected by the owner;
  the cross-kind index and Open decision 4 handle where it would bite.
- **A `renamed_from` list on each element.** A second set of identifiers for
  one element, which is what this spec removes.

## Workstreams (each independently shippable)

WS1 to WS4 change what a 3.x file can say without loss, so no build between
them writes a file a later build cannot migrate, which is the pattern
`orm-format-3.spec.md` used. WS5 lands before WS6, so diff recognizes a
rename before any build changes identity on one. WS7 follows.

### 1. The loader reads a minor bump (barwise-jj8)

`OrmYamlSerializer` brings a 3.0 file forward to the current 3.x through the
registered migrations instead of refusing it, and
`docs/adr/schema-versioning.md` says so in place. Without it, the first 3.1
build refuses every tracked 3.0 file. No format change.

### 2. One normalizer and the name rules

`localName()` in `core/src/model/name.ts`, a cross-kind local-name index in
`OrmModel`, and three validation rules, warnings on 3.x:

- two elements of any kinds whose local names are equal (an object type and
  a fact type named alike is Open decision 4's case);
- two roles of one fact type that Open decision 5's rule would name alike;
- a name `localName()` changes beyond whitespace, so a reader sees what the
  migration will store.

No format change. It tells every existing model what WS6's migration will
rename.

### 3. Minted names for unnamed elements (3.1) (provisional: not yet grounded)

An optional `name` on constraints, subtype facts and objectifications, set
from the canonical verbalization through `localName()` when the element is
created, and a staleness warning. An additive field, so a minor version
(`schema-versioning.md`, decision 2), which WS1 makes loadable. The
synthetic `subtype:` and `objectified:` names go. Ground first: the
importers and the LLM constraint parser (`llm/src/parse/constraints.ts`)
build these elements without passing through one creation point.

### 4. Namespaces and imports (3.1) (provisional: not yet grounded)

`iri_base` on the project, `namespace` on a standalone model's header, and
`imports` on a model, all optional in 3.1, with `namespaceOf` and `iriOf` in
core. The project file has no version (barwise-y1b), so an older build may
refuse a project file carrying `iri_base`; decide y1b first, or accept that
and say so in the release notes.

### 5. Rename and rename recognition (provisional: not yet grounded)

`renameInProject` in core, exposed as `barwise rename`, an MCP tool and an
editor command, with a capability-matrix row in the same PR; `rename`
modifies its input, which among CLI commands only `migrate` does today, so
the row says so. Diff and merge pair by content after id and report a
rename. Built on 3.x, where a rename keeps the UUID, and exercised again on
4.0 by WS6.

### 6. Format 4.0: local names are the ids (provisional: not yet grounded)

The 4.0 schema, the 3.x reader, and `barwise migrate` (with its `--check`
and `--format json` contract), including lineage manifests. Every importer
builds local names; exporters follow the Inventory; `canonicalizeIds` goes;
merge's clash rule takes the next free local name; split's shadows take the
owner's `alias:Name`. `cli/tests/importerIds.test.ts` checks the naming
rules instead of minted ids. The same PR amends `determinism-in-core.md`
decision 4 (identity is assigned from the name at creation, stored, and
changed only by rename) and supersedes `importer-role-ids.spec.md` R1. It
may need the 4a/4b split `orm-format-3` used -- core and the serializer,
then importers, exporters and surfaces -- with no release between.

### 7. Migrate the tracked corpus

`barwise migrate` over the 119 tracked `.orm.yaml` files (25 carry UUIDs,
about 5,100 occurrences), the goldens, the lineage manifests, and the
fixtures with hand-written ids (`ot-customer`, `r-places-order`).
`core/tests/helpers/ModelBuilder.ts`, which builds `<FactType>::role1` ids
for 48 test files, moves to local names.

## API and migration impact

- `@barwise/core` gains `localName`, `namespaceOf`, `iriOf` and
  `renameInProject`; `generateId()` stops minting element ids. Every
  downstream package rebuilds; the id-shape tests
  (`core/tests/model/id.test.ts`, `cli/tests/entryIdGenerator.test.ts`,
  `vscode/tests/unit/activateIdGenerator.test.ts`,
  `mcp/tests/serverSpawn.test.ts`) change in WS6.
- Every `.orm.yaml` on disk stays 3.x until it is edited or migrated; 4.0
  reads it (`schema-versioning.md`, decision 4).
- Every lineage manifest hash changes once after WS6, so every tracked
  export reads as stale once, unless `migrate` rewrites the manifest.
- `barwise rename` and its MCP tool change the capability matrix and the
  pinned tool lists (`mcp/tests/serverSpawn.test.ts`,
  `vscode/tests/unit/toolRegistration.test.ts`).
- `barwise history` across a past rename shows a rename, not a removal and
  an addition, because WS5's content pairing reads each revision through
  the 3.x reader.

## Open decisions (for review)

1. **An outside IRI such as `foaf:Agent`.** (a) barwise's identity is always
   its own, and an optional `equivalent_iri` states that the element means
   the outside one, as `owl:equivalentClass` does; an Ossie export writes
   `equivalent_iri` into Ossie's `iri` when present, and the identity IRI
   otherwise. (b) an element may take the outside IRI as its identity, as
   Ossie allows; one field, but it breaks the namespace rule, and two
   domains reusing `foaf:Agent` collide in one project. **Recommend (a)**:
   the field is a statement about the element, not a second way to find it.
2. **A fact type's local name.** (a) its own name, normalized:
   `Customer_places_Order`. (b) Ossie's `Concept.relationship`, which needs a
   rule for which player owns a fact type; 363 roles in the corpus collide
   on `<player>.<role name>` across fact types (two `SalesOrder.has` in
   `examples/getting-started/shop.orm.yaml`). **Recommend (a).**
3. **Normalization.** (a) keep case, replace each run of whitespace with
   `_`, percent-encode what an IRI path segment cannot hold. (b)
   PascalCase-join (`CustomerPlacesOrder`), which reads worse and collides
   more. (c) percent-encode spaces (`Customer%20places%20Order`), exact but
   unreadable. **Recommend (a).**
4. **An objectified fact type named like its object type.** 22 fact types in
   the corpus share their objectifying type's name (11 in
   `docs/auction.orm.yaml`, 11 in `examples/auction-project/`), from NORMA's
   convention. (a) the migration renames the fact type to its first reading,
   which is unique and readable. (b) the pair shares one id, since ORM treats
   them as one thing, at the cost of an exception in the cross-kind index.
   **Recommend (a).**
5. **A role's name within its fact type.** (a) its role name, else its
   player's name, and `_2` for a second role that would take the same name
   (a ring fact type with two `Person` roles and no role names). (b) a
   position (`.role1`), which reads worse and changes if roles are
   reordered. **Recommend (a)**, applied by the migration and by creation;
   WS2's rule reports where (a) has to add a suffix.
6. **Minted names that are long.** A constraint's local name is a sentence
   (`Each_Person_either_drives_some_Car_or_rides_some_Bus_but_not_both`).
   Keep it whole, as the owner chose: truncation collides. Recorded so the
   length is a decision, not a surprise.
7. **Populations and fact instances.** (a) a population's local name is its
   fact type's local name plus `.sample`, `_2` for a second; a fact
   instance keeps an `id`, its population's local name plus its position
   when created (`.1`, `.2`), stored and not renumbered when rows move,
   because six population rules, the editor's source map and the NORMA
   population mapping all key on it. (b) fact instances drop their id and
   every one of those sites moves to positions. **Recommend (a).**
8. **How diff recognizes a rename.** (a) after pairing by id, pair the rest
   by content (same roles, players and constraints) and report a pair whose
   names differ as a rename. (b) report a rename only when told
   (`--rename old=new`). **Recommend (a)**, with (b) as the override for an
   edit that renamed and changed content at once.
9. **A moved element.** Split and a move between domains change an IRI. (a)
   no forwarding record; the old IRI is in git history. (b) a project-level
   table of moved IRIs. **Recommend (a)** until a consumer outside the
   project needs (b).
10. **The metamodel-evolution filters.** Identity is metadata, not a
    construct, so _verbalizable_ does not apply; it is inline and local, and
    more deterministic than today. It fails _bounded cost_, whose budget is a
    shared minor bump: this is a major. **Recommend accepting the major
    knowingly**, as `orm-format-3` did, and saying so in the release notes.
11. **A model with no namespace.** (a) allowed: its ids are local names, and
    the full IRI exists once a namespace is declared; exporting to Ossie or
    RDF asks for one. (b) every 4.0 file must declare one, so an import or a
    new model must be told one. **Recommend (a)**: a quick transcript import
    should not need a domain name.
12. **NORMA ids.** NORMA accepts any unique token as an id
    (`formats/src/norma/normaId.ts`), and today barwise keeps a NORMA file's
    own ids across a round trip. (a) export derives each id from the local
    name with `derivedId`, so one model exports the same ids however it was
    loaded, and a NORMA round trip gets new ids. (b) store the source GUID
    in a `norma_id` field, which is a second identifier. (c) write `_` plus
    the local name, which reads well but must pass NORMA's id syntax for
    every normalized name. **Recommend (a)**; ground (c) before WS6.

## Risks and testing

- **A rename that misses a reference** leaves a dangling id in another file.
  WS5's tests rename each element kind inside a split project and validate
  every domain, mapping and manifest, not only the renamed model.
- **The migration renames something a person relies on.** Every name it
  makes unique is reported; `migrate --check` shows them before writing.
- **Two elements share a local name** in an existing model. WS2 reports it on
  3.x before WS6 refuses it.
- Run the full monorepo build and tests after each workstream; WS6 changes
  core's public API.

## Non-goals

- No change to verbalization, validation semantics or mapping output beyond
  the identifiers they print.
- No RDF or OWL export, and no publishing of IRIs.
- No subprojects, and no IRI for a data product.
- No change to how transcript samples are compared.
