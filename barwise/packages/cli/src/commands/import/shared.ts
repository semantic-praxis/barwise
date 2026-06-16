import { OrmYamlSerializer } from "@barwise/core";
import type { ModelDiffResult } from "@barwise/core";
import type { CandidateFraming } from "@barwise/llm";

export const serializer = new OrmYamlSerializer();
/**
 * Slugify a model name for use in output filenames.
 * Lowercase, remove dots, replace spaces/slashes with hyphens,
 * collapse consecutive hyphens.
 */
export function slugifyModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[\s/]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Render the alternative framings as a text section, or an empty string
 * when there are none.
 */
export function formatAlternativeFramings(
  alternatives: readonly CandidateFraming[] | undefined,
): string {
  if (!alternatives || alternatives.length === 0) return "";

  const lines = ["Alternative framings:"];
  for (const alt of alternatives) {
    lines.push(`- ${alt.rationale}`);
    lines.push(`  Resolves: ${alt.ambiguityDescription}`);
    lines.push(`  ${summarizeDiff(alt.diff)}`);
  }
  return lines.join("\n");
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
