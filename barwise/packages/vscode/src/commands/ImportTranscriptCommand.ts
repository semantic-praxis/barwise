import { type OrmModel, OrmYamlSerializer, ProjectSerializer } from "@barwise/core";
import { annotateOrmYaml } from "@barwise/core/annotation";
import {
  type BreakingLevel,
  diffModels,
  mergeAndValidate,
  type ModelDelta,
  type SynonymCandidate,
} from "@barwise/core/diff";
import { AnthropicLlmClient, processTranscript } from "@barwise/llm";
import type { DraftModelResult, LlmClient } from "@barwise/llm";
import * as path from "node:path";
import * as vscode from "vscode";
import { CopilotLlmClient } from "../llm/CopilotLlmClient.js";

const serializer = new OrmYamlSerializer();

export class ImportTranscriptCommand {
  async execute(): Promise<void> {
    // Step 1: Pick the transcript file.
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        "Transcripts": ["md", "txt"],
        "All Files": ["*"],
      },
      title: "Select a transcript file",
    });

    if (!files || files.length === 0) return;

    const transcriptUri = files[0]!;
    const transcriptBytes = await vscode.workspace.fs.readFile(transcriptUri);
    const transcript = Buffer.from(transcriptBytes).toString("utf-8");

    if (!transcript.trim()) {
      vscode.window.showWarningMessage("The selected transcript file is empty.");
      return;
    }

    // Step 2: Pick the LLM model.
    const config = vscode.workspace.getConfiguration("barwise");
    const provider = config.get<string>("llmProvider") ?? "copilot";
    const defaultLlmModel = await getDefaultLlmModel();
    const selection = await buildLlmClientWithPicker(provider, config, defaultLlmModel);
    if (!selection) return; // User cancelled model selection.
    const { client, modelLabel } = selection;

    // Step 3: Ask for a model name.
    const baseName = path.basename(
      transcriptUri.fsPath,
      path.extname(transcriptUri.fsPath),
    );
    const modelName = await vscode.window.showInputBox({
      prompt: "Name for the extracted model",
      value: baseName,
      validateInput: (v) => v.trim().length === 0 ? "Model name is required" : null,
    });

    if (!modelName) return;

    // Step 4: Run the extraction with progress.
    const transcriptFileName = path.basename(transcriptUri.fsPath);
    let result: DraftModelResult;
    try {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Extracting Barwise model from ${transcriptFileName} [${modelLabel}]...`,
          cancellable: false,
        },
        async () => {
          return processTranscript(transcript, client, { modelName });
        },
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        `Transcript extraction failed: ${(err as Error).message}`,
      );
      return;
    }

    // Step 5: Determine output path and check for existing model.
    const outputDir = path.dirname(transcriptUri.fsPath);
    const outputName = `${baseName}.orm.yaml`;
    const outputUri = vscode.Uri.file(path.join(outputDir, outputName));

    const finalModel = await this.resolveWithExisting(
      outputUri,
      result.model,
    );
    if (!finalModel) return; // User cancelled during review.

    // Step 6: Serialize and annotate.
    const rawYaml = serializer.serialize(finalModel);
    const annotated = annotateOrmYaml(rawYaml, result);
    await vscode.workspace.fs.writeFile(
      outputUri,
      Buffer.from(annotated.yaml, "utf-8"),
    );

    // Step 7: Open the generated file.
    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc);

    // Step 8: Report results.
    const summary = buildSummary(result, annotated.todoCount, annotated.noteCount);
    vscode.window.showInformationMessage(summary);

    // Step 9: Log to output channel.
    const verbose = config.get<boolean>("verboseLogging") ?? false;
    const hasWarnings = result.warnings.length > 0 || result.ambiguities.length > 0;
    const shouldLog = verbose || hasWarnings || result.modelUsed;

    if (shouldLog) {
      const channel = vscode.window.createOutputChannel("Barwise Transcript Import");
      channel.appendLine(`=== Import: ${modelName} ===`);
      channel.appendLine(`Transcript: ${transcriptFileName}`);
      if (result.modelUsed) {
        channel.appendLine(`Model used: ${result.modelUsed}`);
      }
      if (result.latencyMs !== undefined) {
        channel.appendLine(`Latency: ${result.latencyMs}ms`);
      }
      if (result.usage) {
        const parts: string[] = [];
        if (result.usage.promptTokens !== undefined) {
          parts.push(`prompt=${result.usage.promptTokens}`);
        }
        if (result.usage.completionTokens !== undefined) {
          parts.push(`completion=${result.usage.completionTokens}`);
        }
        if (parts.length > 0) {
          channel.appendLine(`Token usage: ${parts.join(", ")}`);
        }
      }
      channel.appendLine(`Prompt length: ${transcript.length} chars`);
      channel.appendLine("");

      if (verbose && result.rawResponse) {
        channel.appendLine("RAW LLM RESPONSE:");
        channel.appendLine(result.rawResponse);
        channel.appendLine("");
      }

      if (result.ambiguities.length > 0) {
        channel.appendLine("AMBIGUITIES:");
        for (const a of result.ambiguities) {
          channel.appendLine(`  - ${a.description}`);
          for (const ref of a.source_references) {
            channel.appendLine(`    [lines ${ref.lines[0]}-${ref.lines[1]}] "${ref.excerpt}"`);
          }
        }
        channel.appendLine("");
      }

      if (result.warnings.length > 0) {
        channel.appendLine("WARNINGS:");
        for (const w of result.warnings) {
          channel.appendLine(`  - ${w}`);
        }
        channel.appendLine("");
      }

      const skipped = result.constraintProvenance.filter((c) => !c.applied);
      if (skipped.length > 0) {
        channel.appendLine("SKIPPED CONSTRAINTS:");
        for (const c of skipped) {
          channel.appendLine(`  - ${c.description}`);
          channel.appendLine(`    Reason: ${c.skipReason}`);
        }
      }

      channel.show(true);
    }
  }

  /**
   * If an .orm.yaml already exists at outputUri, diff the existing model
   * against the incoming one and present a fact-by-fact review. Returns
   * the final merged model, or the incoming model directly if no existing
   * file was found. Returns undefined if the user cancels.
   */
  private async resolveWithExisting(
    outputUri: vscode.Uri,
    incomingModel: OrmModel,
  ): Promise<OrmModel | undefined> {
    let existingModel: OrmModel;
    try {
      const bytes = await vscode.workspace.fs.readFile(outputUri);
      const yaml = Buffer.from(bytes).toString("utf-8");
      existingModel = serializer.deserialize(yaml);
    } catch {
      // File doesn't exist or isn't valid -- treat as fresh import.
      return incomingModel;
    }

    const diff = diffModels(existingModel, incomingModel);
    if (!diff.hasChanges) {
      vscode.window.showInformationMessage(
        "No changes detected -- existing model is up to date.",
      );
      return existingModel;
    }

    // Filter to only the deltas that represent actual changes.
    const actionableDeltas = diff.deltas
      .map((d, i) => ({ delta: d, index: i }))
      .filter(({ delta }) => delta.kind !== "unchanged");

    // Review loop: allows the user to re-review if validation fails.
    while (true) {
      const accepted = await this.reviewDeltas(
        actionableDeltas,
        diff.synonymCandidates,
      );
      if (accepted === undefined) return undefined; // Cancelled.

      if (accepted.size === 0) {
        vscode.window.showInformationMessage(
          "All changes rejected -- keeping existing model.",
        );
        return existingModel;
      }

      const result = mergeAndValidate(
        existingModel,
        incomingModel,
        diff.deltas,
        accepted,
      );

      if (result.model === null) {
        // Merge threw -- unrecoverable without different selections.
        vscode.window.showErrorMessage(
          `Merge failed: ${result.diagnostics.map((e) => e.message).join("; ")}`,
        );
        return undefined;
      }

      if (!result.isValid) {
        const errorSummary = result.diagnostics
          .map((e) => e.message)
          .join("\n");
        const choice = await vscode.window.showWarningMessage(
          `Merged model has structural issues:\n${errorSummary}`,
          "Write Anyway",
          "Review Again",
        );
        if (choice === "Write Anyway") {
          return result.model;
        }
        if (choice === "Review Again") {
          continue; // Loop back to reviewDeltas.
        }
        // Dismissed or Escape -- cancel.
        return undefined;
      }

      return result.model;
    }
  }

  /**
   * Show a multi-select QuickPick where each item is one element-level
   * change. Items are grouped by breaking level (breaking first, then
   * caution, then safe) with separators. Synonym candidates are annotated
   * on the relevant items. Items are pre-selected for additions and
   * modifications. Returns the set of accepted delta indices, or
   * undefined if cancelled.
   */
  private async reviewDeltas(
    items: { delta: ModelDelta; index: number; }[],
    synonymCandidates: readonly SynonymCandidate[],
  ): Promise<Set<number> | undefined> {
    interface DeltaQuickPickItem extends vscode.QuickPickItem {
      deltaIndex: number;
    }

    // Build a lookup from delta index to synonym annotations.
    const synonymNotes = buildSynonymNotes(synonymCandidates, items);

    // Group items by breaking level.
    const groups: Record<BreakingLevel, { delta: ModelDelta; index: number; }[]> = {
      breaking: [],
      caution: [],
      safe: [],
    };
    for (const item of items) {
      groups[item.delta.breakingLevel].push(item);
    }

    const separatorLabels: Record<BreakingLevel, string> = {
      breaking: "Breaking changes",
      caution: "Caution",
      safe: "Safe changes",
    };

    // Build the QuickPick items with separators between groups.
    const quickPickItems: (DeltaQuickPickItem | vscode.QuickPickItem)[] = [];
    const levelOrder: BreakingLevel[] = ["breaking", "caution", "safe"];

    for (const level of levelOrder) {
      const group = groups[level];
      if (group.length === 0) continue;

      // Add separator.
      quickPickItems.push({
        label: separatorLabels[level],
        kind: vscode.QuickPickItemKind.Separator,
      });

      for (const { delta, index } of group) {
        const icon = breakingIcon(delta.breakingLevel);
        const label = deltaLabel(delta);
        const synonymNote = synonymNotes.get(index);
        const changeSummary = delta.changeDescriptions.length > 0
          ? delta.changeDescriptions.join("; ")
          : undefined;
        const detail = synonymNote
          ? [changeSummary, synonymNote].filter(Boolean).join(" | ")
          : changeSummary;

        quickPickItems.push({
          label: `${icon} ${label}`,
          description: `${delta.kind} - ${delta.breakingLevel}`,
          detail,
          deltaIndex: index,
          // Pre-select additions and modifications; leave removals unchecked
          // so the user has to actively confirm deletions.
          picked: delta.kind === "added" || delta.kind === "modified",
        } as DeltaQuickPickItem);
      }
    }

    const picked = await vscode.window.showQuickPick(
      quickPickItems as DeltaQuickPickItem[],
      {
        canPickMany: true,
        title: "Review extracted changes (uncheck to reject)",
        placeHolder: "Grouped by risk level. Confirm your selections.",
      },
    );

    if (!picked) return undefined; // User pressed Escape.

    return new Set(
      picked
        .filter((item): item is DeltaQuickPickItem => "deltaIndex" in item)
        .map((item) => item.deltaIndex),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function breakingIcon(level: BreakingLevel): string {
  switch (level) {
    case "breaking":
      return "$(warning)";
    case "caution":
      return "$(info)";
    case "safe":
      return "$(check)";
  }
}

/**
 * Build a map from delta index to synonym annotation text. Each delta
 * that participates in a synonym candidate gets a note like
 * "Possible rename: see added Client" or "Possible rename: see removed Customer".
 */
function buildSynonymNotes(
  candidates: readonly SynonymCandidate[],
  items: { delta: ModelDelta; index: number; }[],
): Map<number, string> {
  const notes = new Map<string, string>();
  const indexSet = new Set(items.map((item) => item.index));

  for (const candidate of candidates) {
    if (indexSet.has(candidate.removedIndex)) {
      const existing = notes.get(String(candidate.removedIndex));
      const note = `Possible rename: see added "${candidate.addedName}"`;
      notes.set(
        String(candidate.removedIndex),
        existing ? `${existing}; ${note}` : note,
      );
    }
    if (indexSet.has(candidate.addedIndex)) {
      const existing = notes.get(String(candidate.addedIndex));
      const note = `Possible rename: see removed "${candidate.removedName}"`;
      notes.set(
        String(candidate.addedIndex),
        existing ? `${existing}; ${note}` : note,
      );
    }
  }

  // Convert to numeric keys.
  const result = new Map<number, string>();
  for (const [key, value] of notes) {
    result.set(Number(key), value);
  }
  return result;
}

function deltaLabel(delta: ModelDelta): string {
  if (delta.elementType === "definition") {
    return `Definition: ${delta.term}`;
  }
  const typeLabel = delta.elementType === "object_type"
    ? "Object type"
    : "Fact type";
  return `${typeLabel}: ${delta.name}`;
}

interface LlmClientSelection {
  readonly client: LlmClient;
  /** Human-readable model label for progress messages. */
  readonly modelLabel: string;
}

/**
 * Build an LLM client, showing a model picker QuickPick for Copilot.
 * Returns undefined if the user cancels the picker.
 */
async function buildLlmClientWithPicker(
  provider: string,
  config: vscode.WorkspaceConfiguration,
  defaultLlmModel: string | undefined,
): Promise<LlmClientSelection | undefined> {
  if (provider === "anthropic") {
    const apiKey = config.get<string>("anthropicApiKey") || undefined;
    const configModel = config.get<string>("anthropicModel") || undefined;
    const model = configModel ?? defaultLlmModel;
    return {
      client: new AnthropicLlmClient({ apiKey, model }),
      modelLabel: model ?? "claude",
    };
  }

  // Copilot: list available models and let the user pick.
  const allModels = await vscode.lm.selectChatModels({});
  if (allModels.length === 0) {
    vscode.window.showErrorMessage(
      "No Copilot language models available. "
        + "Ensure GitHub Copilot is installed and signed in.",
    );
    return undefined;
  }

  // If only one model, skip the picker.
  if (allModels.length === 1) {
    const m = allModels[0]!;
    return {
      client: new CopilotLlmClient({ family: m.family }),
      modelLabel: m.name || m.family || m.id,
    };
  }

  // Build QuickPick items, pre-selecting the project default.
  interface ModelQuickPickItem extends vscode.QuickPickItem {
    family: string;
  }

  const items: ModelQuickPickItem[] = allModels.map((m) => ({
    label: m.name || m.family || m.id,
    description: m.family,
    detail: m.id,
    family: m.family,
    picked: defaultLlmModel
      ? (m.family === defaultLlmModel || m.id === defaultLlmModel || m.name === defaultLlmModel)
      : false,
  }));

  // Move the default to the top if found.
  if (defaultLlmModel) {
    const defaultIdx = items.findIndex((i) => i.picked);
    if (defaultIdx > 0) {
      const [item] = items.splice(defaultIdx, 1);
      items.unshift(item!);
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: "Select LLM model for extraction",
    placeHolder: defaultLlmModel
      ? `Project default: ${defaultLlmModel}`
      : "Choose a model",
  });

  if (!picked) return undefined; // User pressed Escape.

  return {
    client: new CopilotLlmClient({ family: picked.family }),
    modelLabel: picked.label,
  };
}

/**
 * Read the defaultLlmModel from the project's .orm-project.yaml if present.
 */
async function getDefaultLlmModel(): Promise<string | undefined> {
  const projectFiles = await vscode.workspace.findFiles(
    "**/.orm-project.yaml",
    "**/node_modules/**",
    1,
  );
  if (projectFiles.length === 0) return undefined;

  try {
    const bytes = await vscode.workspace.fs.readFile(projectFiles[0]!);
    const yaml = Buffer.from(bytes).toString("utf-8");
    const ps = new ProjectSerializer();
    const project = ps.deserialize(yaml);
    return project.settings.defaultLlmModel;
  } catch {
    return undefined;
  }
}

function buildSummary(
  result: DraftModelResult,
  todoCount: number = 0,
  noteCount: number = 0,
): string {
  const ots = result.model.objectTypes.length;
  const fts = result.model.factTypes.length;
  const applied = result.constraintProvenance.filter((c) => c.applied).length;

  const modelNote = result.modelUsed ? ` [${result.modelUsed}]` : "";
  let msg = `Extracted ${ots} object types, ${fts} fact types, ${applied} constraints${modelNote}.`;
  if (todoCount > 0 || noteCount > 0) {
    msg += ` ${todoCount} TODO(s), ${noteCount} NOTE(s) annotated.`;
  }
  return msg;
}
