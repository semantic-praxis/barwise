/**
 * verbalize_model tool: generates FORML verbalizations for a model.
 */

import { Verbalizer } from "@barwise/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource } from "../helpers/resolve.js";
import { boundedTextResult } from "../helpers/response.js";

/** Readings shown inline by summary mode. */
const SUMMARY_PREVIEW = 20;

export function registerVerbalizeTool(server: McpServer): void {
  server.registerTool(
    "verbalize_model",
    {
      title: "Verbalize ORM Model",
      description: "Generate FORML natural-language readings for fact types "
        + "and constraints in an ORM 2 model. Defaults to full output (large "
        + "results spill to a file). Pass mode='summary' for category counts "
        + "plus a short preview, or factType to focus on a single fact type.",
      inputSchema: {
        source: z
          .string()
          .describe("File path to .orm.yaml or inline YAML content"),
        factType: z
          .string()
          .optional()
          .describe("Specific fact type name to verbalize (omit for all)"),
        mode: z
          .enum(["full", "summary"])
          .optional()
          .describe(
            "'full' (default) returns every reading; 'summary' returns "
              + "per-category counts and a short preview.",
          ),
      },
    },
    async ({ source, factType, mode }) => {
      return executeVerbalize(source, factType, mode);
    },
  );
}

export function executeVerbalize(
  source: string,
  factType?: string,
  mode: "full" | "summary" = "full",
): { content: Array<{ type: "text"; text: string; }>; } {
  const model = resolveSource(source);
  const verbalizer = new Verbalizer();

  if (factType) {
    const ft = model.getFactTypeByName(factType);
    if (!ft) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No fact type found matching "${factType}".`,
          },
        ],
      };
    }
    const verbalizations = verbalizer.verbalizeFactType(ft.id, model);
    return boundedTextResult(verbalizations.map((v) => v.text).join("\n"), {
      kind: "verbalization",
      source,
    });
  }

  const verbalizations = verbalizer.verbalizeModel(model);

  if (mode === "summary") {
    return {
      content: [{ type: "text" as const, text: buildSummary(verbalizations) }],
    };
  }

  return boundedTextResult(verbalizations.map((v) => v.text).join("\n"), {
    kind: "verbalization",
    source,
  });
}

/** Build a compact, never-spilling digest of a model's verbalizations. */
function buildSummary(
  verbalizations: ReadonlyArray<{ category: string; text: string; }>,
): string {
  const counts = new Map<string, number>();
  for (const v of verbalizations) {
    counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(`Verbalization summary -- ${verbalizations.length} reading(s):`);
  for (const [category, n] of [...counts.entries()].sort()) {
    lines.push(`  ${category}: ${n}`);
  }
  lines.push("");

  const preview = verbalizations.slice(0, SUMMARY_PREVIEW);
  lines.push(`First ${preview.length} reading(s):`);
  for (const v of preview) {
    lines.push(`  ${v.text}`);
  }

  const remaining = verbalizations.length - preview.length;
  if (remaining > 0) {
    lines.push("");
    lines.push(
      `(${remaining} more -- call again with mode='full' for every reading, `
        + "or factType=<name> to focus on one fact type.)",
    );
  }

  return lines.join("\n");
}
