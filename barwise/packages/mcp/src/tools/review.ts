/**
 * review_model tool: LLM-powered semantic review of an ORM model.
 */

import { reviewModel } from "@barwise/llm";
import type { ProviderName } from "@barwise/llm";
import { createLlmClient } from "@barwise/llm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveModels, type SourceInput } from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

export function registerReviewTool(server: McpServer): void {
  server.registerTool(
    "review_model",
    {
      title: "Review ORM Model",
      description: "Use an LLM to review an ORM model for semantic quality. "
        + "Provides suggestions about naming, completeness, normalization, "
        + "constraints, and definitions. Distinct from validation (which checks "
        + "structural rules) -- review gives subjective modeling advice. "
        + "Requires an LLM provider configured via environment variables. Given "
        + "a .orm-project.yaml manifest, reviews every domain (or one chosen "
        + "with `domain`).",
      inputSchema: {
        source: sourceInputSchema(
          "File path to .orm.yaml, .orm-project.yaml, or inline YAML content",
        ),
        domain: z
          .string()
          .optional()
          .describe("For a project source, review only this one domain context"),
        focus: z
          .string()
          .optional()
          .describe("Focus on specific entity/fact type name (omit for full review)"),
        provider: z
          .enum(["anthropic", "openai", "ollama"])
          .optional()
          .describe("LLM provider. Auto-detects from env vars if omitted."),
        model: z
          .string()
          .optional()
          .describe("LLM model override (e.g. 'gpt-4o', 'claude-sonnet-4-5-20250929')"),
      },
    },
    async ({ source, domain, focus, provider, model }) => {
      return executeReview(
        source,
        focus,
        provider as ProviderName | undefined,
        model,
        domain,
      );
    },
  );
}

export async function executeReview(
  source: SourceInput,
  focus?: string,
  provider?: ProviderName,
  model?: string,
  domain?: string,
): Promise<{ content: Array<{ type: "text"; text: string; }>; }> {
  const { resolved, problems } = resolveModels(source, domain);

  const client = createLlmClient({ provider, model });

  const multi = resolved.length > 1;
  const sections: string[] = [];
  for (const p of problems) sections.push(`Warning: ${p}`);

  for (const { context, model: ormModel } of resolved) {
    const result = await reviewModel(ormModel, client, { focus });
    const body = formatReview(result);
    sections.push(multi && context ? `== ${context} ==\n\n${body}` : body);
  }

  return {
    content: [{ type: "text" as const, text: sections.join("\n\n") }],
  };
}

/** Render one model's review result as Markdown. */
function formatReview(result: Awaited<ReturnType<typeof reviewModel>>): string {
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

    // Group by category
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

  return lines.join("\n");
}
