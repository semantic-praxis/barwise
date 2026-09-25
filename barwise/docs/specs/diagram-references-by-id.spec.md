# Diagram definitions reference elements by id

Status: Implemented 2026-09-24 (single workstream). D1-D3 were built at their recommended defaults: 2.0, unknown names kept, dangling references warn.
Created: 2026-09-24
Last-updated: 2026-09-24
Tracking: barwise-1063

## Principle

Explicit over implicit: every cross-reference in `.orm.yaml` names its
target by id, so a rename changes one `name:` field and nothing else.
Role players, subtype facts, objectifications and constraints already do
this. The `diagrams:` section is the one exception. Its `elements` list,
its `positions` keys and its `orientations` keys are element names, so a
rename silently breaks the reference. The renamed type drops out of every
view that listed it and loses its saved position. Nothing reports this,
because the resolver just skips a name it cannot find
(`DiagramSession.applyNamedView`, `seedOverridesFromSavedLayout`).

## Should diagram references move to ids? (resolved: yes, as orm_version 2.0)

Yes. The maintainer decided this on barwise-1063. Ids are what the rest
of the file uses, and ids are stable across renames by construction. The
cost is legibility: `positions: { ot-asset: ... }` reads worse than
`positions: { Asset: ... }`, and a model whose ids are UUIDs reads worse
still. That cost is accepted. The diagram section is written by tools
(the VS Code panel, the NORMA importer), not by hand, and ADR-0001's
legibility argument is about the constructs a human or an LLM authors.

The version bump is not optional. A barwise that reads 1.1 would load a
2.0 file, look each id up as a name, find nothing and render the whole
model. That is the same silent failure this spec removes. ADR-0001 says
a structural change bumps the major version with a real migration, and
the bump is what turns an older reader's silent misread into the
serializer's existing "written by a newer barwise" error.

## Scope

In scope:

- When a model is serialized, the system shall write each diagram's
  `elements`, `positions` keys and `orientations` keys as element ids.
- When a 1.x document is loaded, the system shall rewrite each diagram
  reference that matches an element name in the same document to that
  element's id, and stamp the document `2.0`.
- When a 1.x diagram reference matches no element name, the migration
  shall keep it verbatim rather than drop it, unless its spelling equals
  the id another reference in the same field resolved to. In that case the
  resolved reference wins: the unmatched one pointed at nothing, and
  keeping it would overwrite a real position with a stale one that then
  validates.
- When a diagram references an id that does not resolve to the kind its
  field holds (`elements`: object types, `orientations`: fact types,
  `positions`: either), validation shall report
  `structural/diagram-dangling-reference` as a warning that names the
  diagram, the field, the reference and the expected kind.
- When an object type or fact type is removed through `OrmModel`, the
  system shall remove its id from every diagram layout.
- When that removal would empty a view's `elements` list, the list shall
  be kept as it was. An empty list means "show every element", so emptying
  it would turn a filtered view into a show-all view on the next render
  and drop the filter on the next save. The kept id is reported by
  validation. The same rule applies to a merge, through one shared helper
  (`withoutDiagramReferences`).
- When a merge drops an element, the merged model's carried layouts shall
  not reference it. A reference that was already dangling before the merge
  is carried unchanged, so validation still reports it.
- When the diagram panel saves a layout or a view, or the editor's
  "Create view" and "Add to view" commands write one, the system shall
  write ids.
- When a NORMA file is imported, diagram positions shall be keyed by id.
  When a model is exported to NORMA, shapes shall be resolved by id.

Out of scope:

- The NORMA exporter ignoring `elements` (barwise-1065). The maintainer
  is holding it until the defect is confirmed in the latest release.
