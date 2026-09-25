# An empty diagram view means an empty view

Status: Implemented 2026-09-25 (single change).
Created: 2026-09-25
Last-updated: 2026-09-25
Tracking: barwise-1066

## Principle

Define errors out of existence. A saved view's `elements` list had two
spellings for "show every element": the field absent and the field
empty. So any code path that removed the last entry from a filtered view
turned it into a show-all view. #557 found two such paths (element
removal and merge, and "Save View") and guarded each one separately. A
third path would need a third guard, and nothing would say so. Giving
`[]` its own meaning removes the failure instead of guarding it.

## Should `[]` mean "no elements"? (resolved: yes, inside orm_version 2.0)

Yes. Absent means "show every element", and `[]` means the view shows
nothing. A view emptied by removing elements then says exactly what is
left in it, which is nothing, and both guards go away.

No new version. ADR-0001 bumps the format once per unreleased cycle, and
2.0 is unreleased: v1.7.0 is the latest release, and 2.0 exists only in
the moving `edge` pre-release since #557 merged on 2026-09-25. The 2.0
serializer never writes `elements: []`, so the only 2.0 file that
changes meaning is one someone hand-edited to contain an empty list, in
an edge build, in that window. That exposure is accepted and stated in
the PR.

## Scope

- When a layout's `elements` is an empty list, the serializer shall write
  `elements: []`, and the deserializer shall keep it as an empty list.
- When a named view's `elements` is an empty list, the diagram session
  shall show no elements. When it is absent, the session shall show all.
- When removal or merge takes the last id out of `elements`, the layout
  shall keep `elements: []`. `withoutDiagramReferences` loses its
  keep-the-list exception.
- When "Save View" renders no object types, `buildViewLayout` shall save
  `elements: []`. The guard that copied the existing list is removed.
- When a 1.x document has `elements: []`, the 1.1 -> 2.0 migration shall
  delete the field, because in 1.x an empty list meant "show all".
- The VS Code "Add to View" picker shall list empty views, and the
  sidebar shall show "0 elements" for them.
- Every reader of `elements` shall decide "scoped or show-all" through one
  core predicate, `isScopedView`, rather than restating the test. The
  defect came from each reader writing its own test.
- When a view is emptied, validation shall report
  `structural/diagram-empty-view` at info severity. The kept stale id used
  to produce a warning; without this, nothing would tell the user.
- When "Save View" runs with a view filter active, the saved elements
  shall come from the filter, not from the last render. The render can be
  missing or stale, and a render-derived `[]` would now empty the view.
- When a ghost is promoted into a view whose `elements` is absent, the
  view shall be left alone (it already shows everything), rather than
  narrowed to the one ghost.

Out of scope: NORMA export (barwise-1065, on hold).

## Inventory

| Module                                    | Change                                              |
| ----------------------------------------- | --------------------------------------------------- |
| `core/src/serialization/yaml/diagram.ts`  | Write `elements` whenever it is defined             |
| `core/src/model/DiagramLayout.ts`         | Doc; `withoutDiagramReferences` loses the exception |
| `core/src/serialization/migrations/...`   | 1.x `elements: []` becomes absent                   |
| `core/schemas/orm-model.schema.json`      | Description of `elements`                           |
| `diagram/src/session/DiagramSession.ts`   | Filter on `elements !== undefined`; drop save guard |
| `vscode/src/client/extension.ts`          | "Add to View" lists views with `elements` defined   |
| `vscode/src/sidebar/ModelTreeProvider.ts` | Count shows 0 for an empty view                     |
| `core/src/validation/rules/structural.ts` | Info `structural/diagram-empty-view`                |
| `vscode/src/diagram/DiagramPanel.ts`      | Ghost promotion leaves a show-all view alone        |

The renderer needs no change: an empty include filter already renders an
empty diagram (`ModelToGraph` skips every element not in the filter).

## Alternatives considered

- **Keep both guards.** Works today, and costs a guard in every future
  path that rewrites `elements`, with no check that fails when one is
  missing. That is the silent-divergence case the principle warns about.
- **Drop the view when it empties.** Loses the view's name and positions,
  and the user did not ask to delete a view.

## Risks and testing

- The tests #557 added for the two guards now assert the new meaning:
  removal and merge leave `elements: []`, and "Save View" saves `[]`.
- New tests cover the round-trip of `[]` against an absent field, the
  session rendering nothing for `[]`, and the 1.x migration of `[]`.
- Each change gets the undo-and-confirm-a-test-fails check before push.
- The three VS Code call sites (picker, sidebar, ghost promotion) have no
  unit tests: they depend on the editor API. They call `isScopedView`,
  which is tested, so what stays untested is the wiring, not the rule.

## Non-goals

- No change to how a non-empty view is filtered, and no UI for creating
  an empty view on purpose.
