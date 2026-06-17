/**
 * Export As dbt Project command.
 *
 * Takes the active .orm.yaml, maps it to a relational schema, renders
 * dbt artifacts (schema.yml + model SQL files), writes them into a
 * target dbt project directory, and runs the export annotator.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { annotateDbtExport, RelationalMapper, renderDbt } from "@barwise/core/mapping";
import * as path from "node:path";
import * as vscode from "vscode";

const serializer = new OrmYamlSerializer();
const mapper = new RelationalMapper();

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

    // Step 3: Map and render.
    const schema = mapper.map(model);
    const dbt = renderDbt(schema);
    const { schemaYaml, annotations } = annotateDbtExport(
      dbt.schemaYaml,
      model,
      schema,
    );

    // Step 4: Write schema.yml into models/ directory.
    const modelsDir = vscode.Uri.joinPath(dbtRoot, "models", "staging");
    await vscode.workspace.fs.createDirectory(modelsDir);

    const schemaUri = vscode.Uri.joinPath(modelsDir, "schema.yml");
    await vscode.workspace.fs.writeFile(
      schemaUri,
      Buffer.from(schemaYaml, "utf-8"),
    );

    // Step 5: Write model SQL files.
    for (const modelFile of dbt.models) {
      const sqlUri = vscode.Uri.joinPath(
        modelsDir,
        `${modelFile.name}.sql`,
      );
      await vscode.workspace.fs.writeFile(
        sqlUri,
        Buffer.from(modelFile.sql, "utf-8"),
      );
    }

    // Step 6: Open the schema.yml.
    const doc = await vscode.workspace.openTextDocument(schemaUri);
    await vscode.window.showTextDocument(doc);

    // Step 7: Report.
    const todos = annotations.filter((a) => a.severity === "todo").length;
    const notes = annotations.filter((a) => a.severity === "note").length;
    let msg = `Exported ${dbt.models.length} model(s) to ${
      path.relative(dbtRoot.fsPath, modelsDir.fsPath)
    }/`;
    if (todos > 0 || notes > 0) {
      msg += ` (${todos} TODO(s), ${notes} NOTE(s) annotated)`;
    }
    vscode.window.showInformationMessage(msg);
  }
}
