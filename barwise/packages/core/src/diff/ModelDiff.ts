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
import type { Population } from "../model/Population.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import { classifyBreakingLevel } from "./breakingLevel.js";
import { describeChange } from "./changeDescription.js";
import type { DeltaKind, ModelDelta, ModelDiffResult } from "./deltas.js";
import {
  diffDefinition,
  diffFactType,
  diffObjectType,
  diffPopulation,
  diffSubtypeFact,
  factTypeName,
  instancesKey,
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
  NamedElementType,
  ObjectifiedFactTypeDelta,
  ObjectTypeDelta,
  PopulationDelta,
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
        breakingLevel: classifyBreakingLevel("removed", [], "object_type"),
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
        breakingLevel: classifyBreakingLevel(kind, changes, "object_type"),
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
        breakingLevel: classifyBreakingLevel("added", [], "object_type"),
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
        breakingLevel: classifyBreakingLevel("removed", [], "fact_type"),
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
        breakingLevel: classifyBreakingLevel(kind, changes, "fact_type"),
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
        breakingLevel: classifyBreakingLevel("added", [], "fact_type"),
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
        breakingLevel: classifyBreakingLevel("removed", [], "definition"),
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
        breakingLevel: classifyBreakingLevel(kind, changes, "definition"),
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
        breakingLevel: classifyBreakingLevel("added", [], "definition"),
      });
    }
  }

  // --- Subtype facts ---
  //
  // No name, so the identity is the pair it relates, resolved to names
  // against the model it came from and then against the other -- the
  // same reason the kinds above match by name rather than by id:
  // re-extraction mints fresh ids and only names survive. A renamed
  // subtype therefore reads as removed-plus-added, exactly as a renamed
  // object type does.
  //
  // The pair whose endpoints NEITHER model defines IS reported, and
  // this is a correction to the rule that shipped here in barwise-957.
  //
  // That rule skipped it, on the ground that "such an element cannot
  // exist in any merged model". The premise is false. `OrmModel` holds
  // it under `skipPlayerValidation` -- which is precisely how the
  // lenient load put it in the incoming model in the first place -- and
  // `structural/subtype-dangling-subtype` and its supertype twin report
  // it at error severity, through `getStructuralErrors`, which is what
  // `mergeAndValidate` already runs.
  //
  // So skipping it was not sparing the reviewer a false choice; it was
  // deleting the evidence of a dangling reference before anything could
  // report it (barwise-997, established on the population case and the
  // same here). The delta's label may name an id no reader recognises,
  // which is the cost, and an error they must resolve is worth more
  // than a silent loss.
  const sfKey = (sf: SubtypeFact, model: OrmModel, other: OrmModel): string =>
    `${playerName(model, sf.subtypeId, other)}\u0000${playerName(model, sf.supertypeId, other)}`;
  const sfRefs = (sf: SubtypeFact, model: OrmModel, other: OrmModel) => ({
    subtype: { id: sf.subtypeId, name: playerName(model, sf.subtypeId, other) },
    supertype: { id: sf.supertypeId, name: playerName(model, sf.supertypeId, other) },
  });
  const existingSfs = new Map(
    existing.subtypeFacts.map((sf) => [sfKey(sf, existing, incoming), sf]),
  );
  const incomingSfs = new Map(
    incoming.subtypeFacts.map((sf) => [sfKey(sf, incoming, existing), sf]),
  );

  for (const [key, sf] of existingSfs) {
    const match = incomingSfs.get(key);
    if (!match) {
      deltas.push({
        kind: "removed",
        elementType: "subtype_fact",
        ...sfRefs(sf, existing, incoming),
        existing: sf,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("removed", [], "subtype_fact"),
      });
    } else {
      const changes = diffSubtypeFact(sf, match);
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      deltas.push({
        kind,
        elementType: "subtype_fact",
        ...sfRefs(sf, existing, incoming),
        existing: sf,
        incoming: match,
        changes,
        changeDescriptions: changes.map(describeChange),
        breakingLevel: classifyBreakingLevel(kind, changes, "subtype_fact"),
      });
    }
  }

  for (const [key, sf] of incomingSfs) {
    if (!existingSfs.has(key)) {
      deltas.push({
        kind: "added",
        elementType: "subtype_fact",
        ...sfRefs(sf, incoming, existing),
        incoming: sf,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", [], "subtype_fact"),
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
  //
  // The unresolvable pair is REPORTED here for the reason it is
  // reported above, and the correction is the same one.
  const oftKey = (oft: ObjectifiedFactType, model: OrmModel, other: OrmModel): string =>
    `${playerName(model, oft.objectTypeId, other)}\u0000${
      factTypeName(model, oft.factTypeId, other)
    }`;
  const oftRefs = (oft: ObjectifiedFactType, model: OrmModel, other: OrmModel) => ({
    objectType: { id: oft.objectTypeId, name: playerName(model, oft.objectTypeId, other) },
    factType: { id: oft.factTypeId, name: factTypeName(model, oft.factTypeId, other) },
  });
  const existingOfts = new Map(
    existing.objectifiedFactTypes.map((oft) => [oftKey(oft, existing, incoming), oft]),
  );
  const incomingOfts = new Map(
    incoming.objectifiedFactTypes.map((oft) => [oftKey(oft, incoming, existing), oft]),
  );

  for (const [key, oft] of existingOfts) {
    const match = incomingOfts.get(key);
    deltas.push(
      match
        ? {
          kind: "unchanged",
          elementType: "objectified_fact_type",
          ...oftRefs(oft, existing, incoming),
          existing: oft,
          incoming: match,
          changes: [],
          changeDescriptions: [],
          breakingLevel: classifyBreakingLevel("unchanged", [], "objectified_fact_type"),
        }
        : {
          kind: "removed",
          elementType: "objectified_fact_type",
          ...oftRefs(oft, existing, incoming),
          existing: oft,
          changes: [],
          changeDescriptions: [],
          breakingLevel: classifyBreakingLevel("removed", [], "objectified_fact_type"),
        },
    );
  }

  for (const [key, oft] of incomingOfts) {
    if (!existingOfts.has(key)) {
      deltas.push({
        kind: "added",
        elementType: "objectified_fact_type",
        ...oftRefs(oft, incoming, existing),
        incoming: oft,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", [], "objectified_fact_type"),
      });
    }
  }

  // --- Populations ---
  //
  // Identity is `(fact type name, sample)`; see `PopulationDelta` for
  // why the flag is in it and the description is not.
  //
  // Within a group the metamodel permits several -- nothing limits a
  // fact type to one population -- and they have no identity of their
  // own. So a group is matched in two passes: by tuple content first,
  // then whatever is left over pairwise in declaration order.
  //
  // Content first, because position alone is unsound and the merge
  // identity law is not what catches it. Deleting the FIRST of two
  // significant populations shifts the second into its slot, so the
  // diff reported the survivor as a modification of the deleted one
  // plus a removal of itself -- and the default accept-added-and-
  // modified, reject-removed policy every surface uses then wrote both,
  // producing two populations with identical tuples where the incoming
  // model had one. Content matching pins the survivor to itself and
  // leaves the deletion as a plain removal.
  //
  // Leftovers pair positionally, because content matching alone breaks
  // the ordinary case: a single population whose tuples were edited
  // matches nothing by content and would read as remove-plus-add rather
  // than as the modification it is.
  //
  // A population's fact type is resolved against both models for the
  // reason the pair-matched kinds are: a lenient fragment can carry a
  // population without the fact type it belongs to, and grouping by a
  // UUID would split it from the population it should have matched.
  // The roles are read the same way -- `instancesKey` orders a tuple by
  // them, so reading them from the model that does not have the fact
  // type keys every tuple against an empty role list.
  const popFactType = (pop: Population, model: OrmModel, other: OrmModel) =>
    model.getFactType(pop.factTypeId) ?? other.getFactType(pop.factTypeId);
  const popGroup = (pop: Population, model: OrmModel, other: OrmModel): string =>
    `${factTypeName(model, pop.factTypeId, other)}\u0000${pop.sample ? "sample" : "significant"}`;
  const popRef = (pop: Population, model: OrmModel, other: OrmModel) => ({
    factType: { id: pop.factTypeId, name: factTypeName(model, pop.factTypeId, other) },
    sample: pop.sample,
  });
  const popTuples = (pop: Population, model: OrmModel, other: OrmModel): string =>
    instancesKey(pop, popFactType(pop, model, other)?.roles ?? []);

  const groups = new Map<string, { existing: Population[]; incoming: Population[]; }>();
  const group = (key: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { existing: [], incoming: [] };
      groups.set(key, g);
    }
    return g;
  };
  for (const pop of existing.populations) {
    group(popGroup(pop, existing, incoming)).existing.push(pop);
  }
  for (const pop of incoming.populations) {
    group(popGroup(pop, incoming, existing)).incoming.push(pop);
  }

  // Deltas are collected per group but EMITTED in the order the models
  // declare their populations. Grouping is a matching device; letting it
  // decide output order would reorder the merged model's populations,
  // and `hashModel` serializes them in order -- so an identity merge
  // would change the model's hash without changing the model.
  const byExisting = new Map<Population, ModelDelta>();
  const addedPops = new Map<Population, ModelDelta>();

  for (const { existing: mine, incoming: theirs } of groups.values()) {
    const pairs: Array<[Population, Population]> = [];
    const tookMine = new Set<number>();
    const tookTheirs = new Set<number>();

    // Pass 1: identical tuples, first-with-first.
    //
    // Both loops run FORWARD, which matters when several populations in
    // a group have the same tuples -- two empty ones, say. Scanning one
    // side backwards and the other forwards cross-pairs them, so two
    // populations that differ only in their descriptions each report the
    // other's description as a change. The accept-all law found exactly
    // that: two empty sample populations, one described and one not.
    for (let i = 0; i < mine.length; i++) {
      const key = popTuples(mine[i]!, existing, incoming);
      for (let j = 0; j < theirs.length; j++) {
        if (tookTheirs.has(j) || popTuples(theirs[j]!, incoming, existing) !== key) continue;
        pairs.push([mine[i]!, theirs[j]!]);
        tookMine.add(i);
        tookTheirs.add(j);
        break;
      }
    }
    // Pass 2: whatever is left, in declaration order.
    const unmatchedMine = mine.filter((_, i) => !tookMine.has(i));
    const unmatchedTheirs = theirs.filter((_, j) => !tookTheirs.has(j));
    while (unmatchedMine.length > 0 && unmatchedTheirs.length > 0) {
      pairs.push([unmatchedMine.shift()!, unmatchedTheirs.shift()!]);
    }

    for (const [mineOne, theirsOne] of pairs) {
      const changes = diffPopulation(
        mineOne,
        theirsOne,
        popFactType(mineOne, existing, incoming)?.roles ?? [],
        popFactType(theirsOne, incoming, existing)?.roles ?? [],
      );
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      byExisting.set(mineOne, {
        kind,
        elementType: "population",
        ...popRef(mineOne, existing, incoming),
        existing: mineOne,
        incoming: theirsOne,
        changes,
        changeDescriptions: changes.map(describeChange),
        breakingLevel: classifyBreakingLevel(kind, changes, "population"),
      });
    }
    for (const pop of unmatchedMine) {
      byExisting.set(pop, {
        kind: "removed",
        elementType: "population",
        ...popRef(pop, existing, incoming),
        existing: pop,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("removed", [], "population"),
      });
    }
    for (const pop of unmatchedTheirs) {
      addedPops.set(pop, {
        kind: "added",
        elementType: "population",
        ...popRef(pop, incoming, existing),
        incoming: pop,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", [], "population"),
      });
    }
  }

  for (const pop of existing.populations) {
    const d = byExisting.get(pop);
    if (d) deltas.push(d);
  }
  for (const pop of incoming.populations) {
    const d = addedPops.get(pop);
    if (d) deltas.push(d);
  }

  const hasChanges = deltas.some((d) => d.kind !== "unchanged");
  const synonymCandidates = detectSynonymCandidates(
    deltas,
    existing,
    incoming,
  );
  return { deltas, hasChanges, synonymCandidates };
}
