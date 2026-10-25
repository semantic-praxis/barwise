/**
 * Export As dbt Project command.
 *
 * Takes the active .orm.yaml, renders it through the registered `dbt`
 * exporter (what `barwise export --format dbt` writes, under
 * models/staging and without seeds), and writes its files into a target
 * dbt project.
 */
import { OrmYamlSerializer } from "@barwise/core";
import * as path from "node:path";
import * as vscode from "vscode";
import { exportWith } from "../export/registeredExport.js";
import { reportExport } from "./exportReport.js";

const serializer = new OrmYamlSerializer();

// The palette writes into a project the user already has. models/staging
// keeps clear of a top-level models/schema.yml, the file such a project
// most likely has; no seeds, because `dbt seed` would load the model's
// example population into the user's warehouse.
const PALETTE_DBT_OPTIONS = { modelsDir: "models/staging", includeExamples: false };

export class ExportDbtCommand {
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

    // Step 2: Pick the target dbt project directory.
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select target dbt project root (contains dbt_project.yml)",
    });

    if (!folders || folders.length === 0) return;

    const dbtRoot = folders[0]!;

    // Verify dbt_project.yml exists.
    try {
      await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(dbtRoot, "dbt_project.yml"),
      );
    } catch {
      vscode.window.showErrorMessage(
        "No dbt_project.yml found in the selected directory. "
          + "Please select a valid dbt project root.",
      );
      return;
    }

    // Step 3: Render through the registered exporter.
    const exported = exportWith("dbt", model, PALETTE_DBT_OPTIONS);
    if (!exported.ok) {
      vscode.window.showErrorMessage(exported.reason);
      return;
    }
    const { result } = exported;
    const files = result.files ?? [];

    // Step 4: Write every file at the exporter's path.
    for (const file of files) {
      const uri = vscode.Uri.joinPath(dbtRoot, file.name);
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(dbtRoot, path.posix.dirname(file.name)),
      );
      await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, "utf-8"));
    }

    // Step 5: Open the schema.yml.
    const schemaFile = files.find((f) => path.posix.basename(f.name) === "schema.yml");
    if (schemaFile) {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(dbtRoot, schemaFile.name),
      );
      await vscode.window.showTextDocument(doc);
    }

    // Step 6: Report.
    const annotations = result.annotations ?? [];
    const todos = annotations.filter((a) => a.severity === "todo").length;
    const notes = annotations.filter((a) => a.severity === "note").length;
    let summary = `Exported ${files.length} file(s) to ${PALETTE_DBT_OPTIONS.modelsDir}/`;
    if (todos > 0 || notes > 0) {
      summary += ` (${todos} TODO(s), ${notes} NOTE(s) annotated)`;
    }
    reportExport(result, "dbt", summary);
  }
}
