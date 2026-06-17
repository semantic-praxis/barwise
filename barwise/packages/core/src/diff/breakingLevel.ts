/**
 * Breaking-change classification: maps a delta's kind and change
 * descriptions to a safe / caution / breaking severity.
 */
import type { BreakingLevel, DeltaKind } from "./deltas.js";

/**
 * Classify the breaking level of a change string from a modification delta.
 * Returns the severity level for a single change description.
 */
function classifyChange(change: string): BreakingLevel {
  // Safe: definition, aliases, source context, readings, role name changes.
  if (change === "definition changed") return "safe";
  if (change === "aliases changed") return "safe";
  if (change.startsWith("source context:")) return "safe";
  if (change === "readings changed") return "safe";
  if (/^role \d+: name /.test(change)) return "safe";

  // Breaking: kind change, arity change, role player change.
  if (change.startsWith("kind:")) return "breaking";
  if (change.startsWith("arity:")) return "breaking";
  if (/^role \d+: player /.test(change)) return "breaking";

  // Caution: data type, reference mode, value constraint, constraints.
  if (
    change.startsWith("data type:") || change.startsWith("data type added")
    || change.startsWith("data type removed")
  ) return "caution";
  if (change.startsWith("reference mode:")) return "caution";
  if (change === "value constraint changed") return "caution";
  if (change.startsWith("constraints added")) return "caution";
  if (change.startsWith("constraints removed")) return "caution";

  // Unknown changes default to caution.
  return "caution";
}

/**
 * Compute the breaking level for a delta based on its kind and changes.
 * The most severe level among all changes wins.
 */
export function classifyBreakingLevel(kind: DeltaKind, changes: readonly string[]): BreakingLevel {
  if (kind === "unchanged" || kind === "added") return "safe";
  if (kind === "removed") return "breaking";

  // Modified: classify each change and take the most severe.
  let level: BreakingLevel = "safe";
  for (const change of changes) {
    const changeLevel = classifyChange(change);
    if (changeLevel === "breaking") return "breaking";
    if (changeLevel === "caution") level = "caution";
  }
  return level;
}
