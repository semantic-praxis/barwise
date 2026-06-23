/**
 * Output formatting helpers for the CLI.
 */

import type { Diagnostic } from "@barwise/core";
import type { Counterexample } from "@barwise/core/counterexample";
import type { Verbalization } from "@barwise/core/verbalization";

/**
 * Format diagnostics as human-readable text.
 */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
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
export function formatDiagnosticsJson(diagnostics: readonly Diagnostic[]): string {
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
 * Format verbalizations as JSON.
 */
export function formatVerbalizationsJson(verbalizations: readonly Verbalization[]): string {
  return JSON.stringify(
    verbalizations.map((v) => ({
      category: v.category,
      text: v.text,
      sourceElementId: v.sourceElementId,
    })),
    null,
    2,
  );
}
