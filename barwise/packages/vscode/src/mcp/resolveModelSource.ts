/**
 * Source-resolution policy for the barwise Language Model Tools, kept
 * free of any `vscode` import so it is unit-testable. When a tool is
 * called without an explicit source, the VS Code glue gathers the model
 * files the editor currently exposes and this picks which one to act on.
 */

export interface OpenModelContext {
  /** Path of the focused editor, if it is an `.orm.yaml` file. */
  readonly activeOrmFile?: string;
  /** Path of the model shown in the open diagram panel, if any. */
  readonly diagramModelPath?: string;
  /** Paths of visible `.orm.yaml` editors (open in a tab, not focused). */
  readonly visibleOrmFiles?: readonly string[];
}

/**
 * Resolve the open model path from editor/diagram context, in priority
 * order: the focused `.orm.yaml` editor, then the model shown in the open
 * diagram panel, then any visible `.orm.yaml` editor. The diagram fallback
 * is what lets a tool resolve a source when the diagram webview is the
 * focused surface (so `activeTextEditor` is undefined). Returns undefined
 * when nothing is open.
 */
export function resolveOpenModel(ctx: OpenModelContext): string | undefined {
  return ctx.activeOrmFile ?? ctx.diagramModelPath ?? ctx.visibleOrmFiles?.[0];
}
