# Chat participant source resolution

Status: Implemented. WS1 (diagram/visible-editor fallback) and WS2
(chat references) both landed.
Tracking: bug -- `@barwise` chat fails with "No source provided and no
.orm.yaml file is open" when the active panel is the diagram webview (or
the model is attached as a chat reference rather than the focused editor)

## Principle

The `@barwise` chat participant drops the user's clearest statement of
intent. When a user attaches `clinic-appointments.orm.yaml` to the chat
(the reference chip) and asks a question, the participant ignores
`request.references` entirely and resolves the model only from
`vscode.window.activeTextEditor`. That editor is `undefined` whenever the
focused surface is not a text editor -- the diagram webview, the chat
panel itself -- so a tool call with no `source` throws "No source
provided…", even though the model the user means is sitting right there
as a reference (and, often, open in a diagram).

This is an explicit-over-implicit and composability gap: the chat layer
has richer context (references, the open diagram panel) than the single
implicit signal it uses, and it discards it.

## Reproduction

1. Run "Show Diagram" on `clinic-appointments.orm.yaml` -- the diagram
   webview becomes the active panel.
2. In Copilot Chat, attach/reference that file and ask `@barwise` a
   question about the model.
3. The model calls a tool (e.g. `query_model`) without a `source`; the
   tool falls back to `activeTextEditor`, which is `undefined` because
   the diagram webview is focused; the tool throws.

The reference chip and "Used N references" show the file _was_ available
to the participant -- it was never consulted.

## Should the chat handler resolve the model, or the tool? (resolved: both, layered)

The chat handler resolves intent; the tool resolves a safety net. The
handler is the only place with `request.references`, so it must turn the
referenced/visible model into an explicit `source` the model passes to
tools -- the precise, intent-driven path. The tool's own fallback stays
as a backstop for direct (non-chat) tool use and for when the model
omits `source` anyway, but it is broadened beyond the focused editor so
the diagram-open case resolves. Neither alone is sufficient: the handler
cannot force the model to pass `source`, and the tool cannot see chat
references.

## Source resolution order

A single resolver, used by both layers, tries in order:

1. an explicit `source` argument (unchanged -- always wins);
2. the active text editor, if it is an `.orm.yaml` (today's behavior);
3. the model shown in the open diagram panel
   (`DiagramPanel.currentPanel.filePath`);
4. a visible `.orm.yaml` editor (open in a tab but not focused).

The chat handler additionally reads `request.references` first of all,
ahead of (2)-(4), and injects the resolved path into the prompt so the
language model supplies it as `source`.

## Scope

In scope: read `request.references` in the chat handler and inject the
model path into the prompt; expose the active diagram model path from
`DiagramPanel`; broaden the tool source fallback to the diagram panel and
visible editors; a clearer error when nothing resolves; tests.

Out of scope: any `@barwise/core` change (this is purely VS Code
integration); changing the tool input schemas; multi-model / project
disambiguation when several `.orm.yaml` files are visible (pick the
diagram's model or the first visible, and say which in the error).

## Inventory

| Area                                         | Today                              | Change                                            |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| `chat/ChatParticipant.ts`                    | ignores `request.references`       | resolve model from references, inject into prompt |
| `mcp/ToolRegistration.ts` `getActiveOrmFile` | only `activeTextEditor`            | add diagram-panel + visible-editor fallbacks      |
| `diagram/DiagramPanel.ts`                    | `currentPanel.filePath` is private | add a static accessor for the active model path   |

## Workstreams (each independently shippable)

### 1. Broaden the tool source fallback

Add a `DiagramPanel.activeModelPath()` static returning
`currentPanel?.filePath`, and extend the tool resolver to try the active
editor, then that diagram path, then a visible `.orm.yaml` editor. This
alone fixes the reported case (diagram open, no `source`), is testable
without the chat runtime, and carries no dependency on the chat change.

### 2. Use chat references in the participant

In the handler, scan `request.references` for an `.orm.yaml` URI (the
reference `value` is a `Uri` or `Location`), fall back to the shared
resolver, and inject `The active model is at <path>; pass it as the
source argument to tools.` into the prompt. After this, an attached model
is used even if nothing is open in an editor.

## Risks and testing

- The resolver is pure given its inputs (active editor name, diagram
  path, visible editors), so it is unit-tested with those mocked; the
  reported diagram-open scenario becomes a regression test.
- Prompt injection of the path is additive and cannot break tool calls
  that already pass an explicit `source` (order 1 still wins).
- Reference `value` shapes (`Uri` vs `Location`) are handled explicitly;
  a non-file reference is skipped, not an error.

## Non-goals

- No core or tool-schema changes.
- No cross-file project disambiguation beyond "prefer the diagram's
  model, else the first visible `.orm.yaml`."
