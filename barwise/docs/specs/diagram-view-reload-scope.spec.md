# Keep a diagram view's scope stable across live reload

Status: Implemented 2026-09-24 (single workstream)
Created: 2026-09-24
Last-updated: 2026-09-24
Tracking: barwise-1064 (bug report: Asset view in `edpl-domain.orm.yaml`
shows financing, customer and listing clusters)

## Principle

Explicit over implicit: a saved view's `elements` list is a declaration
of what the view contains. The VS Code diagram panel honored it when the
view was loaded, then replaced it with an inference ("anything touching
what is shown") every time the file was re-parsed. The declaration held
for one render.

## What went wrong (resolved: the reload rule could not tell new from old)

`DiagramSession.setModel` runs on every edit to the open `.orm.yaml`,
debounced 300 ms, including the write from the panel's own Save Layout.
It called `expandFilterForNewModel`, written in 617cf025 so that "I added
a new fact involving an entity already in the view" shows up. The rule it
implemented was "add every fact type that touches a visible entity, plus
its players". That rule cannot distinguish a fact type the user just
added from one that was always there, so the first reload admitted every
existing neighbor. Each reload started from the widened set, so a view
grew one hop per edit until it was the full connected component. The
code comment said the expansion was "single-step (not transitive)"; it
was single-step per call and nothing bounded the number of calls.

Three existing tests asserted the growth as correct behavior (reloading
an unchanged model pulls in B, pulls in C, pulls in Party and Employee).

## Scope

In scope:

- When the model is reloaded and a fact type or subtype fact was present
  in the previous model, the system shall not add it or its players to
  the active view.
- When the model is reloaded and a fact type or subtype fact is new since
  the previous model and touches a visible entity, the system shall add
  it and its players to the active view (the original intent of 617cf025).
- When the model is reloaded any number of times with no structural
  change, the system shall draw the same set of object types as before
  the first reload.

Out of scope:

- The NORMA `.orm` exporter ignoring `elements` (barwise-1065). Found
  while investigating; a different surface with a different fix.
- Diagram definitions keyed by name rather than id (barwise-1063). A
  schema question that needs its own spec and a decision.
- Re-reading an edited `elements:` list for the active view on reload.
  Today a hand edit to the active view's definition takes effect on the
  next Load View; unchanged by this spec.

## Inventory

| Module                                                  | Change                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/diagram/src/session/DiagramSession.ts`        | Session snapshots relation ids; expansion skips known ones      |
| `packages/diagram/tests/session/DiagramSession.test.ts` | Three tests that pinned the growth rewritten; three added       |
| `scripts/beads-crud.mjs`                                | `update --status` off `closed` drops `closed_at`/`close_reason` |
| `packages/vscode/src/diagram/DiagramPanel.ts`           | Doc comment on the watcher corrected; no behavior change        |

"New since the previous model" is decided by id, against a set the
session copies at construction and after each `setModel`. Reading the
ids back from the previous model object instead would fail when a caller
mutates the current model and passes it back: the new relation would
already be in "previous" (Copilot review on #553). Ids are required on
object types, fact types and subtype facts in `orm-model.schema.json`,
so a re-parse of unchanged text yields the same ids.

## Alternatives considered

- **Re-resolve the view from its `elements` definition on every reload.**
  Makes the file the single source of truth and picks up hand edits to
  the list. Lost because it drops a newly added fact's other player on
  the following reload (it is not in `elements`), so the fact would
  appear and then vanish, and it discards ghosts the user promoted but
  the write has not yet landed. A candidate for barwise-1063's redesign.
- **Remove the reload expansion entirely.** Simplest, and never grows.
  Lost because it silently drops the feature 617cf025 added: a fact the
  user types next to a visible entity would not appear until Load View.

## Risks and testing

- The two added tests fail on the previous code (`[A, B]` where `[A]` is
  expected, `[A, B, D]` where `[A, D]` is expected) and pass after.
  They re-parse through `OrmYamlSerializer`, which is what the panel's
  document watcher does, rather than passing the same model object back.
- Stale-id pruning and ghost handling are untouched; their existing tests
  pass unchanged.

## Non-goals

- No change to the `.orm.yaml` schema, the webview protocol, or the
  capability matrix.
