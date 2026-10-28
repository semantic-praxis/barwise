# IRI identity: readable names replace UUIDs (format 4.0)

Status: Draft -- no workstream implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-wcg
Touches: barwise/packages/core/src/model/,
barwise/packages/core/src/serialization/,
barwise/packages/core/schemas/,
barwise/packages/core/src/validation/,
barwise/packages/core/src/verbalization/,
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
barwise/docs/specs/importer-role-ids.spec.md

Every barwise element gets one identifier, a readable IRI built from
names, in place of the random UUID it carries today. A file stores each
element's local name -- `Customer`, `Customer_places_Order.places` -- and
declares its namespace once; the full IRI is the namespace plus the local
name. That is the change: identity becomes something a person can read and
a second tool can rebuild, and the random number that only barwise
understood goes away. It is a structural change to `.orm.yaml`, so it ships
as format 4.0 with a migration, after three workstreams that each land
alone and keep 3.x files lossless.

## Principle

**Determinism in core.** Today the same input imported twice yields two
models that differ in every id, because `generateId()` returns a random
UUID (`core/src/model/id.ts`) and every importer calls it
(`importer-role-ids.spec.md`, R1). Diff and merge recover by falling back
to names and content (`core/src/diff/identity.ts`, `pairElements`). An id
built from the element's name is a function of the input: the same model
gets the same identity wherever it is built. Core already derives an id
from content where it must (`serialization/derivedId.ts`); this spec makes
that the rule rather than the exception.

**Explicit over implicit.** A model declares its namespace, and declares
each other namespace it refers to as an import with an alias, the way XML
namespace prefixes work. A reference into another domain is then visible in
the file that makes it. Today `split` copies a shadow object type into each
domain that uses it, with the owner's UUID, so one id sits in several files
and nothing in the file says which copy is the owner except a free-text
`source_context` (`core/src/project/splitModel.ts:341-360`).

**Composability.** A standard IRI is what RDF and OWL tools, Apache Ossie
(`docs/adr/ossie-interchange.md`, decision 5) and a future linked-data export
read. A UUID is not.

## Is a readable name stable enough to be an identity? (resolved: yes, with an explicit rename)

The owner chose readable IRIs over opaque ones (2026-10-28), and the code
supports it once rename is an operation instead of an edit. A name is
already unique where it is used: object type names per model
(`OrmModel.ts:202-206`, `structural/duplicate-object-type-name`) and fact
type names per model (`OrmModel.ts:534-538`). What a readable identity
costs is that renaming an element changes its IRI, and today a rename is a
text edit. So rename becomes an operation that rewrites every reference
(WS5), and diff reports a rename it can recognize instead of a removal and
an addition (Open decision 8). An opaque IRI would avoid that cost and keep
everything else this spec proposes; it is recorded under Alternatives.

## Scope

In scope:

- When a model is saved as 4.0, the system shall store each element's local
  name as its `id`, and every reference to an element in the same namespace
  as that local name.
- When a model declares a namespace, the system shall form each element's
  IRI as the namespace followed by its local name, and shall expose it as
  `iriOf(element)`; a model with no declared namespace has local names only,
  which are valid relative IRIs (Open decision 11).
- When a model in a project is loaded, the system shall take its namespace
  from the project's declared base, the project name, and the domain's
  context name, in that order, most general first. A standalone model
  declares its namespace in its header.
- When a model refers to an element of another namespace, the system shall
  require an entry in the model's `imports` map binding an alias to that
  namespace, and shall store the reference as `alias:LocalName`. An
  undeclared alias is a validation error.
- When an element is created, its local name shall be:
  - an object type's name;
  - a fact type's name (Open decision 2);
  - a role's fact type local name, a dot, and its role name, else its
    player's name (Open decision 5);
  - for an element with no name of its own -- a constraint, a subtype fact,
    an objectification -- a stored name minted from its canonical
    verbalization when it is created (owner decision, 2026-10-28);
  - for a population, the rule in Open decision 7. A fact instance has no
    IRI.
- When a name becomes a local name, the system shall normalize it by one
  function, `localName()` in core (Open decision 3), and shall refuse a
  model in which two elements normalize to the same local name.
