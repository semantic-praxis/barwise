# IRI identity: readable names replace UUIDs (format 4.0)

Status: In progress -- WS1 and WS2 implemented 2026-10-28 (the loader reads a
minor of the current major, barwise-jj8; `localName()` and the name checks);
WS3 folded into WS6; WS4 implemented 2026-10-28 with barwise-y1b (versioned
project and mapping files, `iri_base`, `namespace`, `namespaceOf` and two
project rules); decision 17 taken; WS5 implemented 2026-10-29 (5a: `renameInModel`,
`renameInProject`; 5b: `barwise rename`, MCP `rename_element`, the VS Code
tool); rename recognition moved to WS6; WS6 grounded 2026-10-29 (6a to 6f,
decision 15 amended, decisions 18 to 20); 6a in progress (diff recognizes renames,
merge refuses content and rename pairings, implemented 2026-10-29; the verbalization
interface, `model/mint.ts` and `FactType.addConstraint`'s return, implemented
2026-10-29; the test builders off `::` ids, implemented 2026-10-29); WS7 to come

Created: 2026-10-28
Last-updated: 2026-10-29
Tracking: barwise-wcg, barwise-y1b
Plan-reviewed: 15d6f18e (pr-review x5, code-review x3; re-pointed after WS6 was grounded and decisions 18 to 20 taken)
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
barwise/packages/cli/src/,
barwise/packages/mcp/src/,
barwise/packages/vscode/package.json,
barwise/packages/core/src/rename/,
barwise/packages/core/src/mapping/,
barwise/packages/core/package.json,
barwise/packages/core/CLAUDE.md,
barwise/tsconfig.depcruise.json,
barwise/docs/CLI.md,
barwise/docs/MCP.md,
barwise/packages/cli/CLAUDE.md,
barwise/packages/mcp/CLAUDE.md,
barwise/parity.manifest.json,
barwise/packages/cli/tests/,
barwise/packages/mcp/tests/,
barwise/packages/vscode/tests/unit/,
CLAUDE.md,
barwise/docs/adr/determinism-in-core.md,
barwise/docs/adr/schema-versioning.md,
barwise/docs/adr/ossie-interchange.md,
barwise/docs/specs/importer-role-ids.spec.md,
barwise/examples/auction-project/,
barwise/packages/cli/tests/fixtures/project/,
barwise/packages/core/tests/integration/fixtures/multi-domain/,
barwise/packages/mcp/tests/fixtures/project/,
barwise/packages/vscode/tests/fixtures/project.orm-project.yaml,
barwise/packages/promptlab/src/,
barwise/packages/diagram-ui/src/,
barwise/packages/core/tests/,
barwise/packages/formats/tests/,
barwise/packages/dbt/tests/,
barwise/packages/diagram/tests/,
barwise/packages/learn/tests/,
barwise/packages/diagram-ui/tests/,
barwise/packages/promptlab/tests/,
barwise/packages/code-analysis/tests/

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
mechanisms repay it: a rename operation that rewrites every reference
across the project (WS5, before the format change), and a diff that reports
a rename it can recognize (WS6's 6a, on 3.x before the format change, where
it already serves two models whose ids are unrelated). An opaque IRI would avoid the
cost; it is under Alternatives.

## Scope

In scope:

- When a model is saved as 4.0, the system shall store each element's
  local name as its `id`, and every reference to an element as either its
  local name, for an element of the same model, or `alias:LocalName`, for
  an element of an imported domain. `alias:LocalName` is a QName, as in
  Ossie's `prefixes` and XML, not a relative IRI; `iriOf` expands it.
- When a model belongs to a project that declares `iri_base`, its namespace
  shall be that `iri_base`, which carries the base and the project segments,
  followed by the domain's context name, most general first
  (`https://data.acme.com/acme/ordering/`). Any other model may declare a
  `namespace` in its header; a domain that declares one in a project with
  `iri_base` is reported as an error and the project's namespace wins, so
  the namespace has one source (WS4). A model with no namespace is decision
  11.
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
  except where decision 5 refuses instead. Decision 4 gives an objectified
  fact type its own id before any suffix applies (decision 20). A stated id always
  wins over a minted name, and the order is a function of the input, so two
  builds of one input agree; WS6 grounds the mechanism (decision 17).
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
- When diff compares two models, it shall pair elements by id, then by
  name, as today, and then recognize renames by the rule decision 8
  chooses; merge never pairs by content (decision 8).
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
  file cannot see is an owner whose local name took a suffix. The shadow's
  id then names whichever owner element holds the unsuffixed local name,
  which exists, because that is why the suffix was taken, so it resolves
  to the wrong element rather than to nothing. A 4.0 project load
  therefore compares each shadow's `name` with its resolved owner's
  `name` and reports a mismatch naming the owner, and `barwise migrate`
  given the project fixes both sides. The check also fires when the
  owner's `name` was edited without a rename (decision 13(a)), where the
  alias binds correctly; that is accepted, because the shadow's copy of
  the name is then stale too.
- When a 4.0 build checks lineage against an export written under 3.x ids,
  which the manifest's version marks, it shall report the export as stale
  with the reason "ids changed to 4.0" rather than as an ordinary change,
  and impact analysis shall say that export predates 4.0 instead of
  returning nothing. A re-export restamps it; `barwise migrate` does not
  (decision 15 as amended).

Out of scope:

- **Subprojects.** barwise has none: a project holds a flat list of domains
  (`OrmProject.ts`). In an IRI a subproject is one more segment of the
  project's declared `iri_base` (WS4), so the namespace needs no field for
  one; subprojects as a project structure are their own decision.
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
| `diff/identity.ts`, `elementDiff.ts`                                | pair by id, then by name or content key; the name pass keeps a transcript import working against its base                                                                                                       | a content pass after the name pass, reporting renames (WS6)                                                                                      |
| `diff/ModelMerge.ts`                                                | keeps the existing id; `mergedId` derives a UUIDv8 on a clash                                                                                                                                                   | a clash takes the suffix rule (WS6)                                                                                                              |
| `project/splitModel.ts`                                             | shadow object types carry the owner's UUID and `source_context`; cross-domain constraints dropped                                                                                                               | shadows keep their data, take the owner's `alias:Name` as id, drop `source_context`; split writes imports (WS6)                                  |
| other `source_context` readers                                      | `mcp/src/tools/split.ts` tells shadows from owned types by it; diff has a `sourceContext` change kind (`breakingLevel.ts`); standalone files set it by hand (`trial/customers/C04-marketplace/kernel.orm.yaml`) | read the alias prefix of the id instead; a standalone file's alias binds to the context name and stays unresolved until a project loads it (WS6) |
| `OrmModel.addFactType`                                              | refuses a role whose player is not in the model                                                                                                                                                                 | unchanged: the shadow is in the model, so a split domain still loads, maps and verbalizes alone                                                  |
| `EntityMapping`, `OrmProject.parseQualifiedRef`                     | `context:Name`, split on the first colon                                                                                                                                                                        | unchanged; `localName()` never emits `:`, and absolute IRIs appear only in `iri_base`, `namespace` and `imports`                                 |
| `lineage/manifest.ts`, `impact.ts`                                  | per-directory `.barwise/lineage.yaml` with `elementId` and a `modelHash`; `canonicalizeIds` maps every string equal to an id to `#n`; impact matches by id                                                      | `canonicalizeIds` removed; manifest version 2; exports name their model (6a) and are marked per export when written under 3.x ids (6e)           |
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
    iri_base: https://data.acme.com/acme/   name: Ordering
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
export interface DomainRef {
  readonly iriBase?: string; // the project's
  readonly context: string;
}
export function namespaceOf(
  model: OrmModel | undefined,
  domain?: DomainRef,
): string | undefined; // WS4
export function iriOf(
  model: OrmModel,
  id: string,
  domain?: { readonly project: OrmProject; readonly context: string; },
): string | undefined; // WS6
export function renameInModel(
  model: OrmModel,
  target: RenameTarget,
  to: string,
): RenameResult; // WS5
export function renameInProject(
  project: OrmProject,
  context: string,
  target: RenameTarget,
  to: string,
): ProjectRenameResult; // WS5
```

Changing `iri_base` rewrites no domain file: inside a project that declares
it, ids are local names and imports name contexts, so only `iri_base` holds
an absolute IRI. In a project without it, each domain's own `namespace`
does, which is why `iriOf` takes the project: it expands `billing:Invoice`
from the billing domain's namespace.
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
nothing of its own. WS5, the rename operation, lands before WS6;
diff's rename recognition (decision 8) ships first, in WS6's 6a on 3.x, so no
build changes identity before diff recognizes a rename. WS7 follows.

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
  model, were the candidates; decision 17 chose minting when an element
  joins the model.
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
they ship as one change. Decision 16 records what the merge gives up.

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

A stated version goes through `planRead`, the `.orm.yaml` planner since
barwise-jj8, given the file kind's own versions: current `"1.0"`, no earlier
major (its `legacy` is its current major's first), no steps. So a newer
version is refused with "written by a newer barwise" before schema
validation, and "unknown" means what it means for a model. "unregistered"
keeps its meaning too, but cannot occur at 1.0 with no steps; it first
becomes reachable at a 1.1 whose 1.0 step was not registered. The advice text for each reason moves from `OrmYamlSerializer`'s
`versionErrorMessage` to `schemaVersion.ts`, so the three file kinds give
one answer per reason. No step exists for either kind, and
`OrmVersionMigration`'s contract names `orm_version`; the step shape for
these kinds is decided by their first minor, not here.

This change stamps the nine tracked project files and twelve mapping files
with `format_version: "1.0"`, because no surface rewrites an existing one --
`project init` and `split` only create files, and `barwise migrate` takes
only `.orm.yaml` -- so an unstamped file would otherwise stay unstamped.
`schema-versioning.md` decision 4 (write back on edit, or `migrate`) stays
about `.orm.yaml`; for the other two kinds it says an unstamped file is
read as 1.0 and that `migrate` gains them with their first step.

**The namespace fields.** Optional, and joining 3.0 and project 1.0 while
both are unreleased (owner decision, 2026-10-28):

- `iri_base` on the project: an absolute IRI ending in `/` -- a scheme, a
  colon, no whitespace. It carries the base **and the project segments**
  (`https://data.acme.com/acme/`, or `https://data.acme.com/acme/sales/`
  for a subproject), so the project's display `name` is not part of any
  IRI. Building the project segment from `localName(project.name)` was the
  first plan, and plan review rejected it: project names are labels
  (`Auction Semantic Model`), nothing stored refers to them, so editing one
  would re-identify every element from WS6 on and no rename could repair
  it. Declaring the segment keeps the owner's order -- base, project, any
  subprojects, domain, most general first -- and leaves subprojects needing
  no field of their own.
