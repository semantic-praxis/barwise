/**
 * The report of an export's `constraintSpecs`: what the format said it
 * could not express. One text for every surface (export-constraint-specs.spec.md),
 * so the CLI's stderr lines and the MCP tool's block cannot drift apart
 * in wording, count, or grouping.
 *
 * Specs are grouped by verbalization, and the heading counts rules: a
 * value type's own value constraint is one sentence spilled once per
 * column it constrains, and two constraints can read alike. In detail,
 * every distinct pseudocode in a group is listed, since each is a check
 * to implement (schema-export-constraint-specs.spec.md).
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
  const groups = new Map<string, { specs: ConstraintSpec[]; count: number; }>();
  for (const spec of specs) {
    const group = groups.get(spec.verbalization);
    if (!group) groups.set(spec.verbalization, { specs: [spec], count: 1 });
    else {
      group.count++;
      const same = group.specs.some((s) =>
        s.pseudocode === spec.pseudocode && s.example === spec.example
      );
      if (!same) group.specs.push(spec);
    }
  }
  const where = options.domain ? ` (domain ${options.domain})` : "";
  const lines = [`${groups.size} constraint(s) the ${format} format could not express${where}:`];
  for (const [verbalization, { specs: distinct, count }] of groups) {
    const item = `- ${verbalization}${count > 1 ? ` (x${count})` : ""}`;
    if (!options.detail) {
      lines.push(`  ${item}`);
      continue;
    }
    lines.push("", item);
    for (const spec of distinct) {
      lines.push(labelled("Pseudocode", spec.pseudocode), labelled("Example", spec.example));
    }
  }
  return lines.join("\n");
}

/** A labelled field, its continuation lines indented under the label. */
function labelled(label: string, text: string): string {
  return `  ${label}: ${text.split("\n").join("\n    ")}`;
}
