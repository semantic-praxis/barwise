/**
 * Model-level diff engine.
 *
 * Compares two OrmModels element-by-element, matching by name (since LLM
 * re-extractions produce fresh UUIDs). Produces a flat list of ModelDelta
 * items (added / removed / modified / unchanged) over object types, fact
 * types, and definitions, plus synonym candidates. The per-element
 * comparisons, breaking-level classification, and synonym detection live
 * in sibling modules.
 */
import type { OrmModel } from "../model/OrmModel.js";
import { classifyBreakingLevel } from "./breakingLevel.js";
import type { DeltaKind, ModelDelta, ModelDiffResult } from "./deltas.js";
import { diffDefinition, diffFactType, diffObjectType } from "./elementDiff.js";
import { detectSynonymCandidates } from "./synonyms.js";

export type {
  BreakingLevel,
  DefinitionDelta,
  DeltaKind,
  FactTypeDelta,
  ModelDelta,
  ModelDiffResult,
  ObjectTypeDelta,
  SynonymCandidate,
} from "./deltas.js";

/**
 * Diff two ORM models, matching elements by name.
 *
 * @param existing The model already on disk (reviewed/approved).
 * @param incoming The freshly extracted model from the LLM.
 * @returns A list of deltas covering every element in either model.
 */
export function diffModels(
  existing: OrmModel,
  incoming: OrmModel,
): ModelDiffResult {
  const deltas: ModelDelta[] = [];

  // --- Object types ---
  const existingOts = new Map(existing.objectTypes.map((ot) => [ot.name, ot]));
  const incomingOts = new Map(incoming.objectTypes.map((ot) => [ot.name, ot]));

  for (const [name, ot] of existingOts) {
    const match = incomingOts.get(name);
    if (!match) {
      deltas.push({
        kind: "removed",
        elementType: "object_type",
        name,
        existing: ot,
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("removed", []),
      });
    } else {
      const changes = diffObjectType(ot, match, existing, incoming);
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      deltas.push({
        kind,
        elementType: "object_type",
        name,
        existing: ot,
        incoming: match,
        changeDescriptions: changes,
        breakingLevel: classifyBreakingLevel(kind, changes),
      });
    }
  }

  for (const [name, ot] of incomingOts) {
    if (!existingOts.has(name)) {
      deltas.push({
        kind: "added",
        elementType: "object_type",
        name,
        incoming: ot,
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", []),
      });
    }
  }

  // --- Fact types ---
  const existingFts = new Map(existing.factTypes.map((ft) => [ft.name, ft]));
  const incomingFts = new Map(incoming.factTypes.map((ft) => [ft.name, ft]));

  for (const [name, ft] of existingFts) {
    const match = incomingFts.get(name);
    if (!match) {
      deltas.push({
        kind: "removed",
        elementType: "fact_type",
        name,
        existing: ft,
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("removed", []),
      });
    } else {
      const changes = diffFactType(ft, match, existing, incoming);
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      deltas.push({
        kind,
        elementType: "fact_type",
        name,
        existing: ft,
        incoming: match,
        changeDescriptions: changes,
        breakingLevel: classifyBreakingLevel(kind, changes),
      });
    }
  }

  for (const [name, ft] of incomingFts) {
    if (!existingFts.has(name)) {
      deltas.push({
        kind: "added",
        elementType: "fact_type",
        name,
        incoming: ft,
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", []),
      });
    }
  }

  // --- Definitions ---
  const existingDefs = new Map(
    existing.definitions.map((d) => [d.term, d]),
  );
  const incomingDefs = new Map(
    incoming.definitions.map((d) => [d.term, d]),
  );

  for (const [term, def] of existingDefs) {
    const match = incomingDefs.get(term);
    if (!match) {
      deltas.push({
        kind: "removed",
        elementType: "definition",
        term,
        existing: def,
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("removed", []),
      });
    } else {
      const changes = diffDefinition(def, match);
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      deltas.push({
        kind,
        elementType: "definition",
        term,
        existing: def,
        incoming: match,
        changeDescriptions: changes,
        breakingLevel: classifyBreakingLevel(kind, changes),
      });
    }
  }

  for (const [term, def] of incomingDefs) {
    if (!existingDefs.has(term)) {
      deltas.push({
        kind: "added",
        elementType: "definition",
        term,
        incoming: def,
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", []),
      });
    }
  }

  const hasChanges = deltas.some((d) => d.kind !== "unchanged");
  const synonymCandidates = detectSynonymCandidates(
    deltas,
    existing,
    incoming,
  );
  return { deltas, hasChanges, synonymCandidates };
}
