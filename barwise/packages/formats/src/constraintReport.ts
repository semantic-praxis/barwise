/**
 * The report of an export's `constraintSpecs`: what the format said it
 * could not express. One text for every surface (export-constraint-specs.spec.md),
 * so the CLI's stderr lines and the MCP tool's block cannot drift apart
 * in wording, count, or grouping.
 *
 * Specs are grouped by verbalization, because the DDL router spills one
 * rule once per table it touches; the heading counts rules, not spills.
 */
import type { ConstraintSpec } from "@barwise/core";

export interface ConstraintReportOptions {
  /** The project domain the export came from, named in the heading. */
  readonly domain?: string;
  /**
   * Add each rule's pseudocode and example. The MCP tool sets it, for an
   * agent acting on the export; the CLI does not, since a person reads
   * the report in a terminal and neither artifact carries them.
   */
  readonly detail?: boolean;
}

/** The report, or `undefined` when there is nothing to report. */
export function formatConstraintReport(
  specs: readonly ConstraintSpec[] | undefined,
  format: string,
  options: ConstraintReportOptions = {},
): string | undefined {
  if (!specs || specs.length === 0) return undefined;
  const groups = new Map<string, { spec: ConstraintSpec; count: number; }>();
  for (const spec of specs) {
    const group = groups.get(spec.verbalization);
    if (group) group.count++;
    else groups.set(spec.verbalization, { spec, count: 1 });
  }
  const where = options.domain ? ` (domain ${options.domain})` : "";
  const lines = [`${groups.size} constraint(s) the ${format} format could not express${where}:`];
  for (const { spec, count } of groups.values()) {
    const item = `- ${spec.verbalization}${count > 1 ? ` (x${count})` : ""}`;
    if (!options.detail) {
      lines.push(`  ${item}`);
      continue;
    }
    lines.push(
      "",
      item,
      labelled("Pseudocode", spec.pseudocode),
      labelled("Example", spec.example),
    );
  }
  return lines.join("\n");
}

/** A labelled field, its continuation lines indented under the label. */
function labelled(label: string, text: string): string {
  return `  ${label}: ${text.split("\n").join("\n    ")}`;
}
