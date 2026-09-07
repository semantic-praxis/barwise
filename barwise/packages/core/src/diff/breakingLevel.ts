/**
 * Breaking-change classification: maps a delta's kind and change
 * descriptions to a safe / caution / breaking severity.
 */
import type { BreakingLevel, DeltaKind } from "./deltas.js";

/**
 * Classify one change description, or return undefined when the string
 * is not one this module knows.
 *
 * Separating "unrecognized" from "deliberately caution" is what makes
 * the drift between this module and `elementDiff.ts` testable at all:
 * both used to be the literal `"caution"`, so a description nobody had
 * classified was indistinguishable from one classified as caution on
 * purpose, and four of them were silently taking the fallback
 * (barwise-946). `classifyBreakingLevel` still applies caution as the
 * default, so behaviour is unchanged for any string that remains
 * unknown. Exported for the drift test; not re-exported from
 * `diff/index.ts`, so it stays internal to the package.
 */
export function classifyKnownChange(change: string): BreakingLevel | undefined {
  // Safe: definition, note, aliases, source context, readings, role names.
  if (change === "definition changed") return "safe";
  if (change === "note changed") return "safe";
  if (change === "aliases changed") return "safe";
  if (change.startsWith("source context:")) return "safe";
  if (change === "readings changed") return "safe";
  if (/^role \d+: name /.test(change)) return "safe";
  // A standalone definition's text and its bounded context are the
  // ubiquitous-language entries' equivalents of an object type's
  // `definition` and `sourceContext`, which are safe above. They read
  // `caution` until now only because the classifier knew the object
  // type's spelling and not this one -- the drift barwise-946 names.
  if (change === "definition text changed") return "safe";
  if (change.startsWith("context:")) return "safe";

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
  // Independence changes which populations are legal; a default value
  // reaches generated schemas. Both land on caution explicitly rather than
  // through the fallback below, so the intent is readable (barwise-934).
  if (change.startsWith("independent:")) return "caution";
  if (change.startsWith("default value:")) return "caution";
  if (change.startsWith("constraints added")) return "caution";
  if (change.startsWith("constraints removed")) return "caution";
  // Both were reaching the caution fallback, so the verdict is
  // unchanged and only the intent is new. A cardinality bound and a
  // derivation rule each decide which populations are legal, which is
  // the reason `value constraint changed` and `independent:` are
  // caution rather than safe; a derivation additionally decides what a
  // derived fact type's population contains, without changing the
  // shape a consumer binds to, which is what would make it breaking.
  if (change === "cardinality changed") return "caution";
  if (change === "derivation changed") return "caution";

  return undefined;
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
    // Unknown descriptions default to caution, as they always have.
    const changeLevel = classifyKnownChange(change) ?? "caution";
    if (changeLevel === "breaking") return "breaking";
    if (changeLevel === "caution") level = "caution";
  }
  return level;
}
