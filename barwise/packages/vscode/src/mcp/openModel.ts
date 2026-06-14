/**
 * VS Code glue that gathers the open-model context and applies the pure
 * resolution policy. Shared by the Language Model Tools (no chat
 * references) and the `@barwise` chat participant (which passes the
 * `.orm.yaml` files attached as references).
 */

import * as vscode from "vscode";
import { DiagramPanel } from "../diagram/DiagramPanel.js";
import { resolveOpenModel } from "./resolveModelSource.js";

/**
 * Extract the paths of any `.orm.yaml` files attached to the chat as
 * references -- the user's most explicit statement of which model they
 * mean. The reference `value` is a `Uri` or a `Location`; anything else
 * is skipped.
 */
export function referencedOrmFiles(request: vscode.ChatRequest): string[] {
  const paths: string[] = [];
  for (const ref of request.references) {
    const value = ref.value;
    let uri: vscode.Uri | undefined;
    if (value instanceof vscode.Uri) {
      uri = value;
    } else if (
      value !== null && typeof value === "object" && "uri" in value
      && (value as vscode.Location).uri instanceof vscode.Uri
    ) {
      uri = (value as vscode.Location).uri;
    }
    if (uri?.fsPath.endsWith(".orm.yaml")) paths.push(uri.fsPath);
  }
  return paths;
}

/**
 * Resolve the model a barwise tool should act on when no explicit source
 * is given. Considers, in priority order: chat-referenced `.orm.yaml`
 * files, the focused editor, the open diagram's model, and any visible
 * `.orm.yaml` editor. The diagram fallback matters because tools are
 * often invoked while the diagram webview -- not a text editor -- is
 * focused, leaving `activeTextEditor` undefined.
 */
export function getOpenModelPath(
  referencedOrmFiles?: readonly string[],
): string | undefined {
  const active = vscode.window.activeTextEditor;
  const activeOrmFile = active?.document.fileName.endsWith(".orm.yaml")
    ? active.document.uri.fsPath
    : undefined;
  const visibleOrmFiles = vscode.window.visibleTextEditors
    .map((e) => e.document)
    .filter((d) => d.fileName.endsWith(".orm.yaml"))
    .map((d) => d.uri.fsPath);
  return resolveOpenModel({
    referencedOrmFiles,
    activeOrmFile,
    diagramModelPath: DiagramPanel.activeModelPath(),
    visibleOrmFiles,
  });
}
