import { OrmYamlSerializer } from "@barwise/core";
import { Verbalizer } from "@barwise/core/verbalization";
import * as vscode from "vscode";

/**
 * Generates a verbalization report for the active .orm.yaml file
 * and displays it in an output channel.
 */
export class VerbalizeCommand {
  private readonly serializer = new OrmYamlSerializer();
  private readonly verbalizer = new Verbalizer();

  async execute(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor.");
      return;
    }

    if (!editor.document.uri.fsPath.endsWith(".orm.yaml")) {
      vscode.window.showWarningMessage(
        "Active file is not an .orm.yaml file.",
      );
      return;
    }

    const text = editor.document.getText();
    const channel = vscode.window.createOutputChannel(
      "Barwise Verbalization",
    );
    channel.clear();
    channel.show();

    try {
      const model = this.serializer.deserialize(text);
      const verbalizations = this.verbalizer.verbalizeModel(model);

      if (verbalizations.length === 0) {
        channel.appendLine("No fact types to verbalize.");
        return;
      }

      channel.appendLine(`Verbalization of "${model.name}"`);
      channel.appendLine("=".repeat(40));
      channel.appendLine("");

      let lastCategory = "";
      for (const v of verbalizations) {
        if (v.category !== lastCategory) {
          if (lastCategory) channel.appendLine("");
          channel.appendLine(
            v.category === "fact_type"
              ? "Fact Type Readings:"
              : "Constraints:",
          );
          lastCategory = v.category;
        }
        channel.appendLine(`  ${v.text}`);
      }

      vscode.window.showInformationMessage(
        `Verbalized ${verbalizations.length} statement(s).`,
      );
    } catch (err) {
      channel.appendLine(`Parse error: ${(err as Error).message}`);
      vscode.window.showErrorMessage(
        `Barwise parse error: ${(err as Error).message}`,
      );
    }
  }
}
