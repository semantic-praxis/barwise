/**
 * Source-resolution policy for the barwise Language Model Tools, kept
 * free of any `vscode` import so it is unit-testable. When a tool is
 * called without an explicit source, the VS Code glue gathers the model
 * files the editor currently exposes and this picks which one to act on.
 */

import type { SourceInput } from "@barwise/mcp";

export interface OpenModelContext {
  /** Paths of `.orm.yaml` files attached to the chat as references. */
  readonly referencedOrmFiles?: readonly string[];
  /** Path of the focused editor, if it is an `.orm.yaml` file. */
  readonly activeOrmFile?: string;
  /** Path of the model shown in the open diagram panel, if any. */
  readonly diagramModelPath?: string;
  /** Paths of visible `.orm.yaml` editors (open in a tab, not focused). */
  readonly visibleOrmFiles?: readonly string[];
}

/**
 * Resolve the model path from chat/editor/diagram context, in priority
 * order: a `.orm.yaml` attached as a chat reference (the user's most
 * explicit intent), then the focused `.orm.yaml` editor, then the model
 * shown in the open diagram panel, then any visible `.orm.yaml` editor.
 * The diagram fallback is what lets a tool resolve a source when the
 * diagram webview is the focused surface (so `activeTextEditor` is
 * undefined). Returns undefined when nothing is available.
 */
export function resolveOpenModel(ctx: OpenModelContext): string | undefined {
  return ctx.referencedOrmFiles?.[0]
    ?? ctx.activeOrmFile
    ?? ctx.diagramModelPath
    ?? ctx.visibleOrmFiles?.[0];
}

/**
 * Turn a resolved model path into the `source` a tool should act on. When
 * the path is open as a text document, return `{ path, content }` so the
 * tool sees the live editor buffer (unsaved edits included) rather than the
 * stale copy on disk; otherwise return just `{ path }`. `liveContent` looks
 * up the open document's text for a path, or returns undefined when it is
 * not open as text (e.g. a diagram-only model or an unopened reference).
 */
export function openModelSource(
  path: string | undefined,
  liveContent: (path: string) => string | undefined,
): SourceInput | undefined {
  if (path === undefined) return undefined;
  const content = liveContent(path);
  return content !== undefined ? { path, content } : { path };
}
