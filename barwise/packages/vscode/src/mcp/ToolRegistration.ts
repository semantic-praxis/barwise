/**
 * Registers barwise ORM tools with VS Code's Language Model Tool API
 * (vscode.lm.registerTool). These tools run in the extension host
 * process and have full access to the VS Code API, including Copilot
 * language models -- unlike the MCP stdio server which runs as a
 * separate child process.
 *
 * Each tool wraps the corresponding execute function from @barwise/mcp,
 * except import_transcript which uses CopilotLlmClient directly.
 */

import { annotateOrmYaml, OrmYamlSerializer } from "@barwise/core";
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
// Helper: extract text from MCP-style result
// ---------------------------------------------------------------------------

function toToolResult(
  mcpResult: { content: Array<{ type: "text"; text: string; }>; },
): vscode.LanguageModelToolResult {
  const text = mcpResult.content.map((c) => c.text).join("\n");
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text),
  ]);
}

// ---------------------------------------------------------------------------
// Helper: resolve the active .orm.yaml file path
// ---------------------------------------------------------------------------

/**
 * Returns the file path of the active editor if it is an .orm.yaml file.
 * Used as a fallback when tools don't receive an explicit source/base.
 */
function getActiveOrmFile(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.fileName.endsWith(".orm.yaml")) {
    return editor.document.uri.fsPath;
  }
  return undefined;
}

/**
 * Resolve a source parameter: use the provided value if non-empty,
 * otherwise fall back to the active .orm.yaml file. Throws if neither
 * is available.
 */
function resolveSourceParam(source: string | undefined): string {
  if (source && source.trim().length > 0) return source;
  const active = getActiveOrmFile();
  if (active) return active;
  throw new Error(
    "No source provided and no .orm.yaml file is open in the editor. "
      + "Please open an .orm.yaml file or provide a file path.",
  );
}

// ---------------------------------------------------------------------------
// validate_model
// ---------------------------------------------------------------------------

class ValidateModelTool implements vscode.LanguageModelTool<ValidateInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ValidateInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const result = executeValidate(source);
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<ValidateInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Validating Barwise model...",
    };
  }
}

// ---------------------------------------------------------------------------
// verbalize_model
// ---------------------------------------------------------------------------

class VerbalizeModelTool implements vscode.LanguageModelTool<VerbalizeInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<VerbalizeInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const result = executeVerbalize(source, options.input.factType);
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<VerbalizeInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Verbalizing Barwise model...",
    };
  }
}

// ---------------------------------------------------------------------------
// generate_schema
// ---------------------------------------------------------------------------

class GenerateSchemaTool implements vscode.LanguageModelTool<SchemaInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SchemaInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const result = executeSchema(source, options.input.format ?? "ddl");
    return toToolResult(result);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SchemaInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const fmt = options.input.format ?? "ddl";
    return {
      invocationMessage: `Generating ${fmt.toUpperCase()} schema...`,
    };
  }
}

// ---------------------------------------------------------------------------
// diff_models
// ---------------------------------------------------------------------------

class DiffModelsTool implements vscode.LanguageModelTool<DiffInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DiffInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const base = resolveSourceParam(options.input.base);
    const result = executeDiff(base, options.input.incoming);
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<DiffInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Comparing Barwise models...",
    };
  }
}

// ---------------------------------------------------------------------------
// generate_diagram
// ---------------------------------------------------------------------------

class GenerateDiagramTool implements vscode.LanguageModelTool<DiagramInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DiagramInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const result = await executeDiagram(source);
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<DiagramInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Generating Barwise diagram...",
    };
  }
}

// ---------------------------------------------------------------------------
// import_transcript
//
// This tool is special: instead of delegating to the @barwise/mcp
// executeImport (which requires an external LLM provider), it uses
// CopilotLlmClient so the user's Copilot subscription handles the
// LLM call without any API key.
// ---------------------------------------------------------------------------

class ImportTranscriptTool implements vscode.LanguageModelTool<ImportTranscriptInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ImportTranscriptInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { transcript, modelName = "Extracted Model" } = options.input;

    // Resolve the LLM client: prefer Copilot, fall back to Anthropic
    // if the user has configured it.
    const client = await this.resolveClient();

    // If an .orm.yaml file is open, provide its types as context so
    // the LLM can reference existing entities instead of redefining them.
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

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<ImportTranscriptInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Extracting Barwise model from transcript...",
    };
  }

  private async resolveClient(): Promise<LlmClient> {
    const config = vscode.workspace.getConfiguration("barwise");
    const provider = config.get<string>("llmProvider") ?? "copilot";

    if (provider === "anthropic") {
      const apiKey = config.get<string>("anthropicApiKey") || undefined;
      const model = config.get<string>("anthropicModel") || undefined;
      return new AnthropicLlmClient({ apiKey, model });
    }

    // Default: use Copilot (no API key needed).
    const family = config.get<string>("copilotModelFamily") || undefined;
    return new CopilotLlmClient({ family });
  }
}

