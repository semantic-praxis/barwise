/**
 * Registers barwise ORM tools with VS Code's Language Model Tool API
 * (vscode.lm.registerTool). These tools run in the extension host
 * process and have full access to the VS Code API, including Copilot
 * language models -- unlike the MCP stdio server which runs as a
 * separate child process.
 *
 * Each tool wraps the corresponding execute function from @barwise/mcp,
 * except import_transcript and review_model which use CopilotLlmClient
 * directly. The tools are table-driven: a `register` call per tool pairs
 * its name with a `run` closure and an invocation message, built into a
 * single generic `LanguageModelTool` adapter.
 */

import { OrmYamlSerializer } from "@barwise/core";
import { annotateOrmYaml } from "@barwise/core/annotation";
import {
  AnthropicLlmClient,
  buildExistingModelContext,
  processTranscript,
  reviewModel,
} from "@barwise/llm";
import type { LlmClient } from "@barwise/llm";
import {
  executeDescribeDomain,
  executeDiagram,
  executeDiff,
  executeExportModel,
  executeImpactAnalysis,
  executeImportModel,
  executeLineageStatus,
  executeMerge,
  executeQueryModel,
  executeSchema,
  executeValidate,
  executeVerbalize,
  resolveSource,
} from "@barwise/mcp";
import * as vscode from "vscode";
import { CopilotLlmClient } from "../llm/CopilotLlmClient.js";
import { getOpenModelPath } from "./openModel.js";

const serializer = new OrmYamlSerializer();

// ---------------------------------------------------------------------------
// Tool input interfaces
// ---------------------------------------------------------------------------

interface ValidateInput {
  source?: string;
}

interface VerbalizeInput {
  source?: string;
  factType?: string;
}

interface SchemaInput {
  source?: string;
  format?: "ddl" | "json";
}

interface DiffInput {
  base?: string;
  incoming: string;
}

interface DiagramInput {
  source?: string;
}

interface ImportTranscriptInput {
  transcript: string;
  modelName?: string;
}

interface MergeInput {
  base?: string;
  incoming: string;
}

interface ExportModelInput {
  source?: string;
  format: string;
  annotate?: boolean;
  includeExamples?: boolean;
  strict?: boolean;
}

interface DescribeDomainInput {
  source?: string;
  focus?: string;
  includePopulations?: boolean;
  filePath?: string;
}

interface ImportModelInput {
  source: string;
  format: "ddl" | "openapi";
  modelName?: string;
}

interface ReviewModelInput {
  source?: string;
  focus?: string;
}

interface LineageStatusInput {
  source?: string;
}

interface ImpactAnalysisInput {
  source?: string;
  elementId: string;
}

interface QueryModelInput {
  source?: string;
  query: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the text from an MCP-style tool result. */
function toToolResult(
  mcpResult: { content: Array<{ type: "text"; text: string; }>; },
): vscode.LanguageModelToolResult {
  const text = mcpResult.content.map((c) => c.text).join("\n");
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text),
  ]);
}

/**
 * Resolve a source parameter: use the provided value if non-empty,
 * otherwise fall back to the open model (editor or diagram). Throws if
 * neither is available.
 */
function resolveSourceParam(source: string | undefined): string {
  if (source && source.trim().length > 0) return source;
  const open = getOpenModelPath();
  if (open) return open;
  throw new Error(
    "No source provided, and no .orm.yaml file is open or shown in a "
      + "diagram. Open or attach an .orm.yaml file, or pass a file path.",
  );
}

/**
 * Resolve the LLM client for the Copilot-backed tools: prefer Copilot
 * (no API key needed), fall back to Anthropic if the user configured it.
 */
async function resolveLlmClient(): Promise<LlmClient> {
  const config = vscode.workspace.getConfiguration("barwise");
  const provider = config.get<string>("llmProvider") ?? "copilot";

  if (provider === "anthropic") {
    const apiKey = config.get<string>("anthropicApiKey") || undefined;
    const model = config.get<string>("anthropicModel") || undefined;
    return new AnthropicLlmClient({ apiKey, model });
  }

  const family = config.get<string>("copilotModelFamily") || undefined;
  return new CopilotLlmClient({ family });
}

// ---------------------------------------------------------------------------
// Bespoke tool bodies (the two Copilot-backed tools and export's options)
// ---------------------------------------------------------------------------

/**
 * import_transcript: uses CopilotLlmClient so the user's Copilot
 * subscription handles the LLM call without any API key. Provides the
 * open model's types as context when an .orm.yaml file is focused.
 */
async function runImportTranscript(
  input: ImportTranscriptInput,
): Promise<vscode.LanguageModelToolResult> {
  const { transcript, modelName = "Extracted Model" } = input;
  const client = await resolveLlmClient();

  let existingModelContext: string | undefined;
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.fileName.endsWith(".orm.yaml")) {
    try {
      const model = serializer.deserialize(editor.document.getText());
      existingModelContext = buildExistingModelContext(model);
    } catch {
      // Non-critical: proceed without context if parsing fails.
    }
  }

  const result = await processTranscript(transcript, client, {
    modelName,
    existingModelContext,
  });

  const yaml = serializer.serialize(result.model);
  const annotated = annotateOrmYaml(yaml, result);

  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(annotated.yaml),
  ]);
}

/** export_model: forwards only the options the caller actually set. */
function runExportModel(input: ExportModelInput): vscode.LanguageModelToolResult {
  const source = resolveSourceParam(input.source);
  const { format, annotate, includeExamples, strict } = input;
  const opts: Record<string, unknown> = {};
  if (annotate !== undefined) opts.annotate = annotate;
  if (includeExamples !== undefined) opts.includeExamples = includeExamples;
  if (strict !== undefined) opts.strict = strict;
  const result = executeExportModel(
    source,
    format,
    Object.keys(opts).length > 0 ? opts : undefined,
  );
  return toToolResult(result);
}

