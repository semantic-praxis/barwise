## Model file format 2.0

This release writes `.orm.yaml` files at `orm_version: "2.0"`. Files from
earlier versions still open: they are upgraded automatically when loaded,
and saved as 2.0 the next time they are written.

**Older barwise cannot read 2.0 files.** barwise 1.7.0 and earlier refuse
them with "the file was written by a newer barwise; upgrade barwise to
read it." Every file this release saves is 2.0, whether or not it has
diagrams. If a team shares models, everyone needs this release (CLI, MCP
server and VS Code extension) before anyone saves a file with it.

### What changed in the file

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
the key to the relationship and restores the entity's preferred
identifier from the column the annotation names.
