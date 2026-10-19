/**
 * Output formatting helpers for the CLI.
 */

import type { Diagnostic, DiagnosticSeverity } from "@barwise/core";
import type { Counterexample } from "@barwise/core/counterexample";
import type { Verbalization } from "@barwise/core/verbalization";

/**
 * Format diagnostics as human-readable text.
 */
export function formatDiagnostics(
  diagnostics: readonly { severity: DiagnosticSeverity; message: string; }[],
): string {
  if (diagnostics.length === 0) return "";

  return diagnostics
    .map((d) => {
      const tag = d.severity.toUpperCase().padEnd(7);
      return `  ${tag} ${d.message}`;
    })
    .join("\n");
}

/**
 * Format diagnostics as JSON.
 */
export function formatDiagnosticsJson<R extends string>(
  diagnostics: readonly Diagnostic<R>[],
): string {
  return JSON.stringify(
    diagnostics.map((d) => ({
      severity: d.severity,
      message: d.message,
      ruleId: d.ruleId,
      elementId: d.elementId,
    })),
    null,
    2,
  );
}

/**
 * Format verbalizations as human-readable text.
 */
export function formatVerbalizations(verbalizations: readonly Verbalization[]): string {
  const lines: string[] = [];
  let currentFactType: string | undefined;

  for (const v of verbalizations) {
    if (v.category === "fact_type") {
      currentFactType = v.text;
      lines.push(v.text);
    } else if (v.category === "section") {
      // A heading over the rows that follow -- the constraints across
      // fact types -- which indent under it as under a fact type.
      currentFactType = v.text;
      lines.push(v.text);
    } else if (v.category === "constraint" && currentFactType) {
      lines.push(`  ${v.text}`);
    } else if (v.category === "subtype") {
      lines.push(v.text);
    } else if (v.category === "objectification") {
      lines.push(v.text);
    } else {
      lines.push(v.text);
    }
  }

  return lines.join("\n");
}

/**
 * Format counterexamples as human-readable text.
 */
export function formatCounterexamples(
  counterexamples: readonly Counterexample[],
): string {
  if (counterexamples.length === 0) return "";

  const lines = ["Counterexamples (what the constraints rule out):"];
  for (const c of counterexamples) {
    lines.push(`  ${c.text}`);
  }
  return lines.join("\n");
}

/**
 * One verbalization as the JSON output writes it. A constraint row's
 * `sourceElementId` is the constraint's id and `factTypeIds` the fact
 * types it applies to (orm-format-3, Open decision 9); an object type's
 * cardinality row names its object type with `factTypeIds: []`; other rows
 * carry no `factTypeIds`. The heading over the constraints across fact types is a
 * `section` row whose `sourceElementId` names the section, not a model
 * element; a consumer counting statements skips `section` rows (and, until
 * barwise-rsy, the Open questions heading, an `open_question` row). The one projection every JSON form of
 * `barwise verbalize` uses, so the forms cannot disagree on a field.
 */
export function verbalizationRow(v: Verbalization): {
  category: Verbalization["category"];
  text: string;
  sourceElementId: string;
  factTypeIds?: readonly string[];
} {
  return {
    category: v.category,
    text: v.text,
    sourceElementId: v.sourceElementId,
    ...(v.factTypeIds ? { factTypeIds: v.factTypeIds } : {}),
  };
}

/**
 * One counterexample as the JSON output writes it, with the id of the
 * constraint it probes when it has one. The one projection both JSON forms
 * of `barwise verbalize --counterexamples` use.
 */
export function counterexampleRow(c: Counterexample): {
  factTypeId: string;
  constraintId?: string;
  constraintType: Counterexample["constraintType"];
  text: string;
} {
  return {
    factTypeId: c.factTypeId,
    ...(c.constraintId ? { constraintId: c.constraintId } : {}),
    constraintType: c.constraintType,
    text: c.text,
  };
}

/**
 * Format verbalizations as JSON.
 */
export function formatVerbalizationsJson(verbalizations: readonly Verbalization[]): string {
  return JSON.stringify(verbalizations.map(verbalizationRow), null, 2);
}
