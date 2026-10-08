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

- Exporting to NORMA now draws exactly what each saved view shows: the
  view's object types, plus every fact type whose players are all in the
  view. Previously the export drew one shape for each saved position, so
  fact types were usually missing and a view with no saved positions came
  out empty. Shapes with no saved position are placed automatically below
  the positioned ones.
- Importing a NORMA file keeps each diagram's scope: the object types a
  NORMA diagram shows become that view's `elements`. A NORMA diagram that
  shows every object type imports as a full view.
