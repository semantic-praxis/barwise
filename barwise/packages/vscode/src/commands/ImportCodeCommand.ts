/**
 * Import from Code Project command.
 *
 * Prompts the user for a project root directory, analyzes TypeScript,
 * Java, or Kotlin source files, and produces a draft ORM model.
 * Optionally uses an existing ORM model as a guiding model to focus
 * analysis on known entities.
 */
import { registerCodeFormats } from "@barwise/code-analysis";
import { getImporter, OrmYamlSerializer } from "@barwise/core";
import type { ImportResult } from "@barwise/core";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import * as path from "node:path";
import * as vscode from "vscode";

const serializer = new OrmYamlSerializer();

// Ensure formats are registered.
registerStandardFormats();
registerCodeFormats();
registerDbtFormats();

/** Supported code languages for import. */
export type CodeLanguage = "typescript" | "java" | "kotlin";

const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  typescript: "TypeScript",
  java: "Java",
  kotlin: "Kotlin",
};

export class ImportCodeCommand {
  constructor(private readonly language: CodeLanguage) {}

  async execute(): Promise<void> {
    const displayName = LANGUAGE_LABELS[this.language];

    // Step 1: Pick project root directory.
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: `Select ${displayName} project root`,
    });

    if (!folders || folders.length === 0) return;
    const projectRoot = folders[0]!;

    // Step 2: Optionally pick a guiding ORM model.
    const guidingModelPath = await this.pickGuidingModel();

    // Step 3: Run the import with progress.
    const importer = getImporter(this.language);
    if (!importer || !importer.parseAsync) {
      vscode.window.showErrorMessage(
        `No ${displayName} importer available. Ensure @barwise/code-analysis is loaded.`,
      );
      return;
    }

    let result: ImportResult;
    let latencyMs: number;
    try {
      const start = Date.now();
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Analyzing ${displayName} project...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "Discovering source files..." });
          const options: Record<string, unknown> = {};
          if (guidingModelPath) {
            options["guidingModel"] = guidingModelPath;
          }
          return importer.parseAsync!(projectRoot.fsPath, options);
        },
      );
      latencyMs = Date.now() - start;
    } catch (err) {
      vscode.window.showErrorMessage(
        `${displayName} import failed: ${(err as Error).message}`,
      );
      return;
    }

    // Step 4: Ask for model name.
    const dirName = path.basename(projectRoot.fsPath);
    const modelName = await vscode.window.showInputBox({
      prompt: "Name for the imported Barwise model",
      value: dirName,
      validateInput: (v) => v.trim().length === 0 ? "Model name is required" : null,
    });

    if (!modelName) return;

    // Step 5: Serialize and write the model.
    const outputUri = vscode.Uri.file(
      path.join(path.dirname(projectRoot.fsPath), `${modelName}.orm.yaml`),
    );

    const yaml = serializer.serialize(result.model);
    await vscode.workspace.fs.writeFile(outputUri, Buffer.from(yaml, "utf-8"));

    // Step 6: Open the generated file.
    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc);

    // Step 7: Report results.
    const ots = result.model.objectTypes.length;
    const fts = result.model.factTypes.length;
    let msg = `Imported ${ots} object types and ${fts} fact types from ${displayName} project.`;
    msg += ` Confidence: ${result.confidence}.`;
    if (result.warnings.length > 0) {
      msg += ` ${result.warnings.length} warning(s).`;
    }
    vscode.window.showInformationMessage(msg);

    // Show warnings in output channel if any.
    if (result.warnings.length > 0) {
      const channel = vscode.window.createOutputChannel(`Barwise ${displayName} Import`);
      channel.appendLine(`=== ${displayName} Import Report ===`);
      channel.appendLine(`Latency: ${latencyMs}ms`);
      channel.appendLine(`Confidence: ${result.confidence}`);
      channel.appendLine("");
      channel.appendLine("Warnings:");
      for (const warning of result.warnings) {
        channel.appendLine(`  - ${warning}`);
      }
      channel.show(true);
    }
  }

  /**
   * Optionally pick an existing ORM model as a guiding model.
   * Returns the file path or undefined if skipped.
   */
  private async pickGuidingModel(): Promise<string | undefined> {
    const useGuiding = await vscode.window.showQuickPick(
      [
        { label: "No", description: "Analyze all discovered types" },
        { label: "Yes", description: "Focus analysis on entities from an existing model" },
      ],
      {
        title: "Use a guiding Barwise model?",
        placeHolder: "A guiding model focuses analysis on known entities",
      },
    );

    if (!useGuiding || useGuiding.label === "No") return undefined;

    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select guiding Barwise model (.orm.yaml)",
      filters: { "Barwise Models": ["orm.yaml"] },
    });

    if (!files || files.length === 0) return undefined;
    return files[0]!.fsPath;
  }
}
