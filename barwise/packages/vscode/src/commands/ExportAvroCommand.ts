/**
 * Export As Avro Schemas command.
 *
 * Takes the active .orm.yaml, renders it through the registered `avro`
 * exporter (what `barwise export --format avro` writes, with the
 * palette's namespace), and writes its .avsc files to a chosen folder.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { toAvroNamespace } from "@barwise/formats";
import * as path from "node:path";
import * as vscode from "vscode";
import { exportWith } from "../export/registeredExport.js";
import { reportExport, writeExportFiles } from "./exportReport.js";

const serializer = new OrmYamlSerializer();

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

    // Step 2: Render through the registered exporter. The namespace keeps
    // each record's full name what earlier palette exports registered: a
    // schema registry reads a changed full name as a different schema.
    // A file name Avro's rule rejects ("order-system") is made valid, and
    // the user is told: a lenient registry may have taken the old name, and
    // will read the new one as different schemas.
    const baseName = path.basename(
      editor.document.uri.fsPath,
      ".orm.yaml",
    );
    const derived = `com.${baseName}`;
    const namespace = toAvroNamespace(derived);
    if (namespace !== derived) {
      // Asked before anything is written: the export can overwrite earlier
      // .avsc files of the same names under the new namespace.
      const choice = await vscode.window.showWarningMessage(
        `The file name gives the Avro namespace "${derived}", which Avro's name rule rejects, `
          + `so the schemas would use "${namespace}". A schema registry that accepted "${derived}" `
          + "will treat these as new schemas.",
        { modal: true },
        "Export",
      );
      if (choice !== "Export") return;
    }
    const exported = exportWith("avro", model, { namespace });
    if (!exported.ok) {
      vscode.window.showErrorMessage(exported.reason);
      return;
    }
    const files = exported.result.files ?? [];

    // Step 3: Pick output directory.
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select output directory for Avro schema files",
    });

    if (!folders || folders.length === 0) return;

    const outputDir = folders[0]!;

    // Step 4: Write each file at the exporter's path.
    await writeExportFiles(outputDir, files);

    // Step 5: Open the first schema file if any were written.
    if (files.length > 0) {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(outputDir, files[0]!.name),
      );
      await vscode.window.showTextDocument(doc);
    }

    reportExport(
      exported.result,
      "avro",
      `Exported ${files.length} file(s) to ${path.basename(outputDir.fsPath)}/`,
    );
  }
}
