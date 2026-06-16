/**
 * import_transcript tool: processes a transcript through LLM extraction.
 */

import { annotateOrmYaml, type ModelDiffResult, OrmYamlSerializer } from "@barwise/core";
import { buildExistingModelContext, createLlmClient, processTranscript } from "@barwise/llm";
import type { CandidateFraming, ProviderName } from "@barwise/llm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readSource, resolveSource } from "../helpers/resolve.js";

const serializer = new OrmYamlSerializer();

export function registerImportTool(server: McpServer): void {
  server.registerTool(
    "import_transcript",
    {
      title: "Import Transcript",
      description: "Process a business domain transcript through LLM extraction "
        + "to produce a formal ORM 2 model. Requires an LLM provider "
        + "configured via environment variables or explicit options.",
      inputSchema: {
        transcript: z
          .string()
          .describe("Transcript text or file path to a text file"),
        modelName: z
          .string()
          .default("Extracted Model")
          .describe("Name for the resulting ORM model"),
        base: z
          .string()
          .optional()
          .describe(
            "File path or inline YAML of an existing base model. "
              + "When provided, the LLM is told which types already exist "
              + "so it can reference them instead of redefining them.",
          ),
        provider: z
          .enum(["anthropic", "openai", "ollama"])
          .optional()
          .describe(
            "LLM provider. Auto-detects from env vars if omitted.",
          ),
        model: z
          .string()
          .optional()
          .describe("LLM model override (e.g. 'gpt-4o', 'claude-sonnet-4-5-20250929')"),
        alternatives: z
          .boolean()
          .optional()
          .describe(
            "When true, also return one alternative framing at the "
              + "highest-impact structural fork, with a diff against the "
              + "primary model.",
          ),
      },
    },
    async ({ transcript, modelName, base, provider, model, alternatives }) => {
      return executeImport(
        transcript,
        modelName,
        provider as ProviderName | undefined,
        model,
        base,
        alternatives,
      );
    },
  );
}

export async function executeImport(
  transcript: string,
  modelName: string = "Extracted Model",
  provider?: ProviderName,
  model?: string,
  base?: string,
  alternatives?: boolean,
): Promise<{ content: Array<{ type: "text"; text: string; }>; }> {
  const text = readSource(transcript);

  const client = createLlmClient({
    provider,
    model,
  });

  // Build context from the base model so the LLM knows which types
  // already exist and can reference them by name.
  let existingModelContext: string | undefined;
  if (base) {
    try {
      const baseModel = resolveSource(base);
      existingModelContext = buildExistingModelContext(baseModel);
    } catch {
      // Non-critical: proceed without context.
    }
  }

  const result = await processTranscript(text, client, {
    modelName,
    existingModelContext,
    alternatives,
  });

  const yaml = serializer.serialize(result.model);
  const annotated = annotateOrmYaml(yaml, result);
  const outputText = annotated.yaml + formatAlternativeFramings(result.alternatives);

  return {
    content: [{ type: "text" as const, text: outputText }],
  };
}

/**
 * Render the alternative framings as a trailing markdown section, or an
 * empty string when there are none.
 */
export function formatAlternativeFramings(
  alternatives: readonly CandidateFraming[] | undefined,
): string {
  if (!alternatives || alternatives.length === 0) return "";

  const lines = ["", "## Alternative framings", ""];
  for (const alt of alternatives) {
    lines.push(`- ${alt.rationale}`);
    lines.push(`  Resolves: ${alt.ambiguityDescription}`);
    lines.push(`  ${summarizeDiff(alt.diff)}`);
  }
  return "\n" + lines.join("\n") + "\n";
}

/** A one-line summary of a diff: counts plus the changed element names. */
function summarizeDiff(diff: ModelDiffResult): string {
  let added = 0;
  let removed = 0;
  let modified = 0;
  const changed: string[] = [];
  for (const d of diff.deltas) {
    const label = "name" in d ? d.name : d.term;
    if (d.kind === "added") {
      added += 1;
      changed.push(label);
    } else if (d.kind === "removed") {
      removed += 1;
    } else if (d.kind === "modified") {
      modified += 1;
      changed.push(label);
    }
  }
  let names = "";
  if (changed.length > 0) {
    const shown = changed.slice(0, 6).join(", ");
    names = ` (${shown}${changed.length > 6 ? ", ..." : ""})`;
  }
  return `Diff vs primary: ${added} added, ${modified} modified, ${removed} removed${names}`;
}
