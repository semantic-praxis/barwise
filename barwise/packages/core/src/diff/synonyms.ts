/**
 * Synonym-candidate detection: flags removed+added pairs that may be the
 * same concept renamed, using structural heuristics (never auto-linked).
 */
import type { OrmModel } from "../model/OrmModel.js";
import type { FactTypeDelta, ModelDelta, ObjectTypeDelta, SynonymCandidate } from "./deltas.js";
import { playerName } from "./elementDiff.js";

/**
 * Extract the reference mode suffix: the part after stripping the
 * type name prefix. For "customer_id" on type "Customer", the suffix
 * is "_id". Returns undefined if no reference mode is set.
 */
function refModeSuffix(
  refMode: string | undefined,
  typeName: string,
): string | undefined {
  if (!refMode) return undefined;
  const prefix = typeName.toLowerCase().replace(/\s+/g, "_");
  if (refMode.toLowerCase().startsWith(prefix)) {
    return refMode.slice(prefix.length);
  }
  // If the ref mode doesn't start with the type name, return the
  // whole thing -- it's still usable for comparison.
  return refMode;
}

/**
 * Compute the overlap ratio between two value constraint sets.
 * Returns 0 if either set is empty.
 */
function valueConstraintOverlap(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersect = a.filter((v) => setB.has(v)).length;
  const smaller = Math.min(a.length, b.length);
  return intersect / smaller;
}

/**
 * Scan for potential synonyms among removed + added pairs of the same
 * element type. Uses simple structural heuristics -- no fuzzy string
 * matching.
 */
export function detectSynonymCandidates(
  deltas: readonly ModelDelta[],
  existingModel: OrmModel,
  incomingModel: OrmModel,
): SynonymCandidate[] {
  const candidates: SynonymCandidate[] = [];

  // --- Phase 1: Object type pairs ---
  const removedOts: { delta: ObjectTypeDelta; index: number; }[] = [];
  const addedOts: { delta: ObjectTypeDelta; index: number; }[] = [];
  const removedFts: { delta: FactTypeDelta; index: number; }[] = [];
  const addedFts: { delta: FactTypeDelta; index: number; }[] = [];

  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i]!;
    if (d.kind === "removed" && d.elementType === "object_type") {
      removedOts.push({ delta: d as ObjectTypeDelta, index: i });
    } else if (d.kind === "added" && d.elementType === "object_type") {
      addedOts.push({ delta: d as ObjectTypeDelta, index: i });
    } else if (d.kind === "removed" && d.elementType === "fact_type") {
      removedFts.push({ delta: d as FactTypeDelta, index: i });
    } else if (d.kind === "added" && d.elementType === "fact_type") {
      addedFts.push({ delta: d as FactTypeDelta, index: i });
    }
  }

  // Build a set of OT synonym name-pairs for fact type transitive matching.
  const otSynonymPairs = new Set<string>();

  for (const removed of removedOts) {
    const rOt = removed.delta.existing!;
    for (const added of addedOts) {
      const aOt = added.delta.incoming!;

      // Gate: same kind.
      if (rOt.kind !== aOt.kind) continue;

      const reasons: string[] = [];

      // Signal 1: Alias match.
      const rAliases = new Set(rOt.aliases ?? []);
      const aAliases = new Set(aOt.aliases ?? []);
      if (aAliases.has(rOt.name) || rAliases.has(aOt.name)) {
        reasons.push("alias match: names appear in each other's aliases");
      }

      // Signal 2: Matching reference mode suffix.
      const rSuffix = refModeSuffix(rOt.referenceMode, rOt.name);
      const aSuffix = refModeSuffix(aOt.referenceMode, aOt.name);
      if (rSuffix && aSuffix && rSuffix === aSuffix) {
        reasons.push(
          `matching reference mode suffix: "${rSuffix}"`,
        );
      }

      // Signal 3: Overlapping value constraints.
      const overlap = valueConstraintOverlap(
        rOt.valueConstraint?.values,
        aOt.valueConstraint?.values,
      );
      if (overlap >= 0.5) {
        reasons.push(
          `overlapping value constraint (${Math.round(overlap * 100)}% overlap)`,
        );
      }

      // At least one signal required.
      if (reasons.length === 0) continue;

      candidates.push({
        elementType: "object_type",
        removedName: rOt.name,
        addedName: aOt.name,
        removedIndex: removed.index,
        addedIndex: added.index,
        reasons,
      });

      otSynonymPairs.add(`${rOt.name}::${aOt.name}`);
    }
  }

  // --- Phase 2: Fact type pairs ---
  for (const removed of removedFts) {
    const rFt = removed.delta.existing!;
    for (const added of addedFts) {
      const aFt = added.delta.incoming!;

      // Gate: same arity.
      if (rFt.arity !== aFt.arity) continue;

      // Check role player correspondence at each position.
      let allCorrespond = true;
      const reasons: string[] = [];
      for (let i = 0; i < rFt.arity; i++) {
        const rPlayerName = playerName(existingModel, rFt.roles[i]!.playerId);
        const aPlayerName = playerName(incomingModel, aFt.roles[i]!.playerId);
        if (rPlayerName === aPlayerName) continue;
        // Check if they are an OT synonym pair.
        if (otSynonymPairs.has(`${rPlayerName}::${aPlayerName}`)) continue;
        allCorrespond = false;
        break;
      }

      if (!allCorrespond) continue;

      reasons.push("role players correspond (directly or via synonym candidates)");

      candidates.push({
        elementType: "fact_type",
        removedName: rFt.name,
        addedName: aFt.name,
        removedIndex: removed.index,
        addedIndex: added.index,
        reasons,
      });
    }
  }

  return candidates;
}
