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
import type { ObjectifiedFactType } from "../model/ObjectifiedFactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import { classifyBreakingLevel } from "./breakingLevel.js";
import { describeChange } from "./changeDescription.js";
import type { DeltaKind, ModelDelta, ModelDiffResult } from "./deltas.js";
import {
  diffDefinition,
  diffFactType,
  diffObjectType,
  diffSubtypeFact,
  factTypeName,
  playerName,
} from "./elementDiff.js";
import { detectSynonymCandidates } from "./synonyms.js";

export { type ChangeDescription, describeChange, type RoleSummary } from "./changeDescription.js";
export {
  deltaLabel,
  ELEMENT_TYPES,
  elementLabel,
  elementName,
  type ElementType,
} from "./deltas.js";
export type {
  BreakingLevel,
  DefinitionDelta,
  DeltaKind,
  ElementRef,
  FactTypeDelta,
  ModelDelta,
  ModelDiffResult,
  ObjectifiedFactTypeDelta,
  ObjectTypeDelta,
  SubtypeFactDelta,
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
        changes: [],
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
        changes,
        changeDescriptions: changes.map(describeChange),
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
        changes: [],
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
        changes: [],
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
        changes,
        changeDescriptions: changes.map(describeChange),
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
        changes: [],
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
        changes: [],
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
        changes,
        changeDescriptions: changes.map(describeChange),
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
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", []),
      });
    }
  }

  // --- Subtype facts ---
  //
  // No name, so the identity is the pair it relates, resolved to names
  // against the model it came from -- the same reason the kinds above
  // match by name rather than by id: re-extraction mints fresh ids and
  // only names survive. A renamed subtype therefore reads as
  // removed-plus-added, exactly as a renamed object type does.
  const sfKey = (sf: SubtypeFact, model: OrmModel): string =>
    `${playerName(model, sf.subtypeId)}\u0000${playerName(model, sf.supertypeId)}`;
  const sfRefs = (sf: SubtypeFact, model: OrmModel) => ({
    subtype: { id: sf.subtypeId, name: playerName(model, sf.subtypeId) },
    supertype: { id: sf.supertypeId, name: playerName(model, sf.supertypeId) },
  });

  const existingSfs = new Map(existing.subtypeFacts.map((sf) => [sfKey(sf, existing), sf]));
  const incomingSfs = new Map(incoming.subtypeFacts.map((sf) => [sfKey(sf, incoming), sf]));

  for (const [key, sf] of existingSfs) {
    const match = incomingSfs.get(key);
    if (!match) {
      deltas.push({
        kind: "removed",
        elementType: "subtype_fact",
        ...sfRefs(sf, existing),
        existing: sf,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("removed", []),
      });
    } else {
      const changes = diffSubtypeFact(sf, match);
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      deltas.push({
        kind,
        elementType: "subtype_fact",
        ...sfRefs(sf, existing),
        existing: sf,
        incoming: match,
        changes,
        changeDescriptions: changes.map(describeChange),
        breakingLevel: classifyBreakingLevel(kind, changes),
      });
    }
  }

  for (const [key, sf] of incomingSfs) {
    if (!existingSfs.has(key)) {
      deltas.push({
        kind: "added",
        elementType: "subtype_fact",
        ...sfRefs(sf, incoming),
        incoming: sf,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", []),
      });
    }
  }

  // --- Objectified fact types ---
  //
  // Same pair-matching, and no comparer: an objectified fact type
  // carries nothing beyond the two references that made it match, so
  // two that match are equal by construction. Its delta type says so --
  // `kind` excludes "modified" -- and that is why this loop has no
  // `modified` branch to write.
  const oftKey = (oft: ObjectifiedFactType, model: OrmModel): string =>
    `${playerName(model, oft.objectTypeId)}\u0000${factTypeName(model, oft.factTypeId)}`;
  const oftRefs = (oft: ObjectifiedFactType, model: OrmModel) => ({
    objectType: { id: oft.objectTypeId, name: playerName(model, oft.objectTypeId) },
    factType: { id: oft.factTypeId, name: factTypeName(model, oft.factTypeId) },
  });

  const existingOfts = new Map(
    existing.objectifiedFactTypes.map((oft) => [oftKey(oft, existing), oft]),
  );
  const incomingOfts = new Map(
    incoming.objectifiedFactTypes.map((oft) => [oftKey(oft, incoming), oft]),
  );

  for (const [key, oft] of existingOfts) {
    const match = incomingOfts.get(key);
    deltas.push(
      match
        ? {
          kind: "unchanged",
          elementType: "objectified_fact_type",
          ...oftRefs(oft, existing),
          existing: oft,
          incoming: match,
          changes: [],
          changeDescriptions: [],
          breakingLevel: classifyBreakingLevel("unchanged", []),
        }
        : {
          kind: "removed",
          elementType: "objectified_fact_type",
          ...oftRefs(oft, existing),
          existing: oft,
          changes: [],
          changeDescriptions: [],
          breakingLevel: classifyBreakingLevel("removed", []),
        },
    );
  }

  for (const [key, oft] of incomingOfts) {
    if (!existingOfts.has(key)) {
      deltas.push({
        kind: "added",
        elementType: "objectified_fact_type",
        ...oftRefs(oft, incoming),
        incoming: oft,
        changes: [],
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
