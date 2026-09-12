/**
 * Barwise: Import... -- quick pick router for import workflows.
 *
 * Presents a picker with import source options:
 *   - From Transcript  (LLM extraction)
 *   - From dbt Project (dbt schema import)
 *   - From TypeScript Project (code analysis)
 *   - From Java Project (code analysis)
 *   - From Kotlin Project (code analysis)
 */
import * as vscode from "vscode";
import { ImportCodeCommand } from "./ImportCodeCommand.js";
import { ImportDbtCommand } from "./ImportDbtCommand.js";
import { ImportTranscriptCommand } from "./ImportTranscriptCommand.js";

type ImportOptionId = "transcript" | "dbt" | "typescript" | "java" | "kotlin";

interface ImportOption extends vscode.QuickPickItem {
  readonly id: ImportOptionId;
}

const IMPORT_OPTIONS: ImportOption[] = [
  {
    id: "transcript",
    label: "From Transcript",
    description: "Extract a Barwise model from a conversation transcript using an LLM",
  },
  {
    id: "dbt",
    label: "From dbt Project",
    description: "Import entity and fact types from a dbt project's schema YAML",
  },
  {
    id: "typescript",
    label: "From TypeScript Project",
    description: "Analyze TypeScript types, validations, and state machines",
  },
  {
    id: "java",
    label: "From Java Project",
    description: "Analyze Java annotations, entity types, and validations",
  },
  {
    id: "kotlin",
    label: "From Kotlin Project",
    description: "Analyze Kotlin data classes, sealed hierarchies, and annotations",
  },
];

export class ImportCommand {
  /** Threaded to the transcript import, which is the only branch that
   *  needs a credential. See ImportTranscriptCommand's constructor. */
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async execute(): Promise<void> {
    const picked = await vscode.window.showQuickPick(IMPORT_OPTIONS, {
      title: "Import Barwise Model",
      placeHolder: "Choose an import source",
    });

    if (!picked) return;

    switch (picked.id) {
      case "transcript":
        return new ImportTranscriptCommand(this.secrets).execute();
      case "dbt":
        return new ImportDbtCommand().execute();
      case "typescript":
      case "java":
      case "kotlin":
        return new ImportCodeCommand(picked.id).execute();
    }
  }
}
