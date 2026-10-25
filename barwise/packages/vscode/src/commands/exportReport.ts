/**
 * What the palette's export commands tell the user once the files are
 * written: the summary, and the constraints the format could not express.
 *
 * One home for the DDL, Avro and dbt commands, so the report reaches the
 * user from every format that computes it, including the formats that
 * start computing it later (barwise-u8y), without each command
 * remembering to wire it.
 */
import type { ExportResult } from "@barwise/core";
import { formatConstraintReport } from "@barwise/formats";
import * as vscode from "vscode";

const FORMAT_LABELS: Record<string, string> = { ddl: "DDL", avro: "Avro", dbt: "dbt" };

// One channel per format for the session, created on first use: a channel
// per export would add an Output entry every run.
const channels = new Map<string, vscode.OutputChannel>();

/**
 * Show `summary` as an information message, or, when the result has
 * constraintSpecs, write the report to the format's channel and warn with
 * the summary and the report's heading.
 */
export function reportExport(result: ExportResult, format: string, summary: string): void {
  const report = formatConstraintReport(result.constraintSpecs, format);
  if (!report) {
    vscode.window.showInformationMessage(summary);
    return;
  }
  let channel = channels.get(format);
  if (!channel) {
    channel = vscode.window.createOutputChannel(
      `Barwise ${FORMAT_LABELS[format] ?? format} Export`,
    );
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
