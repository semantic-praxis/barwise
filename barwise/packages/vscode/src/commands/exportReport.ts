/**
 * The shared tail of the palette's export commands: writing an export's
 * files, and telling the user what was written, how many review notes it
 * carries, and which constraints the format could not express.
 *
 * One home for the DDL, Avro and dbt commands, so what one format gains
 * (the annotation count, the constraint report, and formats that start
 * computing it later, barwise-u8y) reaches the user from every command
 * without each one remembering to wire it.
 */
import type { ExportResult } from "@barwise/core";
import { formatConstraintReport } from "@barwise/formats";
import * as path from "node:path";
import * as vscode from "vscode";
import { formatLabel } from "../export/registeredExport.js";

// One channel per format for the session, created on first use: a channel
// per export would add an Output entry every run.
const channels = new Map<string, vscode.OutputChannel>();

/** Write each file at its exporter path under `root`, creating its folder. */
export async function writeExportFiles(
  root: vscode.Uri,
  files: readonly { readonly name: string; readonly content: string; }[],
): Promise<void> {
  const folders = new Set(files.map((f) => path.posix.dirname(f.name)));
  for (const folder of folders) {
    if (folder !== ".") {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, folder));
    }
  }
  for (const file of files) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(root, file.name),
      Buffer.from(file.content, "utf-8"),
    );
  }
}

/** " (2 TODO(s), 1 NOTE(s) annotated)" for a result with review notes, else "". */
function annotationCounts(result: ExportResult): string {
  const annotations = result.annotations ?? [];
  const todos = annotations.filter((a) => a.severity === "todo").length;
  const notes = annotations.filter((a) => a.severity === "note").length;
  return todos > 0 || notes > 0 ? ` (${todos} TODO(s), ${notes} NOTE(s) annotated)` : "";
}

/**
 * Tell the user what was written: `written` plus the result's annotation
 * counts as an information message, or, when the result has
 * constraintSpecs, the report in the format's channel and a warning with
 * that summary and the report's heading.
 */
export function reportExport(result: ExportResult, format: string, written: string): void {
  const summary = written + annotationCounts(result);
  const report = formatConstraintReport(result.constraintSpecs, format);
  if (!report) {
    vscode.window.showInformationMessage(summary);
    return;
  }
  let channel = channels.get(format);
  if (!channel) {
    channel = vscode.window.createOutputChannel(`Barwise ${formatLabel(format)} Export`);
    channels.set(format, channel);
  }
  // This export's report only, so a stale one never reads as current.
  channel.clear();
  channel.appendLine(`=== ${summary} ===`);
  channel.appendLine(report);
  // The warning carries the report's own heading, so the two cannot state
  // different counts. Not awaited: the command (and barwise.export) settles
  // once the files are written, not when the notification is dismissed.
  const heading = report.split("\n", 1)[0]!.replace(/:$/, "");
  const shown = channel;
  void vscode.window
    .showWarningMessage(`${summary}. ${heading}.`, "Show report")
    .then((choice) => {
      if (choice === "Show report") shown.show(true);
    });
}
