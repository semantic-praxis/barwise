/**
 * verbalize_model tool: generates FORML verbalizations for a model.
 */

import type { OrmModel } from "@barwise/core";
import { type Counterexample, generateCounterexamples } from "@barwise/core/counterexample";
import { Verbalizer } from "@barwise/core/verbalization";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveModels } from "../helpers/resolve.js";
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
        + "plus a short preview, or factType to focus on a single fact type. "
        + "Given a .orm-project.yaml manifest, verbalizes every domain (or one "
        + "chosen with `domain`).",
      inputSchema: {
        source: z
          .string()
          .describe("File path to .orm.yaml, .orm-project.yaml, or inline YAML content"),
        domain: z
          .string()
          .optional()
          .describe("For a project source, verbalize only this one domain context"),
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
        counterexamples: z
          .boolean()
          .optional()
          .describe(
            "When true, append the minimal sample population each "
              + "constraint forbids -- a probe to confirm the model rules "
              + "out what it should.",
          ),
      },
    },
    async ({ source, domain, factType, mode, counterexamples }) => {
      return executeVerbalize(source, factType, mode, counterexamples, domain);
    },
  );
}

export function executeVerbalize(
  source: string,
  factType?: string,
  mode: "full" | "summary" = "full",
  counterexamples = false,
  domain?: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  const { resolved, problems } = resolveModels(source, domain);

  // Single plain model: preserve the original output exactly (summary and
  // not-found stay inline; full output spills when large).
  if (resolved.length === 1 && resolved[0]!.context === undefined && problems.length === 0) {
    return verbalizeSingle(resolved[0]!.model, source, factType, mode, counterexamples);
  }

  const multi = resolved.length > 1;
  const parts = resolved.map(({ context, model }) => {
    const body = verbalizeText(model, factType, mode, counterexamples);
    return multi && context ? `== ${context} ==\n\n${body}` : body;
  });
  const warn = problems.length > 0
    ? problems.map((p) => `Warning: ${p}`).join("\n") + "\n\n"
    : "";
  return boundedTextResult(warn + parts.join("\n\n"), { kind: "verbalization", source });
}

/** The original single-model behavior, kept byte-for-byte. */
function verbalizeSingle(
  model: OrmModel,
  source: string,
  factType: string | undefined,
  mode: "full" | "summary",
  counterexamples: boolean,
): { content: Array<{ type: "text"; text: string; }>; } {
  if (factType && !model.getFactTypeByName(factType)) {
    return {
      content: [{ type: "text" as const, text: `No fact type found matching "${factType}".` }],
    };
  }
  if (!factType && mode === "summary") {
    const verbalizations = new Verbalizer().verbalizeModel(model);
    return { content: [{ type: "text" as const, text: buildSummary(verbalizations) }] };
  }
  return boundedTextResult(verbalizeText(model, factType, mode, counterexamples), {
    kind: "verbalization",
    source,
  });
}

/** Produce the verbalization text for one model (no output bounding). */
function verbalizeText(
  model: OrmModel,
  factType: string | undefined,
  mode: "full" | "summary",
  counterexamples: boolean,
): string {
  const verbalizer = new Verbalizer();

  if (factType) {
    const ft = model.getFactTypeByName(factType);
    if (!ft) return `No fact type found matching "${factType}".`;
    const verbalizations = verbalizer.verbalizeFactType(ft.id, model);
    let text = verbalizations.map((v) => v.text).join("\n");
    if (counterexamples) {
      text += renderCounterexamples(
        generateCounterexamples(model).filter((c) => c.factTypeId === ft.id),
      );
    }
    return text;
  }

  const verbalizations = verbalizer.verbalizeModel(model);
  if (mode === "summary") return buildSummary(verbalizations);

  let text = verbalizations.map((v) => v.text).join("\n");
  if (counterexamples) {
    text += renderCounterexamples(generateCounterexamples(model));
  }
  return text;
}

/** Append a labeled block of counterexample readings, or nothing if none. */
function renderCounterexamples(ces: readonly Counterexample[]): string {
  if (ces.length === 0) return "";
  const lines = ["", "", "Counterexamples (what the constraints rule out):"];
  for (const c of ces) {
    lines.push(`  ${c.text}`);
  }
  return lines.join("\n");
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