- When an element's stored minted name no longer matches its current
  verbalization, validation shall report it as a warning naming the current
  verbalization, and the rename operation shall offer it. The name never
  changes on its own.
- When the user renames an element through `barwise rename`, an MCP tool
  or an editor command, the system shall change its local name and
  rewrite every reference to it in the model, its population rows, its
  diagram layouts, and the project's mappings, in one operation.
- When a 3.x file is loaded, the system shall read it through the 3.x
  reader, assign local names by the rules above, rewrite its references,
  and report each name it had to make unique; `barwise migrate` writes the
  result as 4.0.
- When a model is exported to a format that needs opaque ids (NORMA XML),
  the exporter shall derive them from the IRI with `derivedId`, so the same
  model exports the same ids.

Out of scope:

- **Subprojects.** barwise has none: a project holds a flat list of domains
  (`OrmProject.ts`, `domains`). The namespace grammar leaves room for them
  between project and domain; adding them is its own decision.
- **Data products.** Element IRIs never include a product
  (`ossie-interchange.md`, decision 5). A product's own IRI is deferred.
- **An outside vocabulary's IRI** (`foaf:Agent`) beyond the field Open
  decision 1 chooses. Mapping barwise to OWL or RDF is a later export.
- **Publishing or dereferencing IRIs.** barwise forms them; it does not
  serve them.

## Inventory

Grounded on main at `ca83b642` by a full read of id use across the
workspace.

| Area                                                                        | Current state                                                                                                                                              | Verdict                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `core/src/model/id.ts`                                                      | `generateId()` (v4, or v7 when a surface installs it); `createUuidv7Generator`                                                                             | element ids stop using it (WS4); kept for anything that is not an element, or retired         |
| element ids                                                                 | object type, fact type, role, every constraint, subtype fact, objectification, population, fact instance; schema requires each, no pattern                 | become local names (WS4); fact instance loses its id                                          |
| `SubtypeFact`, `ObjectifiedFactType` names                                  | synthetic, built from ids (`subtype:<sub>:<super>`)                                                                                                        | replaced by minted names (WS2)                                                                |
| name rules                                                                  | object type and fact type names unique per model, in separate namespaces; role names have no rule; no character rule (`model/name.ts`)                     | one local-name namespace per model; role names unique within a fact type; `localName()` (WS1) |
| `serialization/` and `schemas/orm-model.schema.json`                        | 3.0, one file per element kind; 2.0 read by `readDocument20`                                                                                               | 4.0 schema, a 3.x reader, `migrate` (WS4)                                                     |
| `diff/identity.ts`, `elementDiff.ts`, `ModelMerge.ts`                       | pair by id, then name or content; merge mints `mergedId` on a clash                                                                                        | pair by IRI, then content; report renames (WS5)                                               |
| `project/splitModel.ts`                                                     | copies shadow object types with the owner's id; drops cross-domain constraints                                                                             | writes an import and `alias:Name` references instead of shadows (WS5)                         |
| `EntityMapping`, `OrmProject.parseQualifiedRef`                             | name-based, `context:Name` split on the first colon                                                                                                        | `context:Name` becomes `alias:Name` through imports (WS3)                                     |
| `lineage/`                                                                  | stores `elementId` and `elementName`; `hashModel` replaces every string equal to an id                                                                     | ids become IRIs; every manifest hash changes once (WS4)                                       |
| `Population` rows                                                           | keyed by role id                                                                                                                                           | re-keyed by role local name in the migration (WS4)                                            |
| `DiagramLayout`                                                             | positions keyed by element id, inside `.orm.yaml`                                                                                                          | re-keyed in the migration (WS4)                                                               |
| importers (`formats`, `dbt`, `llm`, code-analysis)                          | call `generateId()`; NORMA keeps source ids; `cli/tests/importerIds.test.ts` requires minted ids                                                           | build local names; the test checks names instead (WS4)                                        |
| exporters                                                                   | NORMA writes `_<id>`; DDL comments name `(<id>)`; Ossie's loss block names ids; SVG `data-id`                                                              | NORMA derives GUIDs from IRIs; the rest write IRIs or local names (WS4)                       |
| surfaces                                                                    | MCP `impact_analysis` and `barwise lineage impact` take an id; diagnostics, verbalization, describe and query return ids; VS Code maps by the `id:` scalar | unchanged in shape; values become local names, and `barwise rename` is new (WS4, WS5)         |
| `docs/adr/determinism-in-core.md` (decision 4), `importer-role-ids.spec.md` | ids minted only at creation; importers never build ids from names                                                                                          | amended in WS4's PR                                                                           |

