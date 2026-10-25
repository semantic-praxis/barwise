/**
 * Export As DDL command.
 *
 * Takes the active .orm.yaml, renders it through the registered `ddl`
 * exporter (the same call the diagram's DDL tab makes, via
 * `exportDdl`), writes the result to a .sql file, and reports any
 * constraint the DDL could not express.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { formatConstraintReport } from "@barwise/formats";
import * as path from "node:path";
import * as vscode from "vscode";
import { exportDdl } from "../export/ddlExport.js";

const serializer = new OrmYamlSerializer();

// One channel for the session, created on first use: a channel per export
// would leave a new entry in the Output dropdown every run.
let reportChannel: vscode.OutputChannel | undefined;

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
    const exported = exportDdl(model);
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

    // Step 5: Report what the DDL could not express, or confirm the write.
    const fileName = path.basename(outputUri.fsPath);
    const report = formatConstraintReport(result.constraintSpecs, "ddl");
    if (!report) {
      vscode.window.showInformationMessage(`Exported DDL to ${fileName}`);
      return;
    }
    const channel = reportChannel ??= vscode.window.createOutputChannel("Barwise DDL Export");
    // This export's report only, so a stale one never reads as current.
    channel.clear();
    channel.appendLine(`=== Export: ${fileName} ===`);
    channel.appendLine(report);
    // The warning carries the report's own heading, so the two cannot state
    // different counts. Not awaited: the command (and barwise.export) settles
    // once the file is written, not when the notification is dismissed.
    const heading = report.split("\n", 1)[0]!.replace(/:$/, "");
    void vscode.window
      .showWarningMessage(`Exported DDL to ${fileName}. ${heading}.`, "Show report")
      .then((choice) => {
        if (choice === "Show report") channel.show(true);
      });
  }
}