/** review_model: Copilot-backed review, formatted as Markdown. */
async function runReviewModel(
  input: ReviewModelInput,
): Promise<vscode.LanguageModelToolResult> {
  const source = resolveSourceParam(input.source);
  const client = await resolveLlmClient();
  const model = resolveSource(source);
  const result = await reviewModel(model, client, { focus: input.focus });

  const lines: string[] = [];
  lines.push("# Model Review");
  lines.push("");
  lines.push(`**Summary**: ${result.summary}`);
  lines.push("");

  if (result.suggestions.length === 0) {
    lines.push("No suggestions. The model looks good!");
  } else {
    lines.push(`## Suggestions (${result.suggestions.length})`);
    lines.push("");

    const byCategory = new Map<string, typeof result.suggestions>();
    for (const suggestion of result.suggestions) {
      const existing = byCategory.get(suggestion.category) || [];
      byCategory.set(suggestion.category, [...existing, suggestion]);
    }

    for (const [category, suggestions] of byCategory.entries()) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      lines.push("");
      for (const s of suggestions) {
        const severity = s.severity.toUpperCase();
        const element = s.element ? ` (${s.element})` : "";
        lines.push(`**${severity}${element}**: ${s.description}`);
        lines.push(`*Rationale*: ${s.rationale}`);
        lines.push("");
      }
    }
  }

  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(lines.join("\n")),
  ]);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Build a `LanguageModelTool` from a `run` closure and an invocation
 * message (static, or derived from the input), and register it.
 */
function register<I>(
  context: vscode.ExtensionContext,
  name: string,
  run: (input: I) => vscode.LanguageModelToolResult | Promise<vscode.LanguageModelToolResult>,
  message: string | ((input: I) => string),
): void {
  const tool: vscode.LanguageModelTool<I> = {
    async invoke(options, _token) {
      return run(options.input);
    },
    async prepareInvocation(options, _token) {
      return {
        invocationMessage: typeof message === "function" ? message(options.input) : message,
      };
    },
  };
  context.subscriptions.push(vscode.lm.registerTool(name, tool));
}

/**
 * Register all barwise ORM tools with vscode.lm.registerTool().
 *
 * The tool names must match the `name` field in the
 * `contributes.languageModelTools` declarations in package.json.
 */
export function registerLanguageModelTools(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("barwise");
  if (!config.get<boolean>("enableMcpServer", true)) return;

  register<ValidateInput>(
    context,
    "barwise_validate_model",
    (i) => toToolResult(executeValidate(resolveSourceParam(i.source))),
    "Validating Barwise model...",
  );
  register<VerbalizeInput>(
    context,
    "barwise_verbalize_model",
    (i) => toToolResult(executeVerbalize(resolveSourceParam(i.source), i.factType)),
    "Verbalizing Barwise model...",
  );
  register<SchemaInput>(
    context,
    "barwise_generate_schema",
    (i) => toToolResult(executeSchema(resolveSourceParam(i.source), i.format ?? "ddl")),
    (i) => `Generating ${(i.format ?? "ddl").toUpperCase()} schema...`,
  );
  register<DiffInput>(
    context,
    "barwise_diff_models",
    (i) => toToolResult(executeDiff(resolveSourceParam(i.base), i.incoming)),
    "Comparing Barwise models...",
  );
  register<DiagramInput>(
    context,
    "barwise_generate_diagram",
    async (i) => toToolResult(await executeDiagram(resolveSourceParam(i.source))),
    "Generating Barwise diagram...",
  );
  register<ImportTranscriptInput>(
    context,
    "barwise_import_transcript",
    runImportTranscript,
    "Extracting Barwise model from transcript...",
  );
  register<MergeInput>(
    context,
    "barwise_merge_models",
    (i) => toToolResult(executeMerge(resolveSourceParam(i.base), i.incoming)),
    "Merging Barwise models...",
  );
  register<ExportModelInput>(
    context,
    "barwise_export_model",
    runExportModel,
    (i) => `Exporting Barwise model as ${i.format}...`,
  );
  register<DescribeDomainInput>(
    context,
    "barwise_describe_domain",
    (i) =>
      toToolResult(
        executeDescribeDomain(
          resolveSourceParam(i.source),
          i.focus,
          i.includePopulations,
          i.filePath,
        ),
      ),
    "Describing domain model...",
  );
  register<QueryModelInput>(
    context,
    "barwise_query_model",
    (i) => toToolResult(executeQueryModel(resolveSourceParam(i.source), i.query)),
    (i) => `Querying Barwise model: ${i.query}`,
  );
  register<ImportModelInput>(
    context,
    "barwise_import_model",
    async (i) => toToolResult(await executeImportModel(i.source, i.format, i.modelName)),
    (i) => `Importing Barwise model from ${i.format.toUpperCase()}...`,
  );
  register<ReviewModelInput>(
    context,
    "barwise_review_model",
    runReviewModel,
    "Reviewing Barwise model...",
  );
  register<LineageStatusInput>(
    context,
    "barwise_lineage_status",
    (i) => toToolResult(executeLineageStatus(resolveSourceParam(i.source))),
    "Checking lineage status...",
  );
  register<ImpactAnalysisInput>(
    context,
    "barwise_impact_analysis",
    (i) => toToolResult(executeImpactAnalysis(resolveSourceParam(i.source), i.elementId)),
    "Analyzing impact...",
  );
}