Verbalization needs no change: it is deterministic and gives one sentence
per constraint, subtype fact and objectification (`Verbalizer.ts:188-243`,
`ConstraintVerbalizer`), which is what WS2 mints from. VS Code's source map
and completion keep working because the field stays `id`.

## Target architecture

```
.orm-project.yaml                  .orm.yaml (a domain, 4.0)
  project:                           orm_version: "4.0"
    name: acme                       model:
    iri_base: https://data.acme.com/   name: Ordering
    domains:                           imports:
      - path: domains/ordering.orm.yaml  billing: https://data.acme.com/acme/billing/
        context: ordering              object_types:
                                         - id: Customer
                                         - id: Order
                                       fact_types:
                                         - id: Customer_places_Order
                                           roles:
                                             - id: Customer_places_Order.places
                                               player: Customer
                                             - id: Customer_places_Order.is_placed_by
                                               player: Order
                                           internal_constraints:
                                             - id: Each_Order_is_placed_by_at_most_one_Customer
                                         - id: Order_is_billed_as_Invoice
                                           roles:
                                             - player: billing:Invoice

namespace(model) = iri_base + project + "/" + context + "/"
               = https://data.acme.com/acme/ordering/
iriOf(Customer)  = https://data.acme.com/acme/ordering/Customer
```

```ts
// @barwise/core
export function localName(name: string): string; // the one normalizer (WS1)
export function namespaceOf(model: OrmModel): string | undefined; // WS3
export function iriOf(model: OrmModel, localId: string): string; // WS3
export function resolveReference(model: OrmModel, ref: string): {
  readonly namespace: string | undefined;
  readonly localName: string;
}; // `alias:Name` or a bare local name (WS3)
export function renameElement(
  model: OrmModel,
  from: string,
  to: string,
): RenameResult; // WS5
```

The file stores relative identifiers, so the namespace is written once and
a model can move to another base without rewriting a line. Core forms the
IRI; it does not dereference it.

## Alternatives considered

- **Opaque IRIs** (`<namespace>e7f3...`). Stable through a rename, and the
  smallest code change, since only the prefix is new. Rejected by the owner
  for readable names: an opaque IRI is a UUID with a prefix, and it carries
  forward the property this spec removes, that the identifier means nothing
  to a reader or a second tool.
- **Full IRIs in every reference.** Each `player:` and role reference would
  spell out `https://data.acme.com/acme/ordering/Customer`. Rejected:
  thousands of repetitions of one namespace, and a base change rewrites every
  line. Relative names with one declaration are how XML and Turtle do it.
- **Ossie's `Concept.relationship` for fact types.** A fact type would be
  named under the player of one of its roles (`Customer.places`). barwise
  fact types belong to no concept, and the corpus shows the cost: 363 roles
  collide on `<player>.<role name>` across fact types (two `SalesOrder.has`
  in `examples/getting-started/shop.orm.yaml`). Kept as an option in Open
  decision 2.
- **A category segment** (`object-type/Customer`). Would keep object type
  and fact type names in separate namespaces, as today. Rejected by the
  owner; Open decision 4 handles the one place it bites.
- **A `renamed_from` list on each element.** Diff would follow it across a
  rename. Rejected: it is a second set of identifiers for one element,
  which is what this spec removes.

## Workstreams (each independently shippable)

WS1 to WS3 change what a 3.x file can say without loss, so no build between
them writes a file that cannot be migrated -- the pattern
`orm-format-3.spec.md` used. WS4 is the format change and its migration, in
one workstream, for the same reason. WS5 and WS6 follow it.

### 1. One normalizer and the name rules

`localName()` in `core/src/model/name.ts`, and three validation rules,
reported as warnings on 3.x and refused in 4.0:

- an object type and a fact type whose local names are equal (Open
  decision 4);
- two roles of one fact type with the same role name (none today in
  `docs/auction.orm.yaml`; the rule makes it a guarantee);