// ---------------------------------------------------------------------------
// merge_models
// ---------------------------------------------------------------------------

class MergeModelsTool implements vscode.LanguageModelTool<MergeInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<MergeInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const base = resolveSourceParam(options.input.base);
    const result = executeMerge(base, options.input.incoming);
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<MergeInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Merging Barwise models...",
    };
  }
}

// ---------------------------------------------------------------------------
// export_model
// ---------------------------------------------------------------------------

class ExportModelTool implements vscode.LanguageModelTool<ExportModelInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ExportModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const { format, annotate, includeExamples, strict } = options.input;
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

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ExportModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Exporting Barwise model as ${options.input.format}...`,
    };
  }
}

// ---------------------------------------------------------------------------
// describe_domain
// ---------------------------------------------------------------------------

class DescribeDomainTool implements vscode.LanguageModelTool<DescribeDomainInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DescribeDomainInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const { focus, includePopulations, filePath } = options.input;
    const result = executeDescribeDomain(
      source,
      focus,
      includePopulations,
      filePath,
    );
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<DescribeDomainInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Describing domain model...",
    };
  }
}

// ---------------------------------------------------------------------------
// import_model (deterministic format parsing, not LLM-based)
// ---------------------------------------------------------------------------

class ImportModelTool implements vscode.LanguageModelTool<ImportModelInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ImportModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { source, format, modelName } = options.input;
    const result = await executeImportModel(source, format, modelName);
    return toToolResult(result);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ImportModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Importing Barwise model from ${options.input.format.toUpperCase()}...`,
    };
  }
}

// ---------------------------------------------------------------------------
// review_model
//
// Like import_transcript, this tool uses CopilotLlmClient so the
// user's Copilot subscription handles the LLM call.
// ---------------------------------------------------------------------------

class ReviewModelTool implements vscode.LanguageModelTool<ReviewModelInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReviewModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const { focus } = options.input;
    const client = await this.resolveClient();

    const model = resolveSource(source);
    const result = await reviewModel(model, client, { focus });

    // Format the output
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

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<ReviewModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Reviewing Barwise model...",
    };
  }

  private async resolveClient(): Promise<LlmClient> {
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
}

// ---------------------------------------------------------------------------
// lineage_status
// ---------------------------------------------------------------------------

class LineageStatusTool implements vscode.LanguageModelTool<LineageStatusInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<LineageStatusInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const result = executeLineageStatus(source);
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<LineageStatusInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Checking lineage status...",
    };
  }
}

// ---------------------------------------------------------------------------
// impact_analysis
// ---------------------------------------------------------------------------

class ImpactAnalysisTool implements vscode.LanguageModelTool<ImpactAnalysisInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ImpactAnalysisInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const result = executeImpactAnalysis(source, options.input.elementId);
    return toToolResult(result);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<ImpactAnalysisInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Analyzing impact...",
    };
  }
}

// ---------------------------------------------------------------------------
// query_model
// ---------------------------------------------------------------------------

class QueryModelTool implements vscode.LanguageModelTool<QueryModelInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<QueryModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const source = resolveSourceParam(options.input.source);
    const result = executeQueryModel(source, options.input.query);
    return toToolResult(result);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<QueryModelInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Querying Barwise model: ${options.input.query}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all barwise ORM tools with vscode.lm.registerTool().
 *
 * The tool names must match the `name` field in the
 * `contributes.languageModelTools` declarations in package.json.
 */
export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
): void {
  const config = vscode.workspace.getConfiguration("barwise");
  const enabled = config.get<boolean>("enableMcpServer", true);

  if (!enabled) return;

  context.subscriptions.push(
    vscode.lm.registerTool("barwise_validate_model", new ValidateModelTool()),
    vscode.lm.registerTool(
      "barwise_verbalize_model",
      new VerbalizeModelTool(),
    ),
    vscode.lm.registerTool(
      "barwise_generate_schema",
      new GenerateSchemaTool(),
    ),
    vscode.lm.registerTool("barwise_diff_models", new DiffModelsTool()),
    vscode.lm.registerTool(
      "barwise_generate_diagram",
      new GenerateDiagramTool(),
    ),
    vscode.lm.registerTool(
      "barwise_import_transcript",
      new ImportTranscriptTool(),
    ),
    vscode.lm.registerTool("barwise_merge_models", new MergeModelsTool()),
    vscode.lm.registerTool("barwise_export_model", new ExportModelTool()),
    vscode.lm.registerTool(
      "barwise_describe_domain",
      new DescribeDomainTool(),
    ),
    vscode.lm.registerTool("barwise_query_model", new QueryModelTool()),
    vscode.lm.registerTool("barwise_import_model", new ImportModelTool()),
    vscode.lm.registerTool("barwise_review_model", new ReviewModelTool()),
    vscode.lm.registerTool(
      "barwise_lineage_status",
      new LineageStatusTool(),
    ),
    vscode.lm.registerTool(
      "barwise_impact_analysis",
      new ImpactAnalysisTool(),
    ),
  );
}
