/**
 * Export As DDL command.
 *
 * Takes the active .orm.yaml, renders it through the registered `ddl`
 * exporter (the same call the diagram's DDL tab makes, via
 * `exportWith`), writes the result to a .sql file, and reports any
 * constraint the DDL could not express.
 */
import { OrmYamlSerializer } from "@barwise/core";
import * as path from "node:path";
import * as vscode from "vscode";
import { exportWith } from "../export/registeredExport.js";
import { reportExport } from "./exportReport.js";

const serializer = new OrmYamlSerializer();

export class ExportDdlCommand {
  async execute(): Promise<void> {
    // Step 1: Get the active .orm.yaml file.
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.uri.fsPath.endsWith(".orm.yaml")) {
      vscode.window.showWarningMessage(
        "Open an .orm.yaml file before exporting.",
      );
      return;
    }

    const modelText = editor.document.getText();
    let model;
    try {
      model = serializer.deserialize(modelText);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to parse Barwise model: ${(err as Error).message}`,
      );
      return;
    }

    // Step 2: Render through the registered exporter.
    const exported = exportWith("ddl", model);
    if (!exported.ok) {
      vscode.window.showErrorMessage(exported.reason);
      return;
    }
    const { result } = exported;

    // Step 3: Pick output location.
    const baseName = path.basename(
      editor.document.uri.fsPath,
      ".orm.yaml",
    );
    const outputUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(
          path.dirname(editor.document.uri.fsPath),
          `${baseName}.sql`,
        ),
      ),
      filters: { SQL: ["sql"], "All Files": ["*"] },
      title: "Save DDL output",
    });

    if (!outputUri) return;

    // Step 4: Write and open.
    await vscode.workspace.fs.writeFile(
      outputUri,
      Buffer.from(result.text, "utf-8"),
    );

    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc);

    // Step 5: Confirm the write, or report what the DDL could not express.
    reportExport(result, "ddl", `Exported DDL to ${path.basename(outputUri.fsPath)}`);
  }
}