- `namespace` on a model's header: an absolute IRI ending in `/` or `#`, the
  two endings RDF vocabularies use.

The schemas check the shape with one pattern each, and core holds the same
two patterns (`IRI_BASE_PATTERN`, `NAMESPACE_PATTERN` in `model/iri.ts`,
drift-tested against the schemas) and refuses a value that fails them where
it is set, so a model or project in memory can always be saved and
reopened. Core does not dereference either. `OrmProjectConfig` and `OrmProject` gain `iriBase`, and
`ProjectSerializer`'s document type, `buildProject` and `serialize` each
carry it, because each lists its fields explicitly and a field one of them
leaves out is silently dropped (barwise-937's lesson, one file over).

**`namespaceOf(model, domain?)`** in `core/src/model/namespace.ts`, pure,
where `model` may be `undefined` and `domain` is a `DomainRef`, `{ iriBase?: string; context: string }`,
which a caller builds from `project.iriBase` and a `DomainModel`'s context:

- with an `iriBase`: `iriBase` + `localName(context)` + `/`
  (`https://data.acme.com/acme/ordering/`). `localName()` is WS2's
  normalizer, so the segment cannot hold a `/`, and no model is needed, so
  a domain whose file failed to load still has a namespace;
- otherwise, the model's own `namespace`, or `undefined` (decision 11).

The context is the manifest's; a model's own `domain_context` header plays
no part, as it plays none in loading a project today. Nothing throws: the
ref carries the values, not a project to look them up in. `iriOf` (WS6)
takes the project instead, because expanding another domain's alias needs
that domain's namespace.

**One source and one owner per namespace**, as `projectRules` errors, not
load refusals, so a domain stays attached and a project that gains
`iri_base` keeps loading:

- `project/domain-namespace-overridden`: a domain whose file declares a
  `namespace`, other than the one the project gives it, in a project that
  declares `iri_base`. The project's wins in `namespaceOf`, which is what the
  message says; the fix is to delete the domain's line or make it agree. An
  equal one is not reported, because it is what keeps a load of the domain
  file on its own giving the same answer.
- `project/duplicate-namespace`: two domains of one project with one namespace -- two
  contexts with one `localName()` (`Order Mgmt` and `Order_Mgmt`), or two
  domains of a project without `iri_base` declaring the same `namespace`.
  WS6's `iriOf` would give their elements one IRI.

What these cannot see: two projects declaring one `iri_base`, which would
share every IRI of a context they share. An `iri_base` is a namespace its
declarer owns, as with any IRI, and barwise sees one project at a time. Nor
does a domain file loaded on its own -- `barwise validate` on the file, the
editor's per-file diagnostics -- know its project, so there it reports
nothing and `namespaceOf(model)` is its own `namespace`. In 3.x that changes
no id; WS6's 6b settles it: `iriOf` never searches for a project, and a
caller that has one passes it.

Only `barwise validate` runs `projectRules` today. MCP `validate_model`
validates each domain with `ValidationEngine` and nothing else, and VS Code
has two paths: its `barwise_validate_model` language-model tool wraps that
same MCP function, and its editor diagnostics only parse the manifest. So
none of them shows these two or the existing mapping and product rules.
Closing that is a surface change of its own, not widened into this one:
barwise-0wa.qh3 covers `validate_model` and the tool, and barwise-0wa.xeh
the editor's diagnostics.

**What carries the field.** The `.orm.yaml` serializer reads and writes
`namespace`, and `OrmModel` holds it as `namespace?: string` beside
`domainContext`; the 2.0 reader has none to read. Merge keeps the base's, as
it keeps `domainContext`.

Split writes new domain headers and does not copy the source's namespace
into them. A `/`-ending source namespace becomes the new manifest's
`iri_base`, so each domain's namespace is that plus its context. A
`#`-ending one cannot be a base, so split drops it with a
`SplitResult.warnings` entry, which every surface already prints.

The Ossie writer names `namespace` in its loss block. Decision 1 settles
what goes in Ossie's `iri` slot, but the identity IRI needs WS6's `iriOf`
and local-name ids, so until then the namespace is a loss. `writeOssie.ts`
checks model-level fields by prediction alone, as it does `domainContext`.
`ossie-interchange.md` was updated with this plan: decision 5 points at
decisions 1 and 2, and its Context and Consequences no longer describe this
spec as still to come.

No surface gains a command: the fields
are declared by editing the file, and `namespaceOf` has no caller outside
tests and the two rules until WS6's `iriOf`.

Lineage hashes the whole serialized model (`hashModel`), so in WS4 adding or
changing a model's `namespace` marks its recorded exports stale once, though
no 3.x export writes it; `iri_base` and contexts are in the manifest, which
is not hashed. WS4 leaves `hashModel` alone, because that is conservative
and costs one re-export. Which namespace inputs lineage tracks -- all three,
or none -- is WS6's, where they first reach an export.

**What WS4 leaves to later** (each answered in WS6's 6b and 6e). In 3.x a namespace changes no id, so
`diffModels`, which has no model-level delta, need not report one yet. From
WS6 a change to a model's `namespace`, a project's `iri_base` or a context
re-identifies elements; `diffModels` compares two `OrmModel`s and cannot see
the manifest, so WS6 decides between giving it the project per side and a
project-level diff. Renaming a context -- the manifest, mapping files'
`source_context` and `target_context` and `context:Name` references,
products' `depends_on`, other domains' imports -- is not defined by any
operation in this spec, WS5's included, which renames elements; WS6 defines
it or reports a context changed by hand. A project's display name is in no
IRI. Imports and `iriOf` wait for WS6, where
references become names; in 3.x they would only hold UUIDs.

**Tests**, in core: each serializer stamps its version, reads an unstamped
file, refuses a newer one with "newer barwise" and not a schema message,
and its schema `const` equals its constant; the three kinds share each
reason's advice; `iri_base` and `namespace` round-trip and a malformed one
fails the schema; `namespaceOf` for each case above, including a ref with
no model; both rules, each watched failing first; split's warning; the
Ossie loss line. The tracked project and mapping files still load.
`schema-versioning.md` is edited in place: its y1b Consequences bullet,
which says these files carry no version, is replaced by one naming the test
that checks each schema `const` against its `CURRENT_*_FORMAT_VERSION`.

### 5. Rename (grounded 2026-10-28; ships as 5a then 5b)

Grounded against the code at b37a5869. In 3.x every reference between
elements is an id, except the ones listed below, so a rename keeps every
id and changes names. The id rewriting the Scope describes (a role's id
embeds its fact type's local name) arrives with WS6, where ids are names;
WS5 builds the operation, its cascade over what 3.x names, and the
contract WS6 extends. Ships in two PRs: **5a** is the core operation and
reaches no surface; **5b** adds the surfaces and the capability-matrix row
in the same PR, as the matrix rule requires.

**Rename recognition moved to WS6** (plan review, 2026-10-28). Decision 8's
content pass only matters once a rename changes an id: in 3.x a rename
keeps the id, and `id-first` diff already pairs it and reports a `name`
change. Built on 3.x it would also need a content key, a floor so two
values of one shape (`Email`, `Phone`) are not called a rename, a merge
guard, and a `pairing` marker in diff's JSON, MCP and editor output, none
of which 3.x exercises. It ships in WS6's PR, so no build changes identity
before diff recognizes a rename. (Revised in WS6's grounding, 2026-10-29: 3.x
does exercise it when two models' ids are unrelated, so it ships first, as
6a.)

**What can be renamed.** An object type, a fact type, and a role
(`role_name`), the kinds diff already treats as named (`deltas.ts`
`NamedElementType`, plus `roleName` changes). Constraints, subtype facts
and objectifications have no name in 3.x; a diagram layout's `name` and a
definition's `term` are labels and stay editable as text.

**The target is explicit.** In place of the Target architecture's
`from: string`, the operation takes a `RenameTarget`:
`{ kind: "objectType" | "factType"; name }`, or
`{ kind: "role"; factType; role }` where `role` is a role name or a
position. A bare name would be ambiguous wherever an object type and a fact
type share one, and role names are unique nowhere in 3.x (WS2 warns on
duplicates), so a role named by a name that two roles share is refused,
naming their positions, and the position form renames either -- which is
how a duplicate decision 5 asks the author to resolve gets resolved.

**An objectified pair is renamed one side at a time.** An object type that
objectifies a fact type of the same name -- 22 pairs in the corpus -- is the
collision decision 4 resolves by giving the fact type its own id (decision
20), so
renaming either side is the fix, and the usual refusals apply to the new
name.

**`renameInModel(model, target, to): RenameResult`**, pure, in
`core/src/rename/`. It returns a new model and leaves its input alone: the
model is written with `writeDocument`, edited as a document, and read back
through the public serializer with `lenient: true`, so a model that loaded
leniently with dangling references still renames, and validation reports
what it reported before. Working on the document carries every field
without listing them (barwise-937's lesson) and is necessary for object
types, which have no name setter (`createObjectType` returns a frozen
record). `RenameResult` is `{ model, ids, changes }`: `ids`, the
old-to-new id map, is empty on 3.x and filled by WS6; `changes` lists every
rewrite in plain words, for the surfaces to print.

Beyond the element's own name, a model-level rename rewrites:

- **The definition** whose `term` equals the old name, when no other object
  type or fact type in the model holds that name and no definition already
  has the new term: the element's glossary entry, which diff pairs by term
  (a second definition with one term would vanish from diff, which keys
  them in a map). When either condition fails the definition is left and
  the reason is in `changes`.
- **The reference mode that names a renamed value type**: an entity that plays the
  renamed value type in a binary fact type and whose `reference_mode`
  equals `toSnake(old)` gets `toSnake(new)`, because that is exactly the
  pairing `RelationalMapper` uses to type the entity's key
  (`referenceModePkType`: a binary, a value player, and
  `toSnake(vp.name) === ot.referenceMode`), and the key column would
  otherwise silently lose its type. An entity with the same reference mode
  that does not play the value type is left alone, because the mapper never
  tied the two. `toSnake` is private to `RelationalMapper.ts`; it
  moves to a shared module both import, not a second copy. An entity's own
  rename leaves its reference mode alone, even one shaped like
  `customer_id`: that string is also matched against a value type named
  like it (103 corpus entities pair `X_id` with a value type `X_id`), so
  changing it without that value type would break the same match.
- Nothing else, by decision: aliases, notes, definitions' text, derivation
  expressions, a mapping's `description`, and a semantic conflict's `term`
  are free text, and editing prose by string match is inference. Readings
  are `{0}` templates and hold no names; diagrams, populations and every
  constraint field are ids.

It refuses, with the reason: a target that does not exist, or a role name
two roles share; an empty or unchanged name; a new name another object type
or fact type holds, as `addObjectType` and `addFactType` do; a new name
whose `localName()` another element already holds across kinds (WS2's
`local-name-collision`), because a rename should not create what 4.0's migration would suffix; a
role name whose local name another role of its fact type holds, or
`population` on a populated fact type (decisions 5 and 7); a model whose
3.0 form would not load (two constraints sharing an id, which a 2.0 file
can hold), with `migrate`'s wording; and, called on its own, a shadow (an
object type with `source_context`), which is renamed through its owner.

**`renameInProject(project, context, target, to): ProjectRenameResult`**,
pure. Every domain must be loaded (`DomainModel.model` is optional), or the
rename is refused naming the one that is not, because the cascade cannot
rewrite what it cannot see; data products are not loaded as models and are
out of its reach, which the result says when the project has any. The
rename runs in the named domain and every domain it reaches:

- **Shadows.** Renaming an owned object type renames each shadow of it: an
  object type in another domain whose `source_context` is this context and
  whose name is the old name. Split also gives a shadow its owner's id, but
  a hand-written shadow need not share it, so the match is context and
  name. Each shadow's domain gets the model-level rewrites and refusals, except the one refusing a shadow, which is the
  cascade's own target; a domain that already holds the new name refuses
  the whole rename, naming that domain.
- **Reference modes across domains.** Renaming a value type rewrites the
  reference mode of each entity that plays it, as in `renameInModel`, and
  then of every shadow of each such entity, in whichever domain it sits:
  split copies the reference mode into a shadow, and the mapper names a
  shadow's key and foreign-key columns from it, so a shadow left behind
  would give two domains different key names for one entity.
- **Definitions anywhere.** Split writes every definition into the first
  domain, whatever owns its term, so a definition whose term is the old
  name is rewritten in whichever domain holds it, when no element anywhere
  in the project other than the renamed one and its shadows holds that
  name, and no definition in that domain already has the new term.
- **Mapping files.** In each entity mapping, a side is rewritten when its
  context is the owner's or a renamed shadow's and its name is the old
  name; split writes the owner on the source side and the shadow on the
  target side.
- It returns `{ project, ids, changes, files }`, where `files` names every
  domain and mapping path whose content changed, so a surface writes
  exactly those.

Lineage needs nothing new: manifests key element references by id and use
names only as labels, and staleness is a model hash, which a rename
changes, so exports read stale, which is correct because exported names
changed.

**5b, the surfaces.**

- **CLI.** Two forms: `barwise rename <file> <target> --to <name>` for a
  model file, loaded leniently as `renameInModel` expects, and `barwise
  rename --project <manifest> --domain <context> <target> --to <name>` for a
  project, where `<target>` is
  `--object-type <name>`, or `--fact-type <name>` with `--role <name>` or
  `--role-position <n>`; both take `--check` and `--format json`. Naming
  the file and the project at once is refused, and so is `--domain` without
  `--project` or `--project` without `--domain`. A model file that declares
  a `domain_context` gets a warning, not a refusal -- 47 of 119 tracked
  models declare one and the editor's scaffold writes one into every new
  model, most of them standalone -- saying that a project's domain is
  renamed through `--project` so its shadows and mappings follow. The project is
  assembled leniently, as `barwise validate` assembles it, so a domain with a
  dangling reference loads and renames as it would on its own; a project
  whose load still reported a problem (a domain or mapping file that could
  not be read or parsed) is refused, naming it, because the pure cascade cannot see a file
  that never loaded. A file, or any domain of a project, that is not at the
  current format is refused rather than migrated silently, naming
  `barwise migrate`, which reports what migrating it changes. That check
  and the list of files a project rename writes are shared by the surfaces
  from `@barwise/core/rename` (`modelForRename`, `projectRenameWrites`);
  each surface parses its own target arguments.
- **The write.** Every changed file is staged (written beside its target)
  before any target is replaced, and only then are the staged files renamed
  over their targets, so a failure while staging changes nothing. A failure
  during the renames themselves (permissions, a full disk) can still leave
  the files before it replaced, which the command reports by name, with
  the changes those files carry. Two writes naming one file are refused, and
  staged files are created exclusively, so one left by an interrupted run is
  neither written over nor removed (`migrate` included).
  `migrate`'s `replace()` writes and renames in one call, so it is split
  into stage and commit, in a module both commands use.
- **MCP** `rename_element`, with the same lenient loads (file and
  project), the same warning, the same refusal of a project that loaded
  with problems, and the same staged write. The CLI's and MCP's
  `projectLoader.ts` doc comments, which say only validate passes
  `lenient`, are corrected in the same PR. `@barwise/mcp` does not depend on `@barwise/cli`, so the
  staged write is a second copy there, registered with the CLI's in
  `parity.manifest.json` in the same PR. It returns the YAML for an inline
  source.
- **VS Code**: the language-model tool over the MCP function, refusing
  when any file the rename would write has unsaved changes in an editor
  (found by a check-only run, compared by real path), since saving that
  buffer afterwards would undo the rename in that file alone. An editor
  rename (F2) through the language server is not in scope; it advertises no
  rename provider today.
- **Comments are lost** in every file a rename rewrites, because the file is
  written from the model, as `migrate` and MCP `merge_models` write-back
  already lose them (barwise-ok6). The CLI help and `docs/CLI.md` say so;
  rewriting the parsed YAML in place to keep them is barwise-ok6's.
- Each list pin moves in the same PR (`commandRouting.test.ts`,
  `serverSpawn.test.ts`, `toolRegistration.test.ts`), with a
  capability-matrix row (CLI, MCP and VS Code yes; "deliberate: modifies
  its input, like `migrate`"). The three places that call `migrate` the only
  command that modifies its inputs are corrected: `docs/CLI.md`, the
  `migrate.ts` header, and the matrix's `migrate` row in `CLAUDE.md`. The new
  command and tool are documented in `docs/CLI.md` and `docs/MCP.md`, and
  listed in the cli and mcp `CLAUDE.md` layout tables.

**Tests.** 5a, in core: each kind renamed and the result round-tripping;
each refusal, including one raised in a shadow's domain and the
shared-role-name case resolved by position; the reference-mode rewrite,
including an entity's shadow in another domain, an entity that does not
play the value type left alone, and an entity's own rename leaving its
reference mode; a definition of an unrelated same-named element in another
domain left alone; the definition
rewrite, in the owner's domain and in a split project's first domain, and
left when the new term exists; free text left alone; the project cascade
over a split project (shadows, both mapping sides, `files` exact), then the
whole project validating as before; an unloaded domain refused. Each
watched failing first. 5b: the CLI's two forms, `--check` and json
contract and exit codes as `migrate`'s; the staged write with a planted
failure while staging the second file changing nothing; the
`domain_context` warning and the project-with-problems refusal on both
surfaces; the MCP tool's write-back and inline result; the parity pair; the
pins.

### 6. Format 4.0: local names are the ids (grounded 2026-10-29; ships as 6a to 6f)

Grounded on main at `a3bf9762` by three reads (core id assignment; diff,
merge and split; importers, exporters, lineage and tests), with the
owner's answers of 2026-10-29 (decisions 15, 18 and 19, and the order
against `effect-adoption.spec.md` below), and corrected by one round of
plan review. Paths are under `barwise/packages/`.

**Order against the Effect adoption.** `effect-adoption.spec.md` rebuilds
core's record types and YAML codec, the code this workstream changes. The
owner chose WS6 first (2026-10-29): the Effect spike (#672) continues on
its branch to decide adoption, and any Effect rebuild starts from the 4.0
model, so nothing is built twice. That branch predates format 3.0
(its base reads `CURRENT_ORM_VERSION = "2.0"`; 3.0 shipped in #708), so
a format change it proposes is a 3.x minor or waits for this spec.

**What the code already gives.** Every element in production source is
constructed inside an `OrmModel` add method: `createObjectType`,
`new FactType`, `new SubtypeFact`, `new ObjectifiedFactType` and
`new Population` each have one source call site, in
`core/src/model/OrmModel.ts` (225, 571, 656, 788, 917), and `new Role` is
reached only through `FactType`. A fact type outside a model exists only
in tests (18 sites); counterexample populations
(`CounterexampleGenerator.ts:434,502,634,737,754`) are the one standalone
element. So decision 17's "when it joins the model" is one place in
practice. One piece of state is new: `new FactType(config)` passes no
model today, and `FactType.addConstraint` is also called on fact types
already in a model (dbt `sqlPatterns.ts:117`, `uniqueness.ts:132,167`;
Ossie; `llm/src/parse/constraints.ts`), so a fact type keeps a reference
to the model that added it, through which such a constraint is minted and
entered in the cross-kind index. The reference is typed as a narrow
callback interface declared in a leaf module (`{ admitConstraint(c):
Constraint }`), which `OrmModel` supplies, not as `OrmModel`: `FactType`
holding the model would close `FactType` -> `OrmModel` -> `FactType`, and
`FactType` minting itself would close `FactType` -> `mint.ts` ->
`ConstraintVerbalizer` -> `FactType` (`ConstraintVerbalizer.ts:8`
type-imports `FactType`). The model mints; the fact type asks it to. The 3.0 reader adds every kind after
everything its sentence reads (object types, fact types with internal
constraints, subtype facts, external constraints, preferred identifiers,
then objectifications and populations, `OrmYamlSerializer.ts:244-308`),
and no constraint's sentence reads a preferred identifier or an
objectification, so a name minted at the add reads the same as one minted
after that load. An importer that adds in another order is held to the
same rule where it applies (6c's NORMA externals; decision 4 below).

**6a, groundwork that ships on 3.0.** No model file changes; the lineage
manifest gains a per-export field, which older builds ignore
(`parseManifest` is a bare cast, `manifest.ts:35-36`). Each part is its own
PR and may be released.

- **The verbalization cycle.** `OrmModel` cannot reach the constraint
  verbalizer today: verbalization modules type-import `model/OrmModel.js`,
  directly and through `model/subtypeOperands.ts:8` and
  `annotation/ExportAnnotationCollector.ts:20`, and dependency-cruiser's
  `no-circular` counts type-only imports (`.dependency-cruiser.cjs:48-58`,
  `tsPreCompilationDeps`). `ConstraintVerbalizer` and every module it
  imports take a structural interface declared beside them instead,
  covering what they read: `getObjectType`, `getFactType`, `findRole`,
  `factTypesNaming`, `factTypesHolding`, `getSubtypeFact`,
  `constraintsTouching`, the `factTypes` list (`phase2.ts:661`) and the
  `ConstraintInView` type (`ConstraintVerbalizer.ts:9`). `OrmModel`
  satisfies it. The whole-model `Verbalizer`, which also reads
  `objectTypes`, `subtypeFacts`, `objectifiedFactTypes` and `constraints`,
  keeps importing `OrmModel`, because the model never imports it. A
  dependency-cruiser run with `model/mint.ts` importing the constraint
  verbalizer, and `FactType.ts` importing only the leaf module that
  declares the callback interface of 6b's opening, is the check.
- **`model/mint.ts`**: `mintedName` (the canonical sentence, its closing
  period dropped, through `localName()`), `mintedKey` (section 3's content
  key, from the serializer's form of the element) and the guard that the
  sentence is of this element. The guard is a local check at the add --
  every role resolves, an internal constraint's roles belong to its fact
  type (the `Malformed` case, `ConstraintVerbalizer.ts:232-234`), every
  operand exists -- not a call to `graphOf`, which reads the whole model
  and would make each add linear.
- **`FactType.addConstraint` returns the stored constraint** (today
  `void`, storing a copy, `FactType.ts:192-223`). Thirteen
  `setPreferredIdentifier` calls in dbt, DDL, NORMA, OpenAPI and Ossie
  (two of them resets), and `llm/src/parse/constraints.ts:54,77`, need a
  constraint's id right after adding it.
- **The test builders.** `core/tests/helpers/ModelBuilder.ts` builds role
  ids `<ft>::role1` (`:289-290`) and preferred ids `::preferred` (`:236`),
  and `:` is reserved for aliases in 4.0. It has three more copies,
  `formats/`, `dbt/` and `learn/tests/helpers/ModelBuilder.ts` (identical
  to one another, 411 lines, `::role1/2` at `:271-272`, `::preferred` at
  `:219`), which no manifest registers. 67 test files use one of the four (the
  draft said 48): core's serves 47 in core and 7 elsewhere (diagram 4,
  diagram-ui 3, two of them `.tsx`), and the package copies serve 13
  (formats 9, dbt 2, learn 2) plus a formats helper,
  `tests/helpers/unreportedFixture.ts`; 15 files hard-code `::role1/2`
  (97 occurrences). All
  four move to a `roleId(ft, i)` helper, and the three package copies are
  registered as a set in `parity.manifest.json` in the same PR.
- **Lineage exports name their model.** One `.barwise/lineage.yaml` serves
  a directory (`cli/src/commands/export.ts:95-108`), `project init` puts
  every domain in one `domains/` directory, and `ManifestExport` has no
  source model: every export overwrites the manifest's one
  (`core/src/lineage/manifest.ts:52-85`). UUIDs never collided across
  models; local names will (two domains each owning `Order`), which would
  make impact analysis ambiguous and let a rename in one domain rewrite
  another's exports. Each export gains its own `sourceModel`.
  `checkStaleness(manifest, model)` (`staleness.ts:44-61`) and
  `analyzeImpact(manifest, elementId)` (`impact.ts:35-67`) take the model's
  path and read only that model's exports. An export written before this
  has none, and the top-level `sourceModel` cannot stand in for it, because
  every export overwrites that field (`manifest.ts:80`; `export.ts:107`
  always passes it), so in a shared directory it names whichever domain
  exported last, and copying it into the old exports would hand domain A's
  artifacts to domain B. An old export is attributed by its `sources`
  instead, to the one model that holds every source id and owns at least
  one of them. Holding is not enough, because split gives each shadow its
  owner's UUID (`splitModel.ts:347-348`), so a domain's shadow holds the
  owner's ids; a shadow (`source_context` set) does not own. The first
  write after 6a records the attribution. An export that no model, or
  more than one, qualifies for (no sources, ids no loaded model owns)
  stays unattributed, and every model's status lists it as unattributed,
  to be re-exported. A user who upgrades straight to 4.0 with no 6a write
  between gets the same rule through the 3.x reader's in-memory UUID map,
  or, for a domain loaded as 4.0, an unattributed export. The top-level
  field is kept, so an older build reads the manifest as it does today.
  Without a model path -- MCP `impact_analysis` and `lineage_status` given
  inline YAML (`impactAnalysis.ts:41-42`, `lineageStatus.ts:35-40`) --
  there is no model to attribute by under 4.0, where local names collide.
  Impact, which never loads the model (`impactAnalysis.ts:36-48`), reads
  every export that holds the id and names each export's model.
  `lineage_status` with inline YAML reads the manifest as today when its
  exports name one model, and otherwise refuses, naming the models and
  asking for a path, rather than comparing one model's hash with
  another's exports. The two identical `lineageIo.readManifest`
  copies (cli and mcp) are registered in `parity.manifest.json` in the
  same PR.
- **Diff recognizes renames (decision 8).** The WS5 plan review moved this
  into WS6's format PR because on 3.x "a rename keeps the id" and nothing
  would exercise it. That holds for two revisions of one file, and not for
  two models whose ids are unrelated -- two imports of one schema, an LLM
  draft against its base -- where `barwise diff` today reports a renamed
  element as one removal and one addition. So it ships here, and the
  Workstreams preamble's order (no build changes identity before diff
  recognizes a rename) holds with room to spare. In `diffIdentity`
  (`core/src/diff/identity.ts:59-74`), after both kinds' id and name
  passes: fact types first, keyed by arity and, per position, the player's
  interim key and the role name, plus their internal constraints'
  `constraintKey`s, which use host positions (not readings, which a rename
  usually rewrites); the fact type keyer is rebuilt; then object types,
  keyed by kind, the sorted `f[ftKey,pos]` of the roles they play, their
  subtype-fact end keys, value constraint and data type (not the reference
  mode, which follows the name); then both keyers are rebuilt, so
  constraint, subtype, objectification and population pairing follow with
  no change. A pair forms only when its key is unique among the unpaired
  elements on both sides. The floor: an object type that plays no role and
  is no subtype-fact end is never paired; a fact type needs no floor,
  because an unpaired player's key is side-tagged (`identity.ts:143`). The
  limit the tests state: an object type renamed together with a fact type
  it plays in defeats the pass in either order, even when it plays in
  others, because its key is the whole set of its roles. `DiffOptions`
  (one field today, `ModelDiff.ts:38-44`) gains `recognizeRenames`
  (default on) and `renames`, a list of `{ target, to }` with an
  object-type or fact-type `RenameTarget`, applied after the name pass; a
  target that does not resolve is an error, and roles are excluded because
  they pair by position. Object-type and fact-type deltas carry
  `pairedBy: "id" | "name" | "recognized" | "declared"`. Constraint deltas
  carry none and are unchanged: external and internal constraints already
  pair by content key under `id-first` (`elementDiff.ts:676-681,745-761`),
  and every transcript merge depends on that, because an LLM draft has
  fresh ids. The marker reaches `deltaToJson` (`diff/deltas.ts:300-328`)
  and the two text renderers that bypass it
  (`cli/src/commands/diff.ts:83-96`, `history.ts:168-178`). The diff
  result records the `matching` it ran with, and `mergeModels` takes that
  result rather than its bare deltas, and so does `mergeAndValidate`
  (`ModelMerge.ts:1126-1131`), which the surfaces call:
  `cli/src/commands/merge.ts:68`, `import/transcript.ts:143`,
  `mcp/src/tools/merge.ts:83`, `vscode/src/commands/ImportTranscriptCommand.ts:245`;
  tests call the two 92 times. Both refuse a diff built with
  `matching: "content"` (the case the comment at `ModelMerge.ts:831-833`
  warns of, and the only guard today) and any delta paired `recognized` or
  `declared`, naming `recognizeRenames: false`; `mergeAndValidate`
  already reports a throw as `merge-error`. Recognition is on for
  `barwise diff`, MCP `diff_models` (and the editor through it) and
  `barwise history`; off for every merge path (`barwise merge`,
  transcript import on the CLI and in the editor, MCP `merge_models`),
  for `UNRELATED_IDS_DIFF` (`llm/src/diffOptions.ts:12`, used by sample
  agreement, `sampleAgreement.ts:65,116`, and alternative framings,
  `TranscriptProcessor.ts:234`) and for `formats/src/ossie/verifyOssie.ts:48`.
  The CLI's `diff` takes `--rename <kind>:<old>=<new>` and `diff_models`
  the same list.

**6a implementation notes** (rename recognition, 2026-10-29). Where the
build differs from the bullet above:

- Merge also refuses any diff built with `recognizeRenames` on, whether or
  not it found a pair: `ModelDiffResult` records the option, and
  `mergeModels` reads it. The bullet refused only the pairs themselves, so
  a merge path that forgot `MERGE_DIFF_OPTIONS` would have failed only on
  an input holding two elements of one shape. One consequence is public:
  `mergeModels(a, b, diffModels(a, b), ...)` always throws, because the two
  defaults disagree on purpose. `MERGE_DIFF_OPTIONS` is exported from
  `@barwise/core/diff` for every merge path.
- A recognized or declared pair is reported as a possible rename, as
  decision 8 says, and rated no lower than the removal it stands in for:
  two different elements of one shape pair the same way, and a lower
  rating would tell a reader less than the unpaired diff did.
- `pairedBy` is read through one allowlist of the evidence (`id`,
  `name`), so a pairing added later is shown and refused until someone
  decides otherwise.
- The constraint keys moved to a leaf module, `diff/constraintKey.ts`,
  because `elementDiff.ts` imports `identity.ts`.
- The verbalization cycle runs through five modules, found by making
  `OrmModel` import the constraint verbalizer and reading dependency-cruiser's
  report: `ConstraintVerbalizer.ts`, `constraints/phase1.ts`, `phase2.ts`,
  `sentence.ts` and `model/subtypeOperands.ts`. `ExportAnnotationCollector`
  is reached only from the whole-model `Verbalizer` and is not on it. The
  interface is `ConstraintModel` (`model/constraintModel.ts`, with
  `ConstraintInView` moved there and re-exported); `OrmModel` declares it
  implements it. The same probe, run after the change, reports no cycle.
- The subtype-fact and objectification sentences moved from `Verbalizer`
  into `verbalization/elementSentences.ts`, over `ConstraintModel`, so
  `mint.ts` can read them; the `Verbalizer` methods delegate.
- `mintedKey` walks the constraint's serialized form by field: references
  (roles, subtype facts, a join path's root and steps) become what the
  sentence names, stated fields are kept, the id is dropped, and a field
  the walk does not know throws, so a constraint kind added later must say
  which of its fields are references. The guard and the key share that
  walk. The guard also requires every player of a role's fact type, which
  the sentence names, to resolve. The key keeps the serializer's field
  names, not the model's, because `minted_from` sits beside that form in
  the file and a reader comparing the two reads one vocabulary.
- Resolving is not enough for the guard: a disjunctive mandatory over roles
  of two players resolves, and its sentence names the first role's player
  as the one every instance plays. What each sentence assumes of its
  constraint's shape -- one shared player, each role named once in a list,
  a unary fact type under a cardinality, an exclusion over two roles or
  more, a join path that chains, operands that share a root type and
  project the same column types, something to constrain -- is stated once,
  in `verbalization/constraints/assumptions.ts`, beside the sentences, and
  the guard refuses a constraint whose shape breaks it. The first version
  listed six shapes and review found eight more, so the list is not trusted
  to be complete by inspection: it restates part of what validation's
  constraint rules check, and `mintAgreesWithValidation.test.ts` classifies
  every `constraint/*` rule as one the guard refuses (with a model that
  rule reports and the guard refuses) or one whose report the sentence
  still states, and fails on an unclassified rule. What it cannot see is a
  phrasing guess no rule reports: a role list naming one role twice
  (barwise-ik3) and join operands rooted at different types (barwise-sq2)
  were two, and such a shape is caught only by reading the phrasing paths.
- The key holds what the sentence prints: a role is its position, its name
  and its fact type's name, readings and players; an internal constraint
  also carries its host fact type, which its sentence names even where no
  role does (a value constraint on the whole fact type); a subtype fact's
  defining rule is its expression alone. `mint()` returns the name and key
  from one check; `mintedName` and `mintedKey` read it.
- Two consequences for 6b. A key can still hold something no sentence
  prints (every reading of a role's fact type, where a sentence uses one),
  so a name is stale only when the key differs and the name minted now
  differs too; otherwise the key is refreshed in place. And two constraints
  can mint one name from different keys (an external uniqueness over
  `[a, b]` and over `[b, a]` reads the same), which is the suffix rule's
  case, not the guard's.

**6b to 6f, the 4.0 series: no release between them**, as
`orm-format-3`'s 4a/4b, because a build that writes 4.0 must already
read it everywhere, the schema cannot tell a UUID from a local name (a
UUID matches the local-name pattern), so importers switch with the
version bump, split's shadow ids are a 4.0 shape, and without 6e a
version-1 manifest would go silently empty for impact analysis.

- **6b, the model and the format.**
  - _Mint at the add, with the file's stated ids reserved for the load._
    A reader collects every id the file states before its first add --
    the pre-pass the 3.0 reader already runs for constraint repeats
    (`OrmYamlSerializer.ts:260-279`), and the `taken` set the 2.0 reader
    already builds for derived ids (`:507`, `derivedId.ts`) -- and passes
    it to the model as reserved for that load. A minted name, or a
    derived local name, that meets a reserved or held id takes the next
    free `_N`, so a stated id wins wherever it sits in the file, and the
    names given are a function of the input because the add order is the
    file's. A stated id another element already holds is refused, as
    `DuplicateIdError` refuses today, now across kinds. A reader that
    forgot to reserve fails loudly (the later stated id becomes a
    `DuplicateIdError`, so a `DeserializationError`), never silently.
    Merge and split add elements that already carry ids, so the model
    sees each as stated and merge's own clash rule (6d) decides. Rejected:
    minting once a load's last add has run, which needs an unnamed
    in-store state for map-keyed kinds, gives no id to a caller that
    needs one inside the load, and is decision 17(b) by another name; and
    displacing a minted holder when a stated id arrives later, because a
    caller may already have read the minted id.
  - _The cross-kind index_ replaces the per-kind `refuseHeldId`
    (`OrmModel.ts:185-196`) beside the per-kind maps, keyed by id, over
    object types, fact types, roles, named constraints, subtype facts,
    objectifications and populations (`Ft.population` can equal a role
    id, which `structural.ts:311` already reports); the WS2 rule's map
    (`structural.ts:243-317`) reads it. Decision 5 needs no flag: deriving
    role ids refuses a repeated role name, the 3.x replay passes a suffix
    option, and a 4.0 file's stated ids are kept.
  - _Decision 4 at import._ An importer adds objectifications after fact
    types (`NormaToOrmMapper.ts:121-124`,
    `llm/src/parse/objectifications.ts:59`), so at `addFactType` the model
    cannot know a fact type will be objectified, and a NORMA-convention
    pair (`Enrollment` and `Enrollment`, where all 22 corpus cases come
    from) would take `Enrollment_2`. Decision 20 (owner, 2026-10-29): such
    a fact type keeps its name, and only its id is built from its first
    reading, rendered with its players' names, through `localName()`.
    That is a fallback, used only when `localName(name)` is its
    objectifying type's id; any other objectified fact type's id is
    `localName(name)`. The id is fixed when it is given: renaming a
    player or editing the reading changes neither the id nor any warning.
    `renameInModel` gives a renamed fact type `localName(new name)`; a
    new name whose local name is its objectifying type's id is refused
    there, as WS5 refuses any held local name, so the decision-20 id is
    given only at import and in migration. The
    two importers that objectify know it from their source before they add
    the fact type, so each states that id; the replay does the same in
    migration. Decision 17's bullet is read that way: decision 4 applies
    where the objectification is known when the fact type is added. Names
    are what a user wrote, so a NORMA round trip and the LLM parser's
    output keep them.
  - _Typing._ Constraints are already `id?: string` (`Constraint.ts:23`),
    handled in 49 places in core. Object types, fact types, roles,
    populations and fact instances can always be named, so they keep
    `id: string`. A subtype fact or objectification whose references
    dangle is left unnamed (decision 19): those two classes allow an
    absent id, the model keeps them in a side list its getters append,
    and validation reports each (about 32 reads in core to narrow, plus
    their readers in `formats` and `diagram`).
  - _Role ids_ are stated in 4.0 files (`<ft>.<role>`), so a file says
    what it means without a derivation rule to know.
  - _The schema_: shared `local_name`, `role_id` and `reference` (a local
    name or `alias:local`) definitions; a shadow's id admits `alias:`;
    `id` optional on constraints, subtype facts and objectifications,
    because a hand-typed one has none until it is stored; `minted_from`
    only beside an `id`; `imports` as a map from alias to a context name
    or an absolute IRI; the pattern held once as a constant in
    `model/name.ts`, drift-tested against the schema as `iri.ts` is. The
    3.0 schema is frozen as `orm-model-3.0.schema.json`, as 2.0's was.
  - _The 3.x reader_ reads with today's `fromDocument` against the frozen
    schema, then replays that model into a fresh 4.0 model through the
    existing `to*Config` projections, dropping ids and mapping each
    reference through the growing UUID-to-local-name map (one reference
    rewriter, shared with rename), with the migration option set: suffix
    a repeated role name (decision 5a) and give an objectified fact type
    named like its object type an id from its first reading (decisions 4
    and 20). A reference to an id the file does
    not define, which only a lenient load admits, is carried across as
    written, so validation reports it as it does today. The inverse map
    is kept on the model in memory, never written, and diff's id passes
    (`identity.ts:81-97`, `elementDiff.ts:233-235,635-639`) use it only
    when both models carry one, so `barwise history` pairs two 3.x
    revisions exactly with no change to `history.ts`. The 2.0 reader
    feeds the same replay (decision 18), so `planRead`'s one legacy slot
    (`schemaVersion.ts:26,194-213`) becomes two.
  - _`barwise migrate`_ reads through that replay and writes 4.0, keeping
    its `--check` and `--format json` contract and its exit codes. Given
    a `.orm-project.yaml` it migrates every domain in one run, which also
    settles a suffixed owner's shadows (Scope), and writes them through
    WS5's staged write. A current-version file with unstored ids is
    written instead of skipped (decision 17).
  - _Unstored ids_ (decision 17): a constraint typed in the editor
    without an id is re-minted on each load, so it gets a diagnostic
    saying its id is not stored, an editor action to store it, and the
    `migrate` path above.
  - _The rules this format needs_, in `validation/rules/structural.ts`
    unless stated: an id that differs from what its rule gives from the
    current name (decision 13; a suffixed id is reported this way, so the
    message says suffixed); an objectified fact type whose name's local
    name is its objectifying type's id is exempt, because no id from its
    name can be stated beside that type's, and its decision-20 id, once
    given, is kept like any other until a rename. Renaming the objectifying
    type ends the exemption, and the rule then reports the fact type's
    decision-20 id; that is expected, because a rename of the fact type can
    now give it `localName(name)`, which is the repair. In 4.0
    `structural/local-name-collision` (`structural.ts:255-280`), which
    compares `localName(name)` today, compares ids, so the 22 corpus
    pairs and every NORMA import stop warning once their ids differ, and
    its 3.x message, which says the migration "will rename the fact
    type", says it gives the fact type its own id; role ids embed their
    fact type's id, not `localName(name)`, and
    `structural/duplicate-role-name` and the `population` variant of
    `local-name-collision` build them that way from one `ftLocal`
    (`structural.ts:303,310-313`); `stale-minted-name`, a graph rule run only
    when the graph builds (decision 14, section 3); a reference whose
    alias the model does not import (error), and a declared alias whose
    context no loaded project supplies (warning), so a standalone domain
    still loads (Scope). The undeclared alias is a rule, not a refusal at
    the add, because the lenient loads (validate, the editor's
    diagnostics, merge's incoming side) must still load such a file to
    report it, and a strict refusal would give those surfaces a load error
    in place of a diagnostic.
  - _`iriOf`_, as Target architecture gives it. A domain loaded on its own
    (`barwise validate` on the file, the editor's per-file diagnostics)
    has no project, and WS4 left open how it would find one. It does not
    search: a caller that has the project passes it, and without one
    `iriOf` expands a local id from the model's own `namespace` and
    returns nothing for an `alias:` id, as decision 11 returns nothing
    for a model with no namespace. Explicit over implicit: the file the
    editor opened does not decide which project it belongs to. The callers
    that need IRIs have the project: `barwise export` and MCP
    `export_model` already take a `.orm-project.yaml` with `--domain`
    (`cli/src/commands/export.ts:43,49`), so an Ossie export of a domain
    goes through its project; exporting the domain file alone in an
    `iri_base` project gives no IRIs, and decision 11's request for a
    namespace says so. A project export writes no lineage manifest
    (`export.ts:155`, "Project export does not write a lineage
    manifest"; MCP `export_model` writes none), so an Ossie export that
    holds IRIs is not lineage-tracked, as no project export is today;
    tracking project exports is its own change, filed when 6f lands, not
    this spec's.
  - _A namespace input that changes_ (Risks; WS4's "what WS4 leaves to
    later"): a stored id is a local name and never holds the namespace,
    so editing `iri_base`, a context or a model's `namespace` changes no
    id and no diff pairing; only `iriOf`'s answers move. WS4's premise
    that such an edit re-identifies elements was written against
    namespace-qualified ids and does not hold for local names, so no
    project-level diff is needed for identity. Diff does not compare a
    model's header today (merge only carries `namespace` across,
    `ModelMerge.ts:75`), so 6b adds a header change for `namespace` and
    `imports`, which makes such an edit visible in `barwise diff`.
    Renaming a context changes the alias in every other domain's shadows
    and imports; that is a project-level rename of its own, not in this
    spec, and until it exists a context renamed by hand is reported by
    the unresolved-alias rules above.
  - _Importers switch in the same PR._ Ossie
    (`formats/src/ossie/mapOssieToOrm.ts:364,381,542,613,639,699,730`) and
    OpenAPI's unreferenced roles (`OpenApiImportFormat.ts:419,424`) drop
    `generateId()`. The sites that mint role ids before the fact type
    exists, because constraints in the same config reference them (dbt
    `factTypes.ts:48-49,116-117`, `identifierTypes.ts:62-63`,
    `compositeKeys.ts:373`; DDL `DdlImportFormat.ts:1205-1584`, eight
    sites; OpenAPI `:354-355,477-478`; Ossie `:522`), add the fact type
    with no role ids, read `ft.roles[i].id` back and add those
    constraints through `FactType.addConstraint`. Preferred identifiers
    read the stored constraint's id. Avro, code-analysis and the rest of
    the LLM parser rely on the model's default already.
  - _Retired_: `generateId`, `setIdGenerator`, `createUuidv7Generator`
    and the three surface installs (`cli/src/index.ts:12`,
    `mcp/src/index.ts:12`, `vscode/src/client/extension.ts:34`);
    promptlab's `withDeterministicIds` and `uuidv7FromParts`
    (`promptlab/src/evalcase/renderReference.ts:43-62`), which exist only
    because ids were random. `formatUuid` stays for `derivedId`. The
    id-shape tests (`core/tests/model/id.test.ts` except `formatUuid`,
    `cli/tests/entryIdGenerator.test.ts`,
    `mcp/tests/serverSpawn.test.ts:85-102`,
    `vscode/tests/unit/activateIdGenerator.test.ts`) become assertions of
    local names or go with what they tested; `cli/tests/importerIds.test.ts`
    checks the naming rules, with NORMA no longer exempt.
  - _What a 3.x input changes in tests and goldens_, here and not in WS7,
    because the 3.x reader rewrites ids in memory: tests that look up a
    3.x fixture's elements by id (about 91 test files hold some 2,046
    hand-written id literals; ids stated in code survive under decision
    17); the 4 DDL goldens (`cli/tests/characterization/golden/*.ddl.txt`;
    `clinic-appointments.ddl.txt:2` prints a UUID read from a 3.0
    example); the 5 SVG goldens, whose `data-id`s the replay rewrites;
    and the 11 eval references, which `promptlab/tests/referenceDrift.test.ts`
    regenerates from `renderReference` once `withDeterministicIds` goes.
  - Amends `determinism-in-core.md` decision 4 and supersedes
    `importer-role-ids.spec.md` R1.
- **6c, NORMA.** Import keeps NORMA's own ids today
  (`formats/src/norma/mapping/`: `objectTypes.ts:45,60,78`,
  `factTypes.ts:40,60`, `subtypes.ts:37,70`, `populations.ts:78,104,111`,
  `context.ts:136`) and resolves constraint role references as model
  ids; 4.0 needs a NORMA-id-to-local-name map built after each add, the
  largest importer change. It also adds each external constraint inside
  the per-fact-type loop, right after the first fact type it spans
  (`factTypes.ts:84`), before the others exist, which 6b's guard would
  leave unnamed; 6c adds external constraints in a pass after every fact
  type. Export changes one seam, `toNormaId` (`normaId.ts:39`, 64 uses),
  to decision 12(a), and drops its `startsWith("_")` pass-through, which
  would skip derivation for a local name such as `_internal`. Decision
  12(c) is recorded as not viable, subject to confirming NORMA's id type:
  if it is `xs:ID` (an NCName), `localName()` emits `%`, keeps
  `! $ & ' ( ) * + , ; = @ ~`, keeps `ucschar` outside XML's NameChar,
  and a shadow's id holds `:`. The repo models no NORMA id syntax
  (`NormaId` is a branded string), so the check is against NORMA's XSD
  before 6c lands.
- **6d, merge and split.** Merge keeps the base's fact type id on a
  modification and rewrites the incoming roles to `<base>.<role>`, where
  today it takes the incoming roles (`ModelMerge.ts:141-151,196`); pairs
  the internal constraints with the diff's id-then-key pairing, exported
  from `elementDiff.ts` (`diffConstraints`, `:646-701`, reports only
  changes), and keeps the base's id and stored key for each pair
  (section 3). A clash on a minted id (subtype fact, objectification,
  population) takes the model's suffix rule in place of `mergedId`'s
  UUIDv8 (`:808-818`, `MERGE_ID_TAG`), reported; a clash between two
  stated ids, now across kinds, is refused by `refuseNameClashes`
  (`:835-867`, one kind today). Split gives each shadow the id
  `<owner>:<the owner's id>`, which can differ from `localName(name)` (a
  suffixed id, a name edited without a rename), and rewrites every reference to it in the
  domain (role players, subtype ends, `objectified.object_type`), emits
  `imports: { <owner>: <owner> }`, drops `source_context`, and writes 4.0
  (`splitModel.ts:340-360,441-444`). The 3.x reader, which sees only the
  shadow's name and `source_context`, builds `<context>:localName(name)`,
  and the 4.0 project load's name check (Scope) catches the one case where
  that binds the wrong owner element. A core `aliasOf(id)` replaces the field for its
  readers: `mcp/src/tools/split.ts:168-176`, the diff change kind
  (`elementDiff.ts:82-83`, `changeDescription.ts:71,218`,
  `breakingLevel.ts:38`, kept and derived from the alias), and, missing
  from the draft's Inventory, `rename/renameInModel.ts:114`,
  `rename/renameInProject.ts:82,230-234`, `ossie/writeOssie.ts:455,803`
  and `serialization/yaml/objectType.ts:22,61-62,102`. 21 tracked YAML
  files set `source_context` (WS7).
- **6e, lineage.** The manifest goes to `version: 2` (`types.ts:40-45`)
  and `canonicalizeIds` goes (`manifest.ts:106-147`). The marker is per
  export, because `updateManifest` keeps every export it does not
  replace (`manifest.ts:76-84`): when a 4.0 build writes a version-1
  manifest, each export it keeps is marked as written under 3.x ids, so
  under decision 15 as amended it reads stale with the reason "ids
  changed to 4.0" (`staleness.ts:51-61`), and impact analysis says that
  export predates 4.0 instead of returning nothing (`impact.ts:35-67`).
  The marker is written from the manifest's version, not guessed from
  the shape of `elementId`, which would miss exports with no sources,
  NORMA `_GUID` ids and hand-written ids. `hashModel` hashes the
  serialized model, so a model's own `namespace` and `imports` are in the
  hash; `iri_base` and contexts are in the project file, which is not.
  That settles WS4's "which namespace inputs lineage tracks": the model's
  own, which the hash covers, so an export of a domain file that declares
  its own `namespace` (`export.ts:96-108`) is tracked through it; and the
  project's none, because a project export, whose IRIs come from
  `iri_base` and the context, records no lineage (6b's `iriOf`). Renames rewrite the manifests
  they can see through a pure core helper, `renameInManifest(manifest,
  ids, sourceModel)`, never restamping the hash, because the artifacts
  really are stale: for a model file, `<dir>/.barwise/lineage.yaml`; for
  a project, the manifest beside each domain that changed, with the
  rewrites for one manifest path folded into one write before staging,
  because domains share a directory and WS5's write refuses two writes
  naming one file. Each is one more staged file in WS5's write
  (`cli/src/commands/rename.ts`, `mcp/src/tools/rename.ts`; the editor
  inherits MCP's). `ProjectRenameResult.ids` (`renameInProject.ts:36`)
  becomes a map per domain, because a shadow's id changes in each domain
  that holds it.
- **6f, the outputs.** DDL comments (`DdlExportFormat.ts:185`), Ossie's
  loss block (`writeOssie.ts:89,318,347,350`) and SVG `data-id`
  (`diagram-ui/src/parts/*Node.tsx`) print local names with no code
  change. The Ossie writer puts `iriOf`'s identity IRI, or
  `equivalent_iri` when present, into Ossie's `iri` (decision 1), and the
  namespace leaves its loss block (WS4).

**Sizes, roughly.** 6a: about 400 lines of source for diff, 300 for the
rest, each with tests. 6b: about 25 core files and 1,500 to 2,000 lines,
the frozen 3.0 schema (a 1,500-line mechanical copy), 300 to 450 lines
across the importers, and tests as large again; it may split along
`orm-format-3`'s lines with no release between. 6c: 250 to 400. 6d:
about 250 plus tests. 6e: 350 to 500 across 12 files. 6f: under 100.

### 7. Migrate the tracked corpus

`barwise migrate` over the 119 tracked `.orm.yaml` files (25 carry UUIDs,
about 5,100 occurrences) and the fixtures with hand-written
ids (`ot-customer`, `r-places-order`). Grounded counts (2026-10-29): 119
tracked files, 118 with `id:` lines (6,371); 25 carry UUIDs (5,137, the
largest `docs/auction.orm.yaml` with 1,562); 21 set `source_context`.
The goldens and eval references change in 6b, where the 3.x reader first
rewrites ids. WS7 also migrates the tests holding UUID literals (`cli/tests/commands/exportLineage.test.ts`, `lineage.test.ts`,
`mcp/tests/tools/impactAnalysis.test.ts`,
`formats/tests/NormaJoinPaths.test.ts`, three in code-analysis) and
`docs/ORM_PROJECT_GUIDE.md`. The test builder moves in 6a.

## API and migration impact

- `@barwise/core` gains `localName`, `namespaceOf`, `iriOf`, `renameInModel`
  and `renameInProject`; `generateId()`, `setIdGenerator` and
  `createUuidv7Generator` are removed (6b). Every
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
   **Decided: (a)**, amended by decision 20: the fact type keeps its name,
   and its id comes from the first reading.
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
    an encoded name wherever a name is shown. **Decided: (a).** Ids at
    creation that are not `localName(name)`: a suffixed one (`_N`,
    decision 5a's role suffixes), which validation reports, and decision
    20's, which it does not.
14. **When a minted name counts as stale.** (a) when its text differs from
    the current verbalization, which also fires on every constraint after a
    release changes the verbalizer's wording. (b) when the element's content
    -- kind, roles, values -- differs from what it was minted from, which
    needs a stored content key and ignores wording changes. (c) never; a
    minted name is a name. **Decided: (b).**
15. **Lineage across the format change.** (amended 2026-10-29, below) (a) a 3.x manifest reads stale
    once, with the reason named, and a re-export or `migrate` restamps it.
    (b) keep `canonicalizeIds` in 4.0, fixed to replace only `id` values and
    reference fields, so a 3.x hash and a 4.0 hash of one model agree and
    nothing reads stale. (b) is quieter but keeps code whose reason the
    format removes. **Decided: (a).** Amended by the owner on 2026-10-29:
    `migrate` does not restamp. Restamping only the exports that were
    fresh needs the 3.x hash of the model before migration, so a frozen
    copy of the 3.x writer and `canonicalizeIds` kept for that one use;
    instead every export of a version-1 manifest reads stale once with
    the reason "ids changed to 4.0", and a re-export restamps it. No
    lineage manifest is tracked in the repository.
16. **The project file and older builds.** (a) do barwise-y1b first, so the
    project file carries a version and an older build refuses `iri_base`
    with "written by a newer barwise" instead of a schema error. (b) ship
    `iri_base` unversioned and name the break in the release notes.
    **Decided: (a)**, then amended by the owner on 2026-10-28: y1b ships
    with WS4 as one change. What that gives up, stated plainly: a build from
    before it -- v1.7.0 or an `edge` build since -- refuses at the schema
    every project and mapping file this build writes, `iri_base` or not,
    because each is stamped with `format_version` and both schemas close
    their root; (b) would have broken only files that use `iri_base`. The
    same builds refuse a model carrying `namespace`, which joins 3.0 with no
    bump, as `join_ring` and #767 did; whether that is allowed is open
    (barwise-6om, `schema-versioning.md`). Accepted because v1.7.0 already
    refuses every 3.0 domain file a project written by a current build
    usually refers to -- a project made by `project init` and pointed at
    1.x domain files is the case it does not cover -- and `edge` is a
    moving pre-release. Stamping is kept over
    leaving 1.0 files unstamped because a file that states its version is
    `schema-versioning.md` decision 1, and from the next change to either
    file an older build answers "newer barwise".
17. **Where an unnamed element's id is given.** (a) when it joins the
    model, in `OrmModel`'s add methods, which every path already passes
    through. (b) a separate `assignIds(model)` pass every entry point must
    call, which a new importer can forget, and which a serializer guard
    would report only at save time. (c) when the file is saved, rejected in
    WS3: typing in the editor and saving never passes through the
    serializer. **Decided: (a)** (owner, 2026-10-28).

    What follows from it, for WS6 to build:

    - An id a person or tool wrote is kept and is never stale.
    - Two requirements bind the order in which names are given, and WS6's
      grounding settles the mechanism: an id the file states always wins
      over a minted name, wherever the two sit in the file, and the result is
      a function of the input, so two builds of one input agree. Decision 4
      (an objectified fact type's id comes from its first reading,
      decision 20) and decision 5
      (refuse for new authoring) apply before any suffix, decision 4 where
      the objectification is known when the fact type is added (6b).
    - Nothing is minted where the verbalization is not of the element.
      `addConstraint` does not check roles, and a lenient load
      (`skipPlayerValidation`: validate, migrate, merge's incoming side,
      the editor's diagnostics) adds elements whose references dangle; such
      an element is left unnamed and validation reports it. How that state
      is typed is WS6's.
    - A minted name exists in memory until a surface writes the file. The
      editor parses what a person types and never writes it, so a constraint
      typed without an id is re-minted on every load, and decision 14's
      stale check, which compares against the stored key, cannot fire on
      it. WS6 gives such an element a diagnostic saying its id is not yet
      stored, and a way to store it: an editor action, and `barwise
      migrate` writing a current-version file whose ids are unstored, which
      it does not do today (it skips a current file). Until it is stored,
      nothing else may refer to it by id.

18. **Does 4.0 read 2.0?** (a) yes: the 2.0 reader feeds the same replay
    as 3.x, so a 2.0 file goes to 4.0 in memory. (b) no: a 2.0 file is
    migrated with a 3.x build first. **Decided: (a)** (owner, 2026-10-29).
19. **A subtype fact or objectification whose references dangle.** It
    cannot be verbalized, so it cannot be minted. (a) it is left unnamed:
    those two classes allow an absent id and validation reports it. (b)
    it is named from the ids it refers to, so every element has an id.
    **Decided: (a)** (owner, 2026-10-29), as decision 17 already says.

20. **What decision 4 changes: the name or only the id.** WS6's plan review
    found that applying decision 4(a) at import, not only in migration,
    renames a name a user wrote: a NORMA round trip would rename every
    NORMA-convention objectified fact type, and the LLM parser's names would
    change. (a) the fact type keeps its name, and its id is built from its
    first reading; the drift rule does not report that id. (b) the name
    becomes the first reading, at import and in migration. (c) (b) in
    migration only, and the suffix rule at import (`Enrollment_2`).
    **Decided: (a)**, at import and in migration (owner, 2026-10-29).

## Risks and testing

- **A rename that misses a reference** leaves a dangling id in another file.
  WS5's tests rename each element kind inside a split project and validate
  every domain, mapping and manifest, not only the renamed model.
- **The migration renames something a person relies on.** Every suffix and
  rename it adds is reported; `migrate --check` shows them before writing.
- **A content pass pairs the wrong elements.** It runs after the id and name
  passes, on what they left; WS6's tests include two entity types of one
  shape, one removed and one added under new names, in diff, and show merge
  refusing a content pair.
- **A namespace input changes and every IRI moves.** Editing a project's
  `iri_base`, a context, or a model's `namespace` moves every IRI `iriOf`
  gives, though no stored id changes, because ids are local names (6b).
  The project's display name is kept out of the namespace for this reason
  (WS4). Diff reports a model's own namespace and imports (6b); a project
  export's IRIs are untracked by lineage, and an export under a model's own
  namespace is covered by the model's hash (6e); a context renamed by
  hand is reported as unresolved aliases until a context rename exists.
- Run the full monorepo build and tests after each workstream; WS6 changes
  core's public API.

## Non-goals

- No change to verbalization, validation semantics or mapping output beyond
  the identifiers they print.
- No RDF or OWL export, and no publishing of IRIs.
- No subproject structure, and no IRI for a data product.
- No change to how transcript samples are compared.
