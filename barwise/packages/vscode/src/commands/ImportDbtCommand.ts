/**
 * Import from dbt Project command.
 *
 * Prompts the user for a dbt project root directory, scans for
 * schema.yml and sources.yml files, runs importDbtProject to infer
 * an ORM model, annotates the original YAML files in place, and
 * opens the resulting .orm.yaml.
 */
import { OrmYamlSerializer } from "@barwise/core";
import {
  annotateDbtYaml,
  type DbtImportReport,
  importDbtProject,
  type ReportEntry,
} from "@barwise/dbt";
import * as path from "node:path";
import * as vscode from "vscode";

const serializer = new OrmYamlSerializer();

export class ImportDbtCommand {
  async execute(): Promise<void> {
    // Step 1: Pick the dbt project root directory.
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select dbt project root (contains dbt_project.yml)",
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

    // Step 2: Scan for schema YAML files.
    const yamlFiles = await this.findSchemaYamlFiles(dbtRoot);
    if (yamlFiles.length === 0) {
      vscode.window.showWarningMessage(
        "No schema.yml or sources.yml files found in the dbt project.",
      );
      return;
    }

    // Step 3: Read all YAML files.
    const yamlContents: string[] = [];
    const yamlUris: vscode.Uri[] = [];

    for (const uri of yamlFiles) {
      const bytes = await vscode.workspace.fs.readFile(uri);
      yamlContents.push(Buffer.from(bytes).toString("utf-8"));
      yamlUris.push(uri);
    }

    // Step 4: Run the import with progress.
    let result;
    let importLatencyMs: number;
    try {
      const start = Date.now();
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Importing from dbt project (${yamlFiles.length} YAML files)...`,
          cancellable: false,
        },
        async () => importDbtProject(yamlContents),
      );
      importLatencyMs = Date.now() - start;
    } catch (err) {
      vscode.window.showErrorMessage(
        `dbt import failed: ${(err as Error).message}`,
      );
      return;
    }

    // Step 5: Annotate the original YAML files in place.
    for (let i = 0; i < yamlContents.length; i++) {
      const annotated = annotateDbtYaml(yamlContents[i]!, result.report);
      if (annotated !== yamlContents[i]) {
        await vscode.workspace.fs.writeFile(
          yamlUris[i]!,
          Buffer.from(annotated, "utf-8"),
        );
      }
    }

    // Step 6: Ask for model name and output location.
    const dbtDirName = path.basename(dbtRoot.fsPath);
    const modelName = await vscode.window.showInputBox({
      prompt: "Name for the imported Barwise model",
      value: dbtDirName,
      validateInput: (v) => v.trim().length === 0 ? "Model name is required" : null,
    });

    if (!modelName) return;

    // Write .orm.yaml next to the dbt project root.
    const outputUri = vscode.Uri.file(
      path.join(path.dirname(dbtRoot.fsPath), `${modelName}.orm.yaml`),
    );

    const yaml = serializer.serialize(result.model);
    await vscode.workspace.fs.writeFile(outputUri, Buffer.from(yaml, "utf-8"));

    // Step 7: Open the generated file.
    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc);

    // Step 8: Report results.
    const summary = this.buildSummary(result.model, result.report);
    vscode.window.showInformationMessage(summary);

    // Show gap report in output channel.
    const config = vscode.workspace.getConfiguration("barwise");
    const verbose = config.get<boolean>("verboseLogging") ?? false;
    this.showReportInChannel(result.report, yamlUris, importLatencyMs, verbose);
  }

  /**
   * Scan the dbt project for schema YAML files (schema.yml, sources.yml,
   * and any _*.yml files in models/ directories).
   */
  private async findSchemaYamlFiles(
    dbtRoot: vscode.Uri,
  ): Promise<vscode.Uri[]> {
    const pattern = new vscode.RelativePattern(
      dbtRoot,
      "models/**/*.yml",
    );
    const files = await vscode.workspace.findFiles(pattern);

    // Also check for top-level sources.yml and schema.yml.
    const topLevel = ["sources.yml", "schema.yml"];
    for (const name of topLevel) {
      const uri = vscode.Uri.joinPath(dbtRoot, name);
      try {
        await vscode.workspace.fs.stat(uri);
        files.push(uri);
      } catch {
        // File doesn't exist, skip.
      }
    }

    return files;
  }

  private buildSummary(
    model: import("@barwise/core").OrmModel,
    report: DbtImportReport,
  ): string {
    const ots = model.objectTypes.length;
    const fts = model.factTypes.length;
    const gaps = report.entries.filter(
      (e: ReportEntry) => e.severity === "gap",
    ).length;
    const warnings = report.entries.filter(
      (e: ReportEntry) => e.severity === "warning",
    ).length;

    let msg = `Imported ${ots} object types and ${fts} fact types from dbt project.`;
    if (gaps > 0) msg += ` ${gaps} gap(s) to review.`;
    if (warnings > 0) msg += ` ${warnings} warning(s).`;
    return msg;
  }

  private showReportInChannel(
    report: DbtImportReport,
    yamlUris: vscode.Uri[],
    latencyMs: number,
    verbose: boolean,
  ): void {
    const gaps = report.entries.filter(
      (e: ReportEntry) => e.severity === "gap" || e.severity === "warning",
    );

    if (gaps.length === 0 && !verbose) return;

    const channel = vscode.window.createOutputChannel("Barwise dbt Import");
    channel.appendLine("=== dbt Import Report ===");
    if (verbose) {
      channel.appendLine(`Latency: ${latencyMs}ms`);
    }
    channel.appendLine("");
    channel.appendLine(`Scanned files:`);
    for (const uri of yamlUris) {
      channel.appendLine(`  - ${uri.fsPath}`);
    }
    channel.appendLine("");

    const gapEntries = report.entries.filter(
      (e: ReportEntry) => e.severity === "gap",
    );
    if (gapEntries.length > 0) {
      channel.appendLine("GAPS (require attention):");
      for (const e of gapEntries) {
        const col = e.columnName ? `.${e.columnName}` : "";
        channel.appendLine(`  - [${e.category}] ${e.modelName}${col}: ${e.message}`);
      }
      channel.appendLine("");
    }

    const warnEntries = report.entries.filter(
      (e: ReportEntry) => e.severity === "warning",
    );
    if (warnEntries.length > 0) {
      channel.appendLine("WARNINGS:");
      for (const e of warnEntries) {
        const col = e.columnName ? `.${e.columnName}` : "";
        channel.appendLine(`  - [${e.category}] ${e.modelName}${col}: ${e.message}`);
      }
      channel.appendLine("");
    }

    channel.show(true);
  }
}
