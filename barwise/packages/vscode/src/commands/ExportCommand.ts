/**
 * Barwise: Export... -- quick pick router for export workflows.
 *
 * Presents a picker with export format options:
 *   - As dbt Project
 *   - As DDL
 *   - As Avro Schemas
 */
import * as vscode from "vscode";
import { ExportAvroCommand } from "./ExportAvroCommand.js";
import { ExportDbtCommand } from "./ExportDbtCommand.js";
import { ExportDdlCommand } from "./ExportDdlCommand.js";

interface ExportOption extends vscode.QuickPickItem {
  readonly id: "dbt" | "ddl" | "avro";
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    id: "dbt",
    label: "As dbt Project",
    description: "Generate schema.yml and model SQL files into an existing dbt project",
  },
  {
    id: "ddl",
    label: "As DDL",
    description: "Generate SQL DDL: tables, constraint clauses, and example INSERTs",
  },
  {
    id: "avro",
    label: "As Avro Schemas",
    description: "Generate .avsc schema files for each table",
  },
];

export class ExportCommand {
  async execute(): Promise<void> {
    const picked = await vscode.window.showQuickPick(EXPORT_OPTIONS, {
      title: "Export Barwise Model",
      placeHolder: "Choose an export format",
    });

    if (!picked) return;

    switch (picked.id) {
      case "dbt":
        return new ExportDbtCommand().execute();
      case "ddl":
        return new ExportDdlCommand().execute();
      case "avro":
        return new ExportAvroCommand().execute();
    }
  }
}
