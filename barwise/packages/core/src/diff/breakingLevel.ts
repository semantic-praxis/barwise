/**
 * Breaking-change classification: maps a delta's kind and its changes
 * to a safe / caution / breaking severity.
 *
 * The table below is total, and the compiler says so: a variant added
 * to `ChangeDescription` without a row here is a missing key in
 * `Record<ChangeKind, BreakingLevel>` and does not build. That is what
 * makes this module and `elementDiff.ts` unable to drift -- they used
 * to be joined only by the exact spelling of a sentence, and had
 * already drifted apart (barwise-946). There is no fallback: a change
 * whose level nobody decided cannot exist, rather than silently
 * reading `caution`.
 *
 * A table rather than a switch because it is also the catalogue --
 * `CHANGE_KINDS` is derived from it rather than listed again, the same
 * shape the validation rule registry uses next door.
 */
import type { ChangeDescription, ChangeKind } from "./changeDescription.js";
import type { BreakingLevel, DeltaKind } from "./deltas.js";

/**
 * How risky each kind of change is for a downstream consumer.
 *
 * Safe changes alter documentation or naming, not the shape anything
 * binds to. Breaking changes alter that shape. Caution sits between:
 * the shape survives, but which populations are legal -- or what a
 * generated schema contains -- does not.
 */
const CHANGE_LEVEL = {
  // Documentation, naming and aliasing. A standalone definition's text
  // and context are the ubiquitous-language equivalents of an object
  // type's `definition` and `sourceContext`, and read the same level as
  // them -- the pairing barwise-946 found broken.
  definition: "safe",
  definitionText: "safe",
  note: "safe",
  aliases: "safe",
  sourceContext: "safe",
  context: "safe",
  readings: "safe",
  roleName: "safe",

  // The shape a consumer binds to.
  kind: "breaking",
  arity: "breaking",
  rolePlayer: "breaking",

  // Which populations are legal, or what a generated schema carries. A
  // reference mode and a data type reach generated schemas; a value
  // constraint, a cardinality bound, an independence flag and a
  // derivation each decide which populations a model admits. A
  // derivation additionally decides what a derived fact type's
  // population contains, without changing the shape a consumer binds to
  // -- which is what would make it breaking.
  referenceMode: "caution",
  valueConstraint: "caution",
  cardinality: "caution",
  independent: "caution",
  defaultValue: "caution",
  dataTypeChanged: "caution",
  dataTypeAdded: "caution",
  dataTypeRemoved: "caution",
  constraintsAdded: "caution",
  constraintsRemoved: "caution",
  derivation: "caution",

  // A subtype fact's own fields. `isExclusive` and `isExhaustive` state
  // which populations the model admits; a defining rule decides what a
  // derived subtype contains. Neither changes the shape a consumer
  // binds to.
  subtypeExclusive: "caution",
  subtypeExhaustive: "caution",
  definingRule: "caution",

  // `providesIdentification` is the exception, and it is breaking
  // rather than caution because it reaches the relational mapping:
  // `RelationalMapper` gives the subtype's table the SUPERTYPE's
  // primary key when it is true, and its own when it is false. That is
  // the shape a consumer binds to, changing underneath them.
  providesIdentification: "breaking",
} as const satisfies Record<ChangeKind, BreakingLevel>;

/**
 * Every kind of change the diff can emit.
 *
 * Derived from the classification table rather than listed a second
 * time, so the two cannot disagree about what exists.
 */
export const CHANGE_KINDS = Object.keys(CHANGE_LEVEL) as readonly ChangeKind[];

/**
 * How risky one change is for a downstream consumer.
 *
 * The table is total, so the fallback is unreachable for any change
 * this build produced. It is there for one a build did not: a delta
 * that crossed a version boundary as JSON can carry a kind this
 * `CHANGE_LEVEL` has never heard of, and an unknown key would otherwise
 * yield `undefined` -- which `classifyBreakingLevel` reads as neither
 * breaking nor caution, and so reports as `safe`. Understating risk is
 * the one direction this function must not fail in, and `caution` is
 * what the string matcher returned for an unrecognised change before
 * the union existed.
 */
export function classifyChange(change: ChangeDescription): BreakingLevel {
  return CHANGE_LEVEL[change.change] ?? "caution";
}

/**
 * Compute the breaking level for a delta based on its kind and changes.
 * The most severe level among all changes wins.
 */
export function classifyBreakingLevel(
  kind: DeltaKind,
  changes: readonly ChangeDescription[],
): BreakingLevel {
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
