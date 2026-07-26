/**
 * barwise.analyzeRepository -- the repo-analysis VS Code entry point.
 *
 * Thin UI over @barwise/mcp's executeAnalyzeRepository: prompt for an
 * org/repo or local path, confirm before cloning (a side effect the
 * spec requires to be explicit), show progress, print the profile to
 * the output channel, and open the extracted model as an untitled
 * .orm.yaml document for the user to review and save.
 */
import { executeAnalyzeRepository } from "@barwise/mcp";
import * as vscode from "vscode";

interface AnalyzeResult {
  requiresConfirmation?: boolean;
  message?: string;
  profile?: { summary?: string; } & Record<string, unknown>;
  model?: string;
  objectTypes?: number;
  factTypes?: number;
}

export class AnalyzeRepositoryCommand {
  private readonly channel = vscode.window.createOutputChannel("Barwise Analysis");

  async execute(): Promise<void> {
    const repo = await vscode.window.showInputBox({
      prompt: "GitHub repository (org/name) or local path to analyze",
      placeHolder: "MyOrg/Foo or /path/to/checkout",
    });
    if (!repo) return;

    const ref = await vscode.window.showInputBox({
      prompt: "Branch, tag, or commit (leave empty for the default branch)",
    });

    try {
      let result = await this.run(repo, ref || undefined, false);
      if (result.requiresConfirmation) {
        const answer = await vscode.window.showInformationMessage(
          result.message ?? `Clone ${repo} to the local repo store?`,
          { modal: true },
          "Clone",
        );
        if (answer !== "Clone") return;
        result = await this.run(repo, ref || undefined, true);
      }

      if (result.profile?.summary) {
        this.channel.appendLine(`--- ${repo} ---`);
        this.channel.appendLine(String(result.profile.summary));
        this.channel.show(true);
      }
      if (result.model) {
        const doc = await vscode.workspace.openTextDocument({
          language: "yaml",
          content: result.model,
        });
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(
          `Extracted ${result.objectTypes ?? 0} object types and `
            + `${result.factTypes ?? 0} fact types from ${repo}.`,
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Repository analysis failed: ${(err as Error).message}`,
      );
    }
  }

  private async run(
    repo: string,
    ref: string | undefined,
    confirm: boolean,
  ): Promise<AnalyzeResult> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Analyzing ${repo}...`,
      },
      async () => {
        const response = await executeAnalyzeRepository(repo, { ref, confirm });
        return JSON.parse(response.content[0]?.text ?? "{}") as AnalyzeResult;
      },
    );
  }
}