- Emitting YAML comments with element names beside ids. The serializer
  writes no comments anywhere today, and whole-file rewrites discard
  them (the span-edit work in #555).

## Inventory

| Module                                        | Change                                                         |
| --------------------------------------------- | -------------------------------------------------------------- |
| `core/src/model/DiagramLayout.ts`             | Doc comments: keys and `elements` are ids                      |
| `core/src/serialization/schemaVersion.ts`     | `CURRENT_ORM_VERSION` 2.0; 1.1 -> 2.0 migration resolves names |
| `core/schemas/orm-model.schema.json`          | `orm_version` const 2.0; diagram descriptions say ids          |
| `core/src/model/OrmModel.ts`                  | `removeObjectType` / `removeFactType` prune layouts            |
| `core/src/diff/ModelMerge.ts`                 | Carried layouts drop ids absent from the merged model          |
| `core/src/validation/ruleId.ts`, `structural` | New warning `structural/diagram-dangling-reference`            |
| `diagram/src/session/DiagramSession.ts`       | Resolve and collect by id; `addGhostToView` returns the id     |
| `vscode/src/diagram/DiagramPanel.ts`          | Persist the promoted ghost's id                                |
| `vscode/src/client/extension.ts`              | Create view / add to view store ids, show names in the pickers |
| `formats/src/norma/NormaXmlWriter.ts`         | Resolve shapes with `getObjectType` / `getFactType`            |
| `formats/src/norma/mapping/diagrams.ts`       | Key imported positions by element id                           |

Unaffected, checked: `splitModel` refuses models that have diagrams
(unchanged). The CLI, MCP and LLM packages never read or write a layout.
`ModelTreeProvider` only counts `elements`. `projectScaffold` stamps
`CURRENT_ORM_VERSION`, so it follows the constant. No checked-in
`.orm.yaml` has a `diagrams:` section, so no fixture changes meaning.
Fixtures stamped `1.1` still load, through the migration.

Ids are unique across object types and fact types in practice, and the
diagram session already keys position overrides by node id across both
kinds. This spec relies on that and does not add a check for it.

## Alternatives considered

- **Keep names; add validation and make rename update references.** Less
  churn and no version bump. Lost because rename is not one operation:
  a hand edit, an LLM re-extraction and a merge each rename in their own
  way, and every one of them would need to know about the diagram
  section. Ids make the rename problem disappear instead of adding a step
  to every path that renames.
- **Accept both names and ids indefinitely.** Resolve a key as an id
  first, then as a name. No bump needed. Lost on explicit over implicit:
  a key's meaning would depend on what else is in the file, and a name
  that happens to equal another element's id resolves to the wrong
  element without any sign.
- **Minor bump (1.2).** ADR-0001 reserves minor bumps for additive
  changes that an older reader can ignore. An older reader cannot ignore
  this one; it misreads it.

## Workstreams

One workstream. The format, the migration and every reader and writer
have to change together: a writer on ids with a reader still on names is
the failure mode this spec exists to remove.

### 1. Switch diagram references to ids

Everything in Scope, with tests:

- Migration: names become ids for all three fields. An unknown name is
  kept. A 1.0 file migrates through 1.1 to 2.0. A document already at
  2.0 is untouched.
- Serializer round-trip of an id-keyed layout. A 1.1 document with a
  name-keyed diagram deserializes to an id-keyed layout, and a rename of
  the object type afterwards leaves the view intact.
- Validation: a dangling id reports the warning, and a valid layout
  reports nothing.
- `OrmModel` removal prunes layouts. A merge that accepts a removal
  carries no dangling id.
- Diagram session: a view resolves by id, and save-layout / save-view
  collect ids. The existing session tests change from name keys to id
  keys.
- NORMA: the export/import geometry round-trip keeps positions, keyed by
  id.

## API and migration impact

- `.orm.yaml` goes from 1.1 to 2.0. barwise 1.7 and earlier refuse 2.0
  files with the existing "written by a newer barwise" message. Any file
  saved by this version is 2.0 whether or not it has diagrams, because
  the serializer stamps the current version.
- `DiagramLayout`'s shape is unchanged, but the meaning of its keys
  changes. Any external caller that builds a layout by name has to switch
  to ids. Inside the repo, the Inventory lists every such caller.
- `DiagramSession.addGhostToView` returns an id rather than a name.
- One new rule id. `RULE_IDS` is derived from the descriptors, so no list
  has to be kept in step with it.

## Open decisions (for review)

- **D1: major or minor bump.** Recommended: 2.0, per ADR-0001 (see
  Alternatives). The trade-off is a release note saying files written
  from now on need barwise 1.8 or later.
- **D2: an unknown name during migration.** Keep it verbatim so the new
  warning reports it (recommended), or drop it silently. Keeping costs a
  warning on a file that already had a broken reference. Dropping loses
  the evidence that the reference was ever there.
- **D3: warning or error for a dangling reference.** Recommended:
  warning. A stale diagram entry does not make the conceptual model wrong,
  and an error would fail `barwise validate` in CI over a layout detail.

## Risks and testing

- Every test that asserts the literal `orm_version` `1.1` on output
  changes to `2.0`. The 1.0 -> 1.1 migration tests stay, now as the first
  step of a chain.
- The session's live-reload tests (`diagram-view-reload-scope.spec.md`)
  build views with `elements`, so they move to ids with the rest.
- Run the full monorepo build and tests: this changes core's serializer.

## Non-goals

- No change to how views are chosen, filtered or laid out. Only the key
  format changes.
- No UI change beyond the pickers showing names for id-backed values.
