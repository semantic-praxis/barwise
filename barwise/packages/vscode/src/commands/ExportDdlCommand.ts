/**
 * Export As DDL command.
 *
 * Takes the active .orm.yaml, maps it to a relational schema,
 * renders CREATE TABLE DDL statements, and writes to a .sql file.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { RelationalMapper, renderDdl } from "@barwise/core/mapping";
import * as path from "node:path";
import * as vscode from "vscode";

const serializer = new OrmYamlSerializer();
const mapper = new RelationalMapper();

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

    // Step 2: Map and render DDL.
    const schema = mapper.map(model);
    const ddl = renderDdl(schema);

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
      Buffer.from(ddl, "utf-8"),
    );

    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc);

    const tableCount = schema.tables.length;
    vscode.window.showInformationMessage(
      `Exported ${tableCount} CREATE TABLE statement(s) to ${path.basename(outputUri.fsPath)}`,
    );
  }
}