- two elements whose names differ but whose local names are equal.

No format change. It tells every existing model what WS4's migration will
have to rename.

### 2. Minted names for unnamed elements (3.1) (provisional: not yet grounded)

An optional `name` on constraints, subtype facts and objectifications, set
from the canonical verbalization when the element is created, through
`localName()`. Validation warns when a stored name no longer matches the
current verbalization. An additive field, so a minor version, 3.1
(`docs/adr/schema-versioning.md`, decision 2). The synthetic
`subtype:<sub>:<super>` and `objectified:<ft>:<ot>` names go. Ground the
importers and the LLM constraint parser, which build these elements
without a creation hook, before building.

### 3. Namespaces and imports (3.1) (provisional: not yet grounded)

`iri_base` on the project, `namespace` on a standalone model's header, and
`imports` on a model, all optional in 3.1. `namespaceOf`, `iriOf` and
`resolveReference` in core. Project references move from `context:Name` to
`alias:Name` through imports, which removes the first-colon split that an
`https:` value would break (`OrmProject.parseQualifiedRef`). The project and
mapping schemas carry no version today (barwise-y1b); ground whether this
workstream needs one first.

### 4. Format 4.0: local names are the ids (provisional: not yet grounded)

The 4.0 schema stores local names in `id` and in every reference. A 3.x
reader assigns them, rewrites references, population rows and layout keys,
and reports every name it had to make unique; `barwise migrate` writes 4.0
with the `--check` and `--format json` contract it already has. Every
importer builds local names; NORMA and the other exporters follow the
Inventory; `cli/tests/importerIds.test.ts` checks names instead of minted
ids. The same PR amends `determinism-in-core.md` decision 4 (identity is
assigned from the name at creation, stored, and changed only by rename) and
supersedes `importer-role-ids.spec.md` R1. Large enough that it may need the
4a/4b split `orm-format-3` used: core and the serializer first, then the
importers, exporters and surfaces, with no release between.

### 5. Rename, diff and split (provisional: not yet grounded)

`renameElement` in core, exposed as `barwise rename`, an MCP tool and an
editor command, with a capability-matrix row in the same PR. `rename`
modifies its input, which today only `migrate` does among CLI commands, so
the row says so. Diff pairs
by IRI, then by content, and reports a recognized rename. Split writes an
import and `alias:Name` references instead of shadow copies, and records a
moved element's new IRI in its output.

### 6. Migrate the tracked corpus

`barwise migrate` over the 119 tracked `.orm.yaml` files (25 carry UUIDs,
about 5,100 occurrences), the goldens, and the fixtures with hand-written
ids (`ot-customer`, `r-places-order`). `core/tests/helpers/ModelBuilder.ts`,
which builds `<FactType>::role1` ids for 48 test files, moves to local
names.

## API and migration impact

- `@barwise/core` gains `localName`, `namespaceOf`, `iriOf`,
  `resolveReference` and `renameElement`; `generateId()` stops minting
  element ids. Every downstream package rebuilds; the id-shape tests
  (`core/tests/model/id.test.ts`, `cli/tests/entryIdGenerator.test.ts`,
  `vscode/tests/unit/activateIdGenerator.test.ts`,
  `mcp/tests/serverSpawn.test.ts`) change with WS4.
- Every `.orm.yaml` on disk is 3.x until it is edited or migrated; 4.0
  reads it (`schema-versioning.md`, decision 4). barwise-jj8 (a version
  between two majors is refused) must be fixed first, or a 3.1 file from
  WS2 cannot load in a 4.0 build.
- Every lineage manifest hash changes once, so every tracked export reads
  as stale once after WS4.
- A new CLI command (`rename`) and MCP tool change the capability matrix
  and the pinned tool lists (`mcp/tests/serverSpawn.test.ts`,
  `vscode/tests/unit/toolRegistration.test.ts`).

## Open decisions (for review)

1. **An outside IRI such as `foaf:Agent`.** (a) barwise's identity is always
   its own IRI, and an optional `equivalent_iri` field states that the
   element means the outside one, the way `owl:equivalentClass` does; an
   Ossie export writes `equivalent_iri` into Ossie's `iri` when present and
   the identity IRI otherwise. (b) an element may take the outside IRI as
   its identity, as Ossie allows. (b) keeps one field but breaks the
   namespace rule, and two domains reusing `foaf:Agent` collide in one
   project. **Recommend (a)**: the second field is a statement about the
   element, not a second way to find it.
