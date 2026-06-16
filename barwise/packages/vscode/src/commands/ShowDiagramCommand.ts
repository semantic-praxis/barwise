import { OrmYamlSerializer } from "@barwise/core";
import * as vscode from "vscode";
import { DiagramPanel } from "../diagram/DiagramPanel.js";

const serializer = new OrmYamlSerializer();

export class ShowDiagramCommand {
  private readonly extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  execute(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith(".orm.yaml")) {
      vscode.window.showWarningMessage(
        "Open an .orm.yaml file to show its diagram.",
      );
      return;
    }

    try {
      const model = serializer.deserialize(editor.document.getText());
      // The DiagramSession seeds its own overrides from the saved layout
      // and computes the first layout, so the panel only needs the model
      // and the saved layout to restore.
      const savedLayout = model.getDiagramLayout("Default") ?? model.diagramLayouts[0];
      DiagramPanel.createOrShow(this.extensionUri, editor.document.fileName, model, savedLayout);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to generate diagram: ${(err as Error).message}`,
      );
    }
  }
}
