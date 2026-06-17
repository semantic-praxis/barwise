/**
 * dbt YAML annotator.
 *
 * Injects TODO and NOTE comments into dbt schema YAML files based on
 * the import gap report. Comments are placed immediately after the
 * `- name:` line of the relevant model or column, making gaps and
 * inferences visible where the engineer works.
 *
 * Comment prefixes:
 *   - `# TODO(barwise):` for gaps and warnings that need human action
 *   - `# NOTE(barwise):` for informational notes (e.g. source-resolved types)
 *
 * This operates at the text level to preserve the original YAML
 * formatting, comments, and whitespace.
 */

import { formatBarwiseComment, stripBarwiseComments } from "@barwise/core/annotation";
import type { DbtImportReport, ReportEntry } from "./DbtImportReport.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AnnotationOptions {
  /** Include NOTE comments for info-level entries (default: false). */
  readonly includeInfoNotes?: boolean;
  /** Only annotate entries for specific categories. If omitted, all categories are included. */
  readonly categories?: readonly string[];
}

/**
 * Annotate a dbt schema YAML string with TODO/NOTE comments from the
 * import report. Returns the annotated YAML string.
 *
 * @param yamlContent - The original YAML file content.
 * @param report - The import gap report.
 * @param options - Optional filtering options.
 */
export function annotateDbtYaml(
  yamlContent: string,
  report: DbtImportReport,
  options: AnnotationOptions = {},
): string {
  const includeInfo = options.includeInfoNotes ?? false;
  const categories = options.categories
    ? new Set(options.categories)
    : undefined;

  // Filter entries to those we want to annotate.
  const entries = report.entries.filter((e) => {
    if (e.severity === "info" && !includeInfo) return false;
    if (categories && !categories.has(e.category)) return false;
    return true;
  });

  if (entries.length === 0) return stripBarwiseComments(yamlContent);

  // Strip any existing barwise annotations to ensure idempotency.
  const cleanContent = stripBarwiseComments(yamlContent);

  // Group entries by model name and column name for efficient lookup.
  const modelEntries = new Map<string, ReportEntry[]>();
  const columnEntries = new Map<string, ReportEntry[]>();

  for (const entry of entries) {
    if (entry.columnName) {
      const key = `${entry.modelName}::${entry.columnName}`;
      const existing = columnEntries.get(key) ?? [];
      existing.push(entry);
      columnEntries.set(key, existing);
    } else {
      const existing = modelEntries.get(entry.modelName) ?? [];
      existing.push(entry);
      modelEntries.set(entry.modelName, existing);
    }
  }

  const lines = cleanContent.split("\n");
  const result: string[] = [];

  // Track which model context we're in by scanning for `- name:` patterns
  // at the model indent level vs. column indent level.
  let currentModelName: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    result.push(line);

    // Detect model-level `- name:` (indented 2-4 spaces under models:/sources:).
    const modelMatch = line.match(/^(\s{2,4})- name:\s*(\S+)/);
    if (modelMatch) {
      currentModelName = modelMatch[2];
      const indent = modelMatch[1]! + "  "; // Comment indented under the `- name:` line.

      // Inject model-level comments.
      const mEntries = modelEntries.get(currentModelName!);
      if (mEntries) {
        for (const e of mEntries) {
          result.push(`${indent}${formatEntryComment(e)}`);
        }
      }
      continue;
    }

    // Detect column-level `- name:` (indented 6-8 spaces under columns:).
    const colMatch = line.match(/^(\s{6,8})- name:\s*(\S+)/);
    if (colMatch && currentModelName) {
      const columnName = colMatch[2]!;
      const indent = colMatch[1]! + "  "; // Comment indented under the column's `- name:`.
      const key = `${currentModelName}::${columnName}`;

      const cEntries = columnEntries.get(key);
      if (cEntries) {
        for (const e of cEntries) {
          result.push(`${indent}${formatEntryComment(e)}`);
        }
      }
    }
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEntryComment(entry: ReportEntry): string {
  const severity = entry.severity === "info" ? "note" : "todo";
  return formatBarwiseComment(severity, entry.message);
}
