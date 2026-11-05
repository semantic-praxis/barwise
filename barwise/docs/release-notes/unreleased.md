## Model file format 4.0: readable ids

This release writes `.orm.yaml` files at `orm_version: "4.0"`. It is a
major release: the file format changes in a way older barwise cannot read,
the CLI no longer takes `--api-key`, and the library's public API changes.

**An element's id is now its name.** In 4.0 an object type `Order` has the
id `Order`, a fact type `Customer places Order` has `Customer_places_Order`,
and a role on it has `Customer_places_Order.places`. Ids are no longer
UUIDs or hand-picked codes like `ot-customer`. A constraint, subtype fact or
objectification gets an id from what it says, and records the text it was
named from in a `minted_from` field beside it. Because ids are names, a
diff, a lineage report or a diagnostic names elements in words a reader
knows, and two people who model the same thing write the same ids.

**Older files still open.** A file at format 1.x, 2.0 or 3.0 loads as it
always did: its ids are replayed into 4.0's in memory, and it is written as
4.0 the next time it is saved. Until then, `barwise validate` and the editor
name its elements by their 4.0 ids, which the file does not yet state, and
say so once, as an info diagnostic ("This file is in a format before
4.0...").

**What to do:**

1. Upgrade everyone who shares the models first: the CLI, the MCP server
   and the VS Code extension. **barwise 1.7.0 and earlier cannot read a
   4.0 file** and refuse it with "the file was written by a newer barwise;
   upgrade barwise to read it." Every file this release saves is 4.0.
2. Keep any YAML comments you care about somewhere else. The next step
   writes each file from the model, so comments and hand layout are not
   kept.
3. Run `barwise migrate` on your models, or on a project's
   `.orm-project.yaml` so every domain moves together and each shared
   object type keeps one id across domains. `barwise migrate --check`
   lists what would change without writing anything. `migrate` also drops
   an `is_preferred` flag that identifies no entity type, and keeps one of
   two flags that name the same entity type, printing each under its file;
   run `barwise validate` with your 1.7.0 build first to see those cases
   before they are resolved. See `docs/CLI.md`, "migrate".
4. Re-export anything you track with `barwise lineage`. Exports made
   before 4.0 name the old ids, so `barwise lineage status` reports each
   one stale with the reason "ids changed to 4.0", and the next export
   records the new ids.
5. Replace `--api-key` in any script with the `ANTHROPIC_API_KEY` (or
   `OPENAI_API_KEY`) environment variable; see below.

### The CLI no longer takes `--api-key`

Every CLI command now refuses `--api-key`, prints "--api-key was removed,
and the value was NOT used", and exits 1, so a script that passes it stops.
A key on the command line ends up in shell history, CI logs and the process
list. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the environment instead.
In VS Code the `barwise.anthropicApiKey` setting is deprecated: its value is
moved into VS Code's secret store, backed by the OS keychain, the first time
it is used, and the setting is cleared.

### Renaming an element now renames its id

`barwise rename` (and the MCP server's `rename_element`, which the VS Code
extension uses) renames an object type, a fact type or a role, and gives
it the id its new name gives. A renamed fact type's roles, populations and
instances follow it, and through a project so do the copies of an object
type in other domains. The lineage manifest beside each changed file is
rewritten in the same write.

Two things do not follow. A fact type named after a renamed object type
keeps its own name and id, and a constraint keeps its id; `barwise validate`
warns where one now describes its element wrongly
(`structural/stale-minted-name`), so you can rename it too. And `rename`
works on 4.0 files only: it refuses an older file and asks you to migrate it
first. See `docs/CLI.md`, "rename".

### Shared object types name their owner

A domain of a project can use an object type another domain owns. Such a
copy, a shadow, now names its owner through an alias the file imports:
`imports: { auctions: auctions }` and the id `auctions:Auction`. Before 4.0
a shadow carried `source_context: auctions` instead; `migrate` rewrites it.
`docs/ORM_PROJECT_GUIDE.md` shows the form.

### IRIs

A model's `namespace` and a project's `iri_base` now give each element an
IRI: the namespace followed by its id. The Apache Ossie export (new in this
release; see below) writes each concept's and relationship's IRI, and the
Ossie import reads the namespace back from them. A namespace is optional: a
model without one has ids but no IRIs.

### Other changes that come with 4.0

- **A stated id must be in Unicode NFC.** A 4.0 file whose id, or the key
  of a map keyed by ids, is not in NFC is refused when it loads, naming the
  element. The ids barwise writes always are.
- **A fact instance id stated twice is refused.** A population that states
  one instance id twice no longer loads, in any format, as a repeated
  constraint id already did not.
- **Merging two unrelated older files is refused.** Two models read from
  files before 4.0 pair by the ids their files stated, so two unrelated
  files that both numbered their types from `ot0` used to merge with no
  error, turning one element into another. `barwise merge` (and the MCP and
  VS Code merges) now refuse a pairing like that and say why. Migrate both
  files first, and they pair by name.
- **Lineage manifests are version 2.** A manifest written by an earlier
  build is read as version 2, with its exports marked as made under the old
  ids.

### What changed in the file before 4.0

This release is also the first to ship formats 2.0 and 3.0, which were
never released on their own. Their changes arrive with it:

- **Constraints are placed by kind (3.0).** A constraint over one fact
  type's roles stays under that fact type. A constraint relating several
  fact types, or subtype links, is listed once under the model's
  `constraints`, where before it was filed under whichever fact type its
  author chose. Subtype exclusion and totality are now constraints of their
  own rather than `is_exclusive` and `is_exhaustive` flags on each subtype
  fact, so a supertype can carry more than one of each.
- **The preferred identifier is stated on the entity type (3.0).** An entity
  type names the constraint that identifies it in `preferred_identifier`,
  where before a uniqueness constraint carried an `is_preferred` flag.
- **Every constraint has a stable id (3.0).** A constraint a file leaves
  without an id used to get a random one on every load, so the same file
  exported to NORMA twice gave different ids. It now gets the same id
  every time.
- **Diagrams refer to elements by id, not by name (2.0)**, and
  **`elements: []` now means an empty view (2.0).** Both are under
  "Diagrams and views (format 2.0)".

### New since 1.7.0

- **Commands:** `barwise migrate` and `barwise rename` (above),
  `barwise merge` (merge one model into another, writing the result to
  stdout or `--output`; it never changes its inputs), `barwise review` (an
  LLM's modeling advice on a model), and two developer commands,
  `barwise prompt` and `barwise llm-usage`. See `docs/CLI.md`.
- **Apache Ossie** import and export, a format for ontologies, through
  `barwise import model` and `barwise export --format ossie`.

### For code that uses `@barwise/core`

- **Removed:** `generateId()`, `setIdGenerator`, `uuidv7FromParts` and the
  `IdGenerator` type. Core mints no random id and reads no clock; an element
  added without an id is given the one its name gives.
- **`ObjectType` is a type, not a class:** `EntityType | ValueType`.
  `new ObjectType(...)`, `instanceof ObjectType` and the `isEntity` and
  `isValue` getters are gone; use `createObjectType`, `isEntityType` and
  `isValueType`. `SubtypeFact` and `ObjectifiedFactType` no longer extend
  `ModelElement`.
- **Constraints:** `FactType.constraints` is removed.
  `FactType.internalConstraints` holds a fact type's own constraints, and
  `OrmModel.constraints` holds the rest. `SubtypeFact.isExclusive` and
  `isExhaustive` are removed, and a uniqueness constraint no longer carries
  `isPreferred`: the entity type holds its preferred identifier.
- **New:** `localName`, `namespaceOf` and `iriOf` from the package root, and
  `renameInModel` and `renameInProject` from `@barwise/core/rename`.

## Project and mapping files state their format version

`.orm-project.yaml` and `.map.yaml` files now start with
`format_version: "1.0"`, which barwise writes on every such file it saves.
Files without it still open and are read as 1.0. A file from a newer
barwise is refused with "the file was written by a newer barwise".

**Older barwise cannot read project or mapping files this release
writes.** barwise 1.7.0 and earlier, and earlier `edge` builds, refuse
them with a schema error ("must NOT have additional properties"), not the
"newer barwise" message, because they read no format version. The same
builds refuse a model that declares a `namespace`.

Two optional fields arrive with it: `iri_base` on a project and
`namespace` on a model, which say where element IRIs start. With format
4.0 they give each element an IRI; see "IRIs" above and
`docs/ORM_PROJECT_GUIDE.md`.

## Diagrams and views (format 2.0)

- **Diagrams refer to elements by id, not by name.** A diagram's
  `elements` list and its `positions` and `orientations` keys now hold
  element ids, like every other reference in the file. Renaming an object
  type or fact type no longer drops it from saved views or loses its
  position. The upgrade rewrites each name it can match to that element's
  id. A name that matches nothing is kept as written, and `barwise
  validate` reports it as `structural/diagram-dangling-reference`
  (a warning).
- **`elements: []` now means an empty view.** Leaving `elements` out
  still means "show every element". In 1.x an empty list also meant "show
  every element", so the upgrade removes an empty list from older files
  and those views look the same as before. Removing the last element from
  a view now leaves it empty instead of turning it back into a full view,
  and `barwise validate` reports that as `structural/diagram-empty-view`
  (info).

## Other changes in this release

### NORMA export and import follow view scope

- Exporting to NORMA now draws the object types and fact types each saved
  view shows: the view's object types, plus every fact type whose players
  are all in the view. Previously the export drew one shape for each saved
  position, so fact types were usually missing and a view with no saved
  positions came out empty. Shapes with no saved position are placed
  automatically below the positioned ones. Subtype links are still not
  exported, so a view that shows them in VS Code has no subtype connectors
  in NORMA.
- Importing a NORMA file keeps each diagram's object types: the object
  types a NORMA diagram shows become that view's `elements`, and the view
  then shows every fact type whose players are all in it. Two cases do not
  round-trip. A NORMA diagram that shows every object type imports as a
  full view, even if it leaves out some fact types, so exporting it again
  draws all of them. An empty NORMA diagram is skipped on import, so an
  exported empty view does not come back.

### OpenAPI item paths carry the whole key

A table keyed on several columns, such as the table for a many-to-many
fact type, now gets an item path with one parameter per key column, in
key order: `/student-enrolls-in-course/{student_id}/{course_id}`. Before,
the path named only the first column, which addresses many rows.
**Clients generated from an earlier OpenAPI export call the old, shorter
path for these resources and need regenerating.** Resources keyed on one
column are unchanged.

### Binary constraint sentences state the whole reading

A binary mandatory or uniqueness sentence now keeps the reading's words
after the second role: "Each Patient has at most one Doctor as primary
doctor." Before, it kept only the words between the two roles, so "as
primary doctor" was dropped. A single-role frequency sentence now says
only what the constraint says: "Each Customer that rates some Product
rates at least 1 and at most 10 instances of Product." The old "Each
Customer rates at least 1 and at most 10 Product" also claimed that every
Customer rates something. These sentences appear in DDL comments and in
the dbt, OpenAPI, Avro and Ossie constraint reports, so those files change
text on the next export.

### DDL lineage names the constraints a table states

`barwise lineage impact <constraint id>` now reports the DDL table a
constraint is written on, as a UNIQUE or CHECK clause or as a comment the
dialect could not enforce. Before, only a foreign key's constraint was
listed. An impact report now words a constraint "states constraint X",
not "enforces". A constraint over subtypes that an export reports also
carries an example of the instance it forbids: "one Party in both
LegalEntity and NaturalPerson".

### The dbt export writes the current test syntax

`schema.yml` now lists tests under `data_tests:` and puts each test's
inputs under `arguments:`, such as a relationships test's `to` and
`field`. dbt 1.10.8 and later warn on the old form, and dbt requires that
warning resolved before the move to Fusion (dbt 2.x). A project on dbt
1.10.5 to 1.10.7 reads the new form without a warning once it sets
`require_generic_test_arguments_property: true`. One before 1.10.5
cannot read it. Re-importing a project in either form gives the same
model.

### A foreign key over several columns round-trips as one reference

- **dbt export.** A foreign key over several columns used to be dropped,
  because dbt's `relationships` test takes one column. It is now written
  as a model-level `foreign_key` constraint, which needs dbt 1.9 or later.
  No contract is written, so dbt records the constraint without enforcing
  it, and the models build as before. Re-importing the project reads it as
  one reference.
- **DDL import.** A foreign key over several columns outside the table's
  key used to import as one reference per column, so
  `claim (policy_id, term_number)` gained two references to
  `policy_period`. It now imports as one. It is mandatory when every
  column is NOT NULL, and one-to-one when its columns are a UNIQUE of the
  table. A model imported earlier keeps its extra references until it is
  imported again.
- **Some UNIQUEs and keys are now refused with a warning.** A UNIQUE, or a
  composite PRIMARY KEY, over part of such a foreign key, or over a column
  two foreign keys share, used to import as a constraint on a reference
  that did not exist. It is now refused with a warning naming the
  columns, as a UNIQUE over part of a relationship's role already was.
- **A key that is one foreign key.** A DDL table or dbt model whose key is
  exactly one multi-column foreign key imports as an entity with a key of
  its own and a one-to-one reference. The dbt importer used to find no
  identifier and skip such a model.

### The dbt export keeps every uniqueness

- **Export.** `schema.yml` now tests every uniqueness the DDL export
  writes as a UNIQUE clause: a secondary unique column, a one-to-one
  reference, or a second key of a relationship table. Before, only each
  table's key was tested and the rest were reported as dropped.
  - A uniqueness over several columns uses
    `dbt_utils.unique_combination_of_columns`. A project that never needed
    dbt_utils may now need to declare it; the export's annotation notes
    each model that does.
  - Each model states its key as a `primary_key` constraint (dbt 1.5 or
    later). No contract is written, so it is metadata and the models build
    as before.
  - `dbt test` now runs these tests, so data that breaks a uniqueness the
    model states fails it.
- **Import.** The dbt importer reads a declared `primary_key` as the key.
  It reads `unique` on a reference column as a one-to-one, and a
  combination test beside the key as the uniqueness the DDL importer reads
  for the same UNIQUE. Before, those were reported for manual review. A
  project without `primary_key` keeps the old key guess.

### An annotated DDL round trip no longer adds a key column

A table whose entity objectifies a relationship keyed on one column, such
as a work order keyed on its batch, used to come back from a DDL export
with barwise annotations carrying a second identifier. The next export
then wrote an extra column for it, with a UNIQUE. The import now leaves
the key to the relationship, so the table exports as it did before.

### A DDL round trip keeps each entity's preferred identifier

An entity that came back from a DDL export and import used to lose its
preferred identifier when its table was keyed on several columns, or when
its identifier was not the table's key: 42 entities in the tracked models
did. The import now makes the uniqueness a multi-column key reads as the
entity's preferred identifier, for plain and annotated DDL alike, as it
already did for a key of one column. A composite primary key over plain
columns is now the entity's identifier; it used to be stored unpreferred,
so the next export keyed the table on an invented column. Where the identifier is not the key (an objectifier
identified by a value of its own, a subtype keyed on its supertype link),
the barwise annotation names its columns in a new `identifiedBy` field,
and the import reads it.

The dbt import now does the same for a model keyed on several columns
that it objectifies: the key's uniqueness is the objectifier's preferred
identifier, where it used to store none (24 entities in the tracked
models). And an annotated DDL table now follows its barwise line: it is an
objectifier only when the line says so, so an entity identified by two
references no longer returns as the objectifier of an invented fact type,
and it keeps the line's reference mode whatever its key's width.

### Ring sentences, OpenAPI path parameters and Avro field names

- A ring constraint's sentence keeps the reading's text after its second
  role: "No EntityNode specializes that same EntityNode as supertype." It
  used to drop "as supertype".
- An OpenAPI item path names each key parameter with a valid template
  variable, and an Avro record each field with a valid Avro name. A
  column named outside those alphabets, such as `(ambiguous)` from an
  unresolved reference mode, is renamed (`_ambiguous_`), and the
  parameter's description or the field's doc names the column.
- The example exports under `examples/transcripts/` are gone. They had
  drifted from the exporters, and nothing checked them; the CLI's
  characterization goldens now record and check the same exports.

### The Ossie import names fields the pinned schema does not define

A field in an Apache Ossie ontology document that the pinned
`0.2.0.dev0` schema does not define, such as a typo or a field a later
upstream commit added under the same version string, used to be ignored
with no warning. Each one is now named in the import warnings by its
path (`concept Airport.relationships[0].colour`), and the import
otherwise proceeds as before, at medium confidence.

### Generated keys on a warehouse export

`barwise export --format ddl|dbt --surrogate-keys` (and `surrogateKeys`
on the MCP server's `export_model`) gives every table keyed on several
columns one generated key, the hash `dbt_utils.generate_surrogate_key`
computes, and makes every reference to such a table a single column. The
natural key stays enforced as a UNIQUE, or a combination test in dbt, and
the dbt models compute each generated column from the natural columns
kept beside it. The option is off by default; without it, nothing in an
export changes.