2. **A fact type's local name.** (a) its own name, normalized:
   `Customer_places_Order`. (b) Ossie's `Concept.relationship`, which needs
   a rule for which player owns a fact type and collides 363 times in the
   corpus. **Recommend (a).**
3. **Normalization.** (a) keep case, replace each run of whitespace with
   `_`, percent-encode what an IRI path segment cannot hold. (b)
   PascalCase-join (`CustomerPlacesOrder`), which reads worse and collides
   more. (c) percent-encode spaces (`Customer%20places%20Order`), which is
   exact but unreadable. **Recommend (a)**, with a collision after
   normalization refused (WS1).
4. **An objectified fact type named like its object type.** 22 fact types
   in the corpus share their objectifying type's name (11 in
   `docs/auction.orm.yaml`, 11 in `examples/auction-project/`), all from
   NORMA's convention. (a) the migration renames the fact type to its first
   reading, which is unique and readable. (b) the pair shares one IRI,
   since ORM treats them as one thing, at the cost of a special case in
   the id map, which refuses a repeated id today (`DuplicateIdError`).
   **Recommend (a).**
5. **A role with no role name, or a repeated one.** (a) the player's name,
   then `_2` for a second role with the same player. (b) a position
   (`.role1`), which reads worse. **Recommend (a).**
6. **Minted names that are long.** A constraint's local name is a sentence
   (`Each_Person_either_drives_some_Car_or_rides_some_Bus_but_not_both`).
   Keep it whole, as the owner chose: truncation collides. Recorded here so
   the length is a decision, not a surprise.
7. **Populations and fact instances.** (a) a population's local name is its
   fact type's local name plus `.sample`, with `_2` for a second; a fact
   instance has no IRI, because nothing refers to one except a diagnostic
   message (`validation/rules/population/ring.ts`), which can use its
   position. (b) mint names like constraints. **Recommend (a).**
8. **Rename and diff.** (a) diff pairs by IRI, then by content (same roles,
   players and constraints), and reports the second kind as a rename. (b)
   diff reports a rename only when told (`--rename old=new`). **Recommend
   (a)**, with (b) as the override when content changed in the same edit.
9. **A moved element.** Split and a move between domains change an IRI. (a)
   no forwarding record; the old IRI is in git history. (b) a project-level
   table of moved IRIs. **Recommend (a)** until a consumer outside the
   project needs (b).
10. **The metamodel-evolution filters.** Identity is metadata, not a
    construct, so _verbalizable_ does not apply; it is inline and local, and
    more deterministic than today. It fails _bounded cost_, whose budget is
    a shared minor bump: this is a major. **Recommend accepting the major
    knowingly**, as `orm-format-3` did, and saying so in the release notes.
11. **A model with no declared namespace.** (a) allowed: its ids are local
    names, valid relative IRIs, and the full IRI exists once a base is
    declared; exporting to Ossie or RDF asks for one. (b) required: every
    4.0 file must declare a base, and an import or a new model must be told
    one. **Recommend (a)**: a quick transcript import should not need a
    domain name, and the namespace is the one thing a project adds.

## Risks and testing

- **A rename that misses a reference** leaves a dangling id. The
  `structural/` reference rules already refuse an unknown player or role
  id; WS5's tests rename each element kind and validate the result clean.
- **The migration renames something a person relies on.** Every name it
  makes unique is reported; `migrate --check` shows them before writing.
- **Two elements normalize to one name** in an existing model. WS1 reports
  it on 3.x before WS4 makes it an error.
- **Multi-sample transcript import.** Name-derived ids coincide across
  samples, where random ones never did, so `"id-first"` pairing now pairs
  them. That is the intended effect; the samples test must show it.
- Run the full monorepo build and tests after each workstream; WS4 changes
  core's public API.

## Non-goals

- No change to verbalization, validation semantics or mapping output beyond
  the identifiers they print.
- No RDF or OWL export, and no publishing of IRIs.
- No subprojects, and no IRI for a data product.
