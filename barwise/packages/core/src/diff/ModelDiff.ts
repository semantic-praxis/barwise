/**
 * Model-level diff engine.
 *
 * Compares two OrmModels element-by-element, pairing by id first and then by
 * name (LLM re-extractions mint fresh ids). Produces a flat list of ModelDelta
 * items (added / removed / modified / unchanged) over object types, fact
 * types, and definitions, plus synonym candidates. The per-element
 * comparisons, breaking-level classification, and synonym detection live
 * in sibling modules.
 */
import { roleIdsOf, subtypeFactIdsOf } from "../model/Constraint.js";
import type { ObjectifiedFactType } from "../model/ObjectifiedFactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Population } from "../model/Population.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import { classifyBreakingLevel } from "./breakingLevel.js";
import { describeChange } from "./changeDescription.js";
import type { DeltaKind, ModelDelta, ModelDiffResult } from "./deltas.js";
import {
  constraintPairing,
  diffDefinition,
  diffFactType,
  diffObjectType,
  diffPopulation,
  diffSubtypeFact,
  factTypeName,
  instancesKey,
  pairModelConstraints,
  playerName,
  roleHolders,
} from "./elementDiff.js";
import { detectSynonymCandidates } from "./synonyms.js";

import type { DeclaredRename, ElementMatching } from "./identity.js";
export {
  type DeclaredRename,
  ELEMENT_MATCHINGS,
  type ElementMatching,
  type PairedBy,
} from "./identity.js";

/** Options for {@link diffModels}. */
export interface DiffOptions {
  /**
   * Whether the two models' ids say which elements are the same; see
   * {@link ElementMatching}. Default `"id-first"`.
   */
  readonly matching?: ElementMatching;
  /**
   * Pair the object types and fact types that ids and names left by what
   * they say, reporting each such pair as a rename (`pairedBy:
   * "recognized"`; iri-identity decision 8). Default on. Every merge path
   * turns it off: `mergeModels` refuses a recognized pair, because two
   * different elements can share a shape.
   */
  readonly recognizeRenames?: boolean;
  /**
   * Renames the caller states, for an edit that renamed an element and
   * changed it at once (`pairedBy: "declared"`). Merge refuses these too.
   */
  readonly renames?: readonly DeclaredRename[];
}

