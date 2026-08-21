/**
 * barwise review <file>
 *
 * LLM-powered semantic review of a model
 * (docs/specs/cli-surface-parity.spec.md). Distinct from `validate`,
 * which checks structural rules deterministically: review returns
 * advice, and advice can be wrong.
 *
 * Reached MCP and VS Code but not the CLI until now
 * (docs/unwired-capability-audit-2026-08-20.md), despite the CLI
 * already building both things `reviewModel` needs -- a model and an
 * LlmClient -- for `barwise import transcript`.
 *
 * Always exits zero when the review completes, whatever it says. A
 * command that failed on model-generated suggestions would put an LLM
 * in the merge path, where a bad day for the provider becomes a red
 * build for everyone. Pipe `--format json` through `jq` to make your
 * own policy.
 */

import type { ProviderName, ReviewResult, ReviewSuggestion } from "@barwise/llm";
import { createLlmClient, reviewModel } from "@barwise/llm";
import type { Command } from "commander";
import { loadModel } from "../workspace/io.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Review an ORM model's semantic quality using an LLM")
    .argument("<file>", "Path to .orm.yaml file")
    .option("--focus <name>", "Review only this entity or fact type")
    .option(
      "--provider <provider>",
      "LLM provider (anthropic, openai, ollama). Auto-detects from env vars if omitted.",
    )
    .option("--model <model>", "Model override for the LLM provider")
    .option("--api-key <key>", "API key (falls back to env vars)")
    .option("--base-url <url>", "Ollama server URL (only for ollama provider)")
    .option("--format <format>", "Output format (text or json)", "text")
    .action(
      async (
        file: string,
        opts: {
          focus?: string;
          provider?: string;
          model?: string;
          apiKey?: string;
          baseUrl?: string;
          format: string;
        },
      ) => {
        try {
          const model = loadModel(file);
          const client = createLlmClient({
            provider: opts.provider as ProviderName | undefined,
            apiKey: opts.apiKey,
            model: opts.model,
            baseUrl: opts.baseUrl,
          });

          process.stderr.write(
            opts.focus
              ? `Reviewing ${opts.focus}...\n`
              : "Reviewing model...\n",
          );

          const result = await reviewModel(model, client, {
            ...(opts.focus !== undefined ? { focus: opts.focus } : {}),
          });

          if (opts.format === "json") {
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
            return;
          }
          process.stdout.write(renderReview(result));
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}

function renderReview(result: ReviewResult): string {
  const lines: string[] = [];
  if (result.suggestions.length === 0) {
    lines.push("No suggestions.");
  } else {
    // Grouped by category so a reader can skip a whole class of advice
    // rather than triaging every line. Authored order is preserved
    // inside each group.
    const byCategory = new Map<string, ReviewSuggestion[]>();
    for (const s of result.suggestions) {
      const group = byCategory.get(s.category) ?? [];
      group.push(s);
      byCategory.set(s.category, group);
    }
    for (const [category, group] of byCategory) {
      lines.push(`${category}:`);
      for (const s of group) {
        const element = s.element ? ` ${s.element}:` : "";
        lines.push(`  [${s.severity}]${element} ${s.description}`);
        lines.push(`    ${s.rationale}`);
      }
      lines.push("");
    }
  }
  lines.push(result.summary);
  return lines.join("\n") + "\n";
}
