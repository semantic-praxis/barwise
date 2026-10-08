# NORMA export draws what the view shows

Status: Implemented 2026-10-08 (single change). D1 resolved during self-review: import now writes `elements` (see D1).
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-1065

## Principle

Composability and DRY: "which elements belong to a saved view" is one
decision, and the VS Code diagram panel and the NORMA exporter each made
it their own way. The panel reads `elements` and adds every relation
whose players are all in the view. The exporter ignored `elements` and
emitted one shape per saved position. The two disagreed, and the
exporter's answer was wrong. Moving the rule into core, as a pure
function both packages call, makes the export draw what the panel shows.

## What the edge build does today (measured 2026-10-08)

Exported with the `edge` CLI bundle (commit 6d724c3, checksum verified),
from a model with three entities, two fact types and four saved views:

| View                                          | Expected                | Exported                |
| --------------------------------------------- | ----------------------- | ----------------------- |
| `elements` of 2, no positions ("Create View") | 2 objects, 1 fact type  | nothing                 |
| `elements` of 2, positions for 3              | 2 objects, 1 fact type  | 3 objects, 0 fact types |
| no `elements`, object positions only          | 3 objects, 2 fact types | 3 objects, 0 fact types |
| `elements: []`, one stale position            | nothing                 | 1 object                |

The panel saves a fact type's position only when the user moved it, so
in practice no exported diagram carries its fact types.

## Scope

- Core gains `viewMembership(model, layout)`: for a scoped view, the
  listed object types that exist, every fact type whose players are all
  among them, and every subtype fact whose two ends are; for a show-all
  view, every object type, fact type and subtype fact. `containedRelations`
  is the relation half, shared with the session's ghost path. The session's
  live-reload path deliberately differs: it shows a newly added fact's
  outside player for the rest of the session without writing it to
  `elements` (`diagram-view-reload-scope.spec.md`), so until it is saved
  the panel can show one element more than the export.
- What the panel folds away is not drawn as its own shape, and the rules
  live in core so the panel's `ModelToGraph`, the exporter and the importer
  share them: an entity type that only objectifies a fact type is drawn as
  that fact type (`pureObjectifyingEntityIds`), and a reference-mode value
  type with its identifying fact type is drawn as the entity's
  "(.ref_mode)" label (`absorbedReferenceModes`, moved from `ModelToGraph`
  unchanged). A value type that also plays another role stays drawn; its
  identifying fact type is still folded.
- A fact type is drawn only when every one of its players is drawn.
- When the diagram session loads a named view, it shall build its filter
  with `viewMembership`.
- When a layout is exported to NORMA, the exporter shall emit one shape for
  each object type and fact type in `viewMembership`, and none for anything
  else, whatever positions the layout carries.
- When a member has a saved position, its shape shall be centered there.
- When a fact type has no saved position, its shape shall be centered at
  the mean of its players' centers.
- When an object type has no saved position, it shall be placed in a row
  150 px below the lowest positioned shape, starting at the leftmost
  positioned x, in model order, each box starting 60 px after the previous
  one ends (widths from the exporter's own size estimate). With nothing
  positioned, the row starts at (100, 100).
- When a generated shape's estimated box, plus a 10 px margin, would
  overlap a placed box, it shall move down 40 px until clear. Saved centers
  never move.
- When a NORMA diagram is imported, its object-type shapes shall become the
  view's `elements` (each id once), plus the objectifying entity of every
  objectified fact type it shows, since NORMA draws an objectification only
  as its fact type. A diagram that shows every object type except the
  folded-away ones imports as show-all.

Out of scope:

- Subtype links. NORMA draws them as connector shapes, and neither side
  persists connectors today (norma-export spec, WS2). Membership still
  counts subtype facts so the session's behavior does not change.
- Fact type orientation in NORMA (`DisplayOrientation`).
- An empty NORMA diagram (no shapes) is still skipped on import, as
  before, so an exported `elements: []` view does not come back.
- A NORMA diagram that shows every object type but only some fact types
  imports as show-all, and re-export draws every fact type. A view lists
  object types only; leaving out individual fact types would need a new
  field in the format.

## Inventory

| Module                                  | Change                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `core/src/model/diagramView.ts` (new)   | `viewMembership`, `containedRelations`, `pureObjectifyingEntityIds`, `absorbedReferenceModes` |
| `diagram/src/graph/ModelToGraph.ts`     | Calls the two folding rules from core instead of its own copies                               |
| `formats/src/norma/mapping/diagrams.ts` | Import writes `elements` from a diagram's shapes                                              |
| `core/src/index.ts`                     | Export both                                                                                   |
| `diagram/src/session/DiagramSession.ts` | Named view and relation expansion call the core functions                                     |
| `formats/src/norma/NormaXmlWriter.ts`   | Shapes from membership; deterministic placement                                               |
| `formats/tests/*`                       | The four views above, plus placement rules                                                    |

## Alternatives considered

- **Use the diagram package's ELK layout for unpositioned members.**
  Better placement, but `@barwise/formats` depends only on core, and ELK
  is async. The row-and-midpoint rule is deterministic and NORMA users
  rearrange shapes anyway.
- **Copy the session's rule into the exporter.** Two copies of a rule that
  must agree, which is the defect class barwise-1066 just removed.

## Open decisions (for review)

- **D1: import NORMA shapes as `elements`. (Resolved: yes, in this
  change.)** The draft deferred it. Self-review showed that deferring it is
  a regression: the importer wrote every NORMA diagram as show-all, and the
  exporter now draws show-all as the whole model, so a NORMA file with
  three partial diagrams would re-export as three full ones. Importing a
  diagram's object shapes as `elements` round-trips the scope. The cost
  stands: a NORMA-authored diagram that omits any object type (reference
  mode value types included) imports as scoped, so object types added
  later do not appear in that view until added to it.

## Risks and testing

- The NORMA geometry round-trip test asserted that only saved positions
  come back. Every member now has a shape, so re-import returns saved
  positions exactly plus generated ones for the rest; the test asserts
  both.
- The session's existing view tests must pass unchanged: the membership
  rule moves, it does not change.
- Every rule gets the undo-and-confirm-a-test-fails check, and the
  `code-review` skill runs before the PR opens.

## Non-goals

- No change to the `.orm.yaml` format or to how the panel lays out views.