export {
  deltaLabel,
  deltaToJson,
  ELEMENT_TYPES,
  elementLabel,
  elementName,
  type ElementType,
  pairingNote,
  renamePairing,
} from "./deltas.js";
export type {
  BreakingLevel,
  ConstraintDelta,
  DefinitionDelta,
  DeltaJson,
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
 * Diff two ORM models, pairing elements by id and then by name.
 *
 * @param existing The model already on disk (reviewed/approved).
 * @param incoming The freshly extracted model from the LLM.
 * @param options How constraints are paired; id-first by default.
 * @returns A list of deltas covering every element in either model.
 */
export function diffModels(
  existing: OrmModel,
  incoming: OrmModel,
  options: DiffOptions = {},
): ModelDiffResult {
  const matching = options.matching ?? "id-first";
  const pairing = constraintPairing(existing, incoming, matching, {
    recognizeRenames: options.recognizeRenames ?? true,
    renames: options.renames ?? [],
  });
  const { identity } = pairing;
  const deltas: ModelDelta[] = [];

  // --- Object types ---
  // Paired by id first, then name (`DiffIdentity`). A paired delta is
  // labelled with the existing model's name; a rename is its `name` change.
  for (const pair of identity.objectTypes) {
    const { existing: ot, incoming: match } = pair;
    if (!ot) {
      deltas.push({
        kind: "added",
        elementType: "object_type",
        name: match.name,
        incoming: match,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", [], "object_type"),
      });
      continue;
    }
    const name = ot.name;
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
      const changes = diffObjectType(ot, match, existing, incoming, identity);
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      deltas.push({
        kind,
        elementType: "object_type",
        name,
        existing: ot,
        incoming: match,
        pairedBy: pair.pairedBy!,
        changes,
        changeDescriptions: changes.map(describeChange),
        breakingLevel: classifyBreakingLevel(kind, changes, "object_type"),
      });
    }
  }

  // --- Fact types ---
  const holders = { existing: roleHolders(existing), incoming: roleHolders(incoming) };
  for (const pair of identity.factTypes) {
    const { existing: ft, incoming: match } = pair;
    if (!ft) {
      deltas.push({
        kind: "added",
        elementType: "fact_type",
        name: match.name,
        incoming: match,
        changes: [],
        changeDescriptions: [],
        breakingLevel: classifyBreakingLevel("added", [], "fact_type"),
      });
      continue;
    }
    const name = ft.name;
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
      const changes = diffFactType(ft, match, existing, incoming, holders, pairing);
      const kind: DeltaKind = changes.length > 0 ? "modified" : "unchanged";
      deltas.push({
        kind,
        elementType: "fact_type",
        name,
        existing: ft,
        incoming: match,
        pairedBy: pair.pairedBy!,
        changes,
        changeDescriptions: changes.map(describeChange),
        breakingLevel: classifyBreakingLevel(kind, changes, "fact_type"),
      });
    }
  }

  // --- Constraints across fact types ---
  // Model order, the constraint's own model first, for naming the fact
  // types each spans.
  const incomingFirst = [...incoming.factTypes, ...existing.factTypes];
  const existingFirst = [...existing.factTypes, ...incoming.factTypes];
  for (const pair of pairModelConstraints(existing, incoming, holders, pairing)) {
    const kind: DeltaKind = !pair.existing
      ? "added"
      : !pair.incoming
      ? "removed"
      : pair.modified
      ? "modified"
      : "unchanged";
    const named = pair.incoming ?? pair.existing!;
    // Each role is read against its own model, then the other, as its key
    // is: a lenient fragment can name a role only the full model holds. Its
    // fact types are every holder of those roles, in model order (own model
    // first), which is how validation and verbalization name its span; its
    // role labels use the first holder. One lookup serves both, so the two
    // cannot disagree.
    const [order, own, other, ownModel, otherModel] = pair.incoming
      ? [incomingFirst, holders.incoming, holders.existing, incoming, existing]
      : [existingFirst, holders.existing, holders.incoming, existing, incoming];
    const roleIds = roleIdsOf(named);
    const holdersOf = (id: string) => own.get(id) ?? other.get(id) ?? [];
    const spanned = new Set(roleIds.flatMap(holdersOf));
    const changes = pair.modified && pair.existing && pair.incoming
      ? [{
        change: "constraintsModified" as const,
        constraints: [{ from: structuredClone(pair.existing), to: structuredClone(pair.incoming) }],
      }]
      : [];
    deltas.push({
      kind,
      elementType: "constraint",
      constraintType: named.type,
      // By name, once: a fragment's fact type and the full model's can share it.
      factTypes: [...new Set(order.filter((ft) => spanned.has(ft)).map((ft) => ft.name))],
      roles: [
        ...roleIds.map((id) => {
          const holder = holdersOf(id)[0];
          return holder ? `${holder.name} (${holder.getRoleById(id)!.name})` : id;
        }),
        // A constraint over subtypes names subtype facts, labelled as the
        // subtype relationship each states, read like its roles.
        ...subtypeFactIdsOf(named).map((id) => subtypeFactLabel(id, ownModel, otherModel)),
      ],
      ...(pair.existing ? { existing: pair.existing } : {}),
      ...(pair.incoming ? { incoming: pair.incoming } : {}),
      changes,
      changeDescriptions: changes.map(describeChange),
      breakingLevel: classifyBreakingLevel(kind, changes, "constraint"),
    });
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
  // No name, so the identity is the pair it relates, as `identity` keys
  // its ends: a pair by id or by name reads as one key, so a subtype
  // renamed under its kept id is no change here, and one re-extracted
  // under a fresh id still matches by name. An end read in the model
  // that does not define it is read in the other (barwise-957).
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
  const sfKey = (sf: SubtypeFact, model: OrmModel, _other: OrmModel): string =>
    `${identity.objectTypeKey(model, sf.subtypeId)}\u0000${
      identity.objectTypeKey(model, sf.supertypeId)
    }`;
  const sfRefs = (sf: SubtypeFact, model: OrmModel, other: OrmModel) => ({
    subtype: { id: sf.subtypeId, name: playerName(model, sf.subtypeId, other) },
    supertype: { id: sf.supertypeId, name: playerName(model, sf.supertypeId, other) },
  });
  // Grouped, not mapped: a lenient load can hold two subtype facts over
  // one pair, and `structural/duplicate-subtype-fact` reports them. A plain
  // map kept the second and dropped the first, so a merge wrote one and
  // the rule had nothing left to report (barwise-m9b). Within a group the
  // facts pair by id, then in order, and what is left over is removed or
  // added.
  const byPair = (model: OrmModel, other: OrmModel) => {
    const groups = new Map<string, SubtypeFact[]>();
    for (const sf of model.subtypeFacts) {
      const key = sfKey(sf, model, other);
      const group = groups.get(key);
      if (group) group.push(sf);
      else groups.set(key, [sf]);
    }
    return groups;
  };
  const existingSfs = byPair(existing, incoming);
  const incomingSfs = byPair(incoming, existing);

  const sfRemoved = (sf: SubtypeFact): ModelDelta => ({
    kind: "removed",
    elementType: "subtype_fact",
    ...sfRefs(sf, existing, incoming),
    existing: sf,
    changes: [],
    changeDescriptions: [],
    breakingLevel: classifyBreakingLevel("removed", [], "subtype_fact"),
  });
  const sfAdded = (sf: SubtypeFact): ModelDelta => ({
    kind: "added",
    elementType: "subtype_fact",
    ...sfRefs(sf, incoming, existing),
    incoming: sf,
    changes: [],
    changeDescriptions: [],
    breakingLevel: classifyBreakingLevel("added", [], "subtype_fact"),
  });

  for (const [key, group] of existingSfs) {
    const candidates = [...(incomingSfs.get(key) ?? [])];
    const take = (sf: SubtypeFact): SubtypeFact | undefined => {
      const at = candidates.findIndex((c) => c.id === sf.id);
      return at >= 0 ? candidates.splice(at, 1)[0] : undefined;
    };
    const byId = new Map(group.map((sf) => [sf, take(sf)]));
    for (const sf of group) {
      const match = byId.get(sf) ?? candidates.shift();
      if (!match) {
        deltas.push(sfRemoved(sf));
        continue;
      }
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
    for (const sf of candidates) deltas.push(sfAdded(sf));
  }

  for (const [key, group] of incomingSfs) {
    if (!existingSfs.has(key)) { for (const sf of group) deltas.push(sfAdded(sf)); }
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
  const oftKey = (oft: ObjectifiedFactType, model: OrmModel, _other: OrmModel): string =>
    `${identity.objectTypeKey(model, oft.objectTypeId)}\u0000${
      identity.factTypeKey(model, oft.factTypeId)
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
  // Identity is `(fact type key, sample)`, the key being `identity`'s,
  // so a population under a fact type renamed under its kept id stays
  // in its group; see `PopulationDelta` for why the flag is in it and
  // the description is not.
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
  // population without the fact type it belongs to, and grouping by
  // the raw id would split it from the population it should have
  // matched; `identity`'s key reads such an id in the other model.
  // The roles are read the same way -- `instancesKey` orders a tuple by
  // them, so reading them from the model that does not have the fact
  // type keys every tuple against an empty role list.
  const popFactType = (pop: Population, model: OrmModel, other: OrmModel) =>
    model.getFactType(pop.factTypeId) ?? other.getFactType(pop.factTypeId);
  const popGroup = (pop: Population, model: OrmModel, _other: OrmModel): string =>
    `${identity.factTypeKey(model, pop.factTypeId)}\u0000${pop.sample ? "sample" : "significant"}`;
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
  const synonymCandidates = detectSynonymCandidates(deltas, existing, incoming, identity);
  return { deltas, hasChanges, synonymCandidates, matching };
}

/** "Male is a Person" for a subtype fact, read against its own model first. */
function subtypeFactLabel(id: string, own: OrmModel, other: OrmModel): string {
  for (const model of [own, other]) {
    const sf = model.getSubtypeFact(id);
    if (!sf) continue;
    const name = (ot: string) => model.getObjectType(ot)?.name ?? ot;
    return `${name(sf.subtypeId)} is a ${name(sf.supertypeId)}`;
  }
  return id;
}
