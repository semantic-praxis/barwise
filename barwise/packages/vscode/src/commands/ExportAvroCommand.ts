/**
 * Export As Avro Schemas command.
 *
 * Takes the active .orm.yaml, maps it to a relational schema,
 * renders Avro schema files (.avsc), and writes them to a chosen
 * output directory.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { avroSchemaToJson, RelationalMapper, renderAvro } from "@barwise/core/mapping";
import * as path from "node:path";
import * as vscode from "vscode";

const serializer = new OrmYamlSerializer();
const mapper = new RelationalMapper();

export class ExportAvroCommand {
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

    // Step 2: Map and render Avro schemas.
    const schema = mapper.map(model);
    const baseName = path.basename(
      editor.document.uri.fsPath,
      ".orm.yaml",
    );
    const avroSet = renderAvro(schema, { namespace: `com.${baseName}` });

    // Step 3: Pick output directory.
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select output directory for Avro schema files",
    });

    if (!folders || folders.length === 0) return;

    const outputDir = folders[0]!;

    // Step 4: Write each .avsc file.
    for (const avroSchema of avroSet.schemas) {
      const json = avroSchemaToJson(avroSchema);
      const fileName = `${avroSchema.name}.avsc`;
      const fileUri = vscode.Uri.joinPath(outputDir, fileName);
      await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(json, "utf-8"),
      );
    }

    // Step 5: Open the first schema file if any were written.
    if (avroSet.schemas.length > 0) {
      const firstUri = vscode.Uri.joinPath(
        outputDir,
        `${avroSet.schemas[0]!.name}.avsc`,
      );
      const doc = await vscode.workspace.openTextDocument(firstUri);
      await vscode.window.showTextDocument(doc);
    }

    vscode.window.showInformationMessage(
      `Exported ${avroSet.schemas.length} Avro schema(s) to ${path.basename(outputDir.fsPath)}/`,
    );
  }
}
