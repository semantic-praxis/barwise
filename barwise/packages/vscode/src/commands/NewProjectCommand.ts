import * as vscode from "vscode";
import { PROJECT_SCAFFOLD } from "./projectScaffold.js";

/**
 * Creates a new .orm.yaml file with a scaffold template.
 */
export class NewProjectCommand {
  async execute(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      filters: { "Barwise YAML": ["orm.yaml"] },
      saveLabel: "Create Barwise Model",
    });

    if (!uri) return;

    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, ignoreIfExists: true });
    edit.insert(uri, new vscode.Position(0, 0), PROJECT_SCAFFOLD);
    await vscode.workspace.applyEdit(edit);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  }
}
