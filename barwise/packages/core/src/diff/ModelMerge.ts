/**
 * Model merge: applies a set of accepted deltas to an existing model.
 *
 * Design principles:
 * - Accepted "added" elements use the incoming element as-is.
 * - Accepted "modified" elements keep the existing UUID but take the
 *   incoming element's content, so downstream references stay valid.
 * - Accepted "removed" elements are omitted from the output.
 * - Rejected deltas leave the existing element unchanged.
 * - "unchanged" deltas always keep the existing element.
 * - Element kinds the diff does not model are carried through from the
 *   existing model, minus any whose referent the merge removed.
 *
 * Returns a freshly constructed OrmModel (no mutation of inputs).
 */

import {
  type ExternalConstraint,
  isExternalUniqueness,
  isInternalUniqueness,
  isOverSubtypes,
  roleIdsOf,
  subtypeFactIdsOf,
  withoutSubtypeFacts,
} from "../model/Constraint.js";

/** Marks a subtype fact the merge left out, for `withoutSubtypeFacts`. */
const LEFT_OUT = "\u0000left-out";
import { withoutDiagramReferences } from "../model/DiagramLayout.js";
import { type FactTypeConfig, toFactTypeConfig } from "../model/FactType.js";
import { graphOf } from "../model/graph.js";
import { toObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { ObjectType } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import { type PopulationConfig, toPopulationConfig } from "../model/Population.js";
import { type SubtypeFact, subtypePairKey, toSubtypeFactConfig } from "../model/SubtypeFact.js";
import { derivedId, MERGE_ID_TAG } from "../serialization/derivedId.js";
import { groupRepeats } from "../util/groupRepeats.js";
import type { Diagnostic } from "../validation/Diagnostic.js";
import { referenceDiagnostics } from "../validation/referenceDiagnostics.js";
import { report, RULE_ID } from "../validation/ruleId.js";
import { structuralRules, structuralWellFormedness } from "../validation/rules/structural.js";
import { type DeltaKind, elementName, type ModelDiffResult, renamePairing } from "./deltas.js";
import { isDanglingFactType, isDanglingPlayer } from "./elementDiff.js";
import type {
  ConstraintDelta,
  DefinitionDelta,
  DiffOptions,
  FactTypeDelta,
  ModelDelta,
  ObjectifiedFactTypeDelta,
  ObjectTypeDelta,
  PopulationDelta,
  SubtypeFactDelta,
} from "./ModelDiff.js";

/**
 * What a merge reads of a diff: its deltas, and the matching it ran with.
 * The whole result rather than the bare deltas, so a merge can see how the
 * diff paired its elements and refuse a pairing that is not evidence two
 * elements are one (iri-identity 6a).
 */
export type MergeInput = Pick<ModelDiffResult, "deltas" | "matching">;

/**
 * The options every diff that feeds a merge passes: ids and names only,
 * no pairing by content. One constant, so the merge paths (`barwise
 * merge`, transcript import on the CLI and in the editor, MCP
 * `merge_models`) cannot come to diff differently, and so a reader sees
 * why: `mergeModels` refuses a recognized pair.
 */
export const MERGE_DIFF_OPTIONS = { recognizeRenames: false } as const satisfies DiffOptions;

/**
 * Build a merged OrmModel from the existing model plus a set of accepted
 * delta indices.
 *
 * @param existing  The current model on disk.
 * @param incoming  The freshly extracted model (source of new content).
 * @param diff      The diff of `existing` against `incoming`.
 * @param accepted  Set of indices into `diff.deltas` that the user accepted.
 * @throws when the diff matched by content or holds a rename pairing
 *   ({@link refuseUnmergeablePairing}), or two kept elements share a name.
 */
export function mergeModels(
  existing: OrmModel,
  incoming: OrmModel,
  diff: MergeInput,
  accepted: ReadonlySet<number>,
): OrmModel {
  refuseUnmergeablePairing(diff);
  const deltas = diff.deltas;
  refuseNameClashes(deltas, accepted);
  const merged = new OrmModel({
    name: existing.name,
    domainContext: existing.domainContext,
    namespace: existing.namespace,
    // The note was dropped for as long as this function has existed:
    // the merge names the fields it carries, so a field nobody listed
    // is a field nobody keeps (barwise-937).
    note: existing.note,
  });

  // We need to build a mapping from incoming object type ids to the ids
  // that will be used in the merged model. This is necessary because
  // fact type roles reference object type ids, and when we accept an
  // "added" object type from the incoming model, its id becomes the
  // canonical one. When we keep an existing object type (unchanged or
  // rejected modification), its id is the canonical one.
  const incomingIdToMergedId = new Map<string, string>();

  // The same translation for fact types, which the objectification
  // phase needs: an objectified fact type references one, and a fact
  // type matched by name keeps the existing model's id.
  const incomingFtIdToMergedId = new Map<string, string>();

  // And for ROLE ids, in the incoming direction. A population keys its
  // instances by role id, so a population arriving from the incoming
  // model names roles the merged model may not have: every fact type
  // keeps its SOURCE role ids, and the merge picks the source per delta.
  // `roleIdMap` below is the mirror of this for populations carried from
  // `existing`.
  const incomingRoleIdToMergedId = new Map<string, string | null>();

  // Role ids the merge rewrote, existing -> merged, or -> null where the
  // role is gone. Populations are carried from `existing` and key their
  // instances by role id, so a fact type that took the incoming model's
  // roles leaves its population pointing at ids nothing answers to
  // (barwise-941). Only an accepted modification rewrites roles; every
  // other outcome keeps the existing fact type and needs no entry.
  const roleIdMap = new Map<string, string | null>();

  // Phase 1: object types (must be added before fact types).
  const otDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "object_type") as [ObjectTypeDelta, number][];

  for (const [delta, idx] of otDeltas) {
    const isAccepted = accepted.has(idx);

    if (delta.kind === "unchanged") {
      // Always keep.
      const ot = delta.existing!;
      merged.addObjectType(ot);
      if (delta.incoming) {
        incomingIdToMergedId.set(delta.incoming.id, ot.id);
      }
    } else if (delta.kind === "added") {
      if (isAccepted) {
        const ot = delta.incoming!;
        merged.addObjectType(ot);
        incomingIdToMergedId.set(ot.id, ot.id);
      }
      // If rejected: simply omit.
    } else if (delta.kind === "removed") {
      if (!isAccepted) {
        // Rejected removal -> keep the existing element.
        const ot = delta.existing!;
        merged.addObjectType(ot);
      }
      // If accepted: omit (remove).
    } else if (delta.kind === "modified") {
      if (isAccepted) {
        // Keep existing id, take incoming content.
        // For aliases, union existing + incoming (deduplicated).
        const existingOt = delta.existing!;
        const incomingOt = delta.incoming!;
        merged.addObjectType({
          ...incomingOt,
          id: existingOt.id,
          aliases: unionAliases(existingOt, incomingOt),
        });
        incomingIdToMergedId.set(incomingOt.id, existingOt.id);
      } else {
        // Rejected: keep existing as-is.
        const ot = delta.existing!;
        merged.addObjectType(ot);
        if (delta.incoming) {
          incomingIdToMergedId.set(delta.incoming.id, ot.id);
        }
      }
    }
  }

  // Phase 2: fact types.
  const ftDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "fact_type") as [FactTypeDelta, number][];

  for (const [delta, idx] of ftDeltas) {
    const isAccepted = accepted.has(idx);

    if (delta.kind === "unchanged") {
      addFactTypeToMerged(merged, delta.existing!, null, incomingIdToMergedId);
      if (delta.incoming) {
        incomingFtIdToMergedId.set(delta.incoming.id, delta.existing!.id);
        // Merged took the EXISTING roles, so an incoming population's
        // keys must be translated to them.
        recordIncomingRoleRemap(incomingRoleIdToMergedId, delta.incoming, delta.existing!);
      }
    } else if (delta.kind === "added") {
      if (isAccepted) {
        addFactTypeToMerged(merged, delta.incoming!, null, incomingIdToMergedId);
        incomingFtIdToMergedId.set(delta.incoming!.id, delta.incoming!.id);
        // Merged took the incoming roles verbatim; no translation needed.
      }
    } else if (delta.kind === "removed") {
      if (!isAccepted) {
        addFactTypeToMerged(merged, delta.existing!, null, incomingIdToMergedId);
      }
    } else if (delta.kind === "modified") {
      if (isAccepted) {
        // Keep existing id, take incoming content.
        addFactTypeToMerged(
          merged,
          delta.incoming!,
          delta.existing!.id,
          incomingIdToMergedId,
        );
        recordRoleRemap(roleIdMap, delta.existing!, delta.incoming!);
        // Merged took the INCOMING roles, so they need no translation.
      } else {
        addFactTypeToMerged(merged, delta.existing!, null, incomingIdToMergedId);
        recordIncomingRoleRemap(incomingRoleIdToMergedId, delta.incoming!, delta.existing!);
      }
      incomingFtIdToMergedId.set(delta.incoming!.id, delta.existing!.id);
    }
  }

  // Phase 2b: constraints across fact types (orm-format-3 WS3c). After
  // fact types, because each names their roles, and the role ids it
  // carries are its source model's: an existing constraint goes through
  // `roleIdMap` where a fact type took the incoming roles, an incoming
  // one through `incomingRoleIdToMergedId` where a fact type kept the
  // existing ones.
  const constraintDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "constraint") as [ConstraintDelta, number][];

  const roleIds = (m: OrmModel) => m.factTypes.flatMap((ft) => ft.roles.map((r) => r.id));
  const mergedRoles = new Set(roleIds(merged));
  const sourceRoles = new Set([...roleIds(existing), ...roleIds(incoming)]);
  // In order of preference: an accepted modification whose incoming
  // version names a role the merge took falls back to the existing one,
  // which the reviewer did not ask to remove.
  const candidatesOf = (delta: ConstraintDelta, isAccepted: boolean) =>
    delta.kind === "unchanged"
      ? [delta.existing]
      : delta.kind === "added"
      ? (isAccepted ? [delta.incoming] : [])
      : delta.kind === "removed"
      ? (isAccepted ? [] : [delta.existing])
      : (isAccepted ? [delta.incoming, delta.existing] : [delta.existing]);
  // The first candidate the merge can place, or none.
  const placeConstraint = (delta: ConstraintDelta, isAccepted: boolean): void => {
    for (const chosen of candidatesOf(delta, isAccepted)) {
      if (!chosen) continue;
      const placed = isOverSubtypes(chosen)
        ? overMergedSubtypeFacts(chosen, chosen === delta.incoming)
        : overMergedRoles(chosen, chosen === delta.incoming);
      if (!placed) continue;
      // A modification is paired by id, so either side carries the existing id.
      merged.addConstraint(placed);
      return;
    }
  };
  const overMergedRoles = (
    chosen: ExternalConstraint,
    fromIncoming: boolean,
  ): ExternalConstraint | undefined => {
    const remapped = remapConstraintIds(
      [mapRoleIds(chosen, fromIncoming ? incomingRoleIdToMergedId : roleIdMap)],
      merged,
      incomingIdToMergedId,
    )[0] as ExternalConstraint;
    // A role the merged model does not hold, where one of the two models
    // did, was taken by the merge itself: a rejected fact type addition
    // or an accepted removal. The constraint goes with it, as a
    // population does, rather than surviving with a dangling role. A
    // role neither model ever held is the file's own dangling reference
    // and is carried through, so validation reports it.
    const lost = roleIdsOf(remapped).some((id) => !mergedRoles.has(id) && sourceRoles.has(id));
    return lost ? undefined : remapped;
  };
  // Each subtype fact maps to the merged one with the same two ends, read in
  // the constraint's own model first and then the other, as a role's
  // source spans both. One the merge left out (a rejected addition, an
  // accepted removal) leaves of the constraint what still holds without it,
  // as `removeSubtypeFact` does; one neither model held is carried through
  // for validation to report.
  // Each source subtype fact the merge placed, to the id it took there,
  // and each one the decision left out. Filled by phase 4; read by phase
  // 4b, which runs after it.
  const mergedIdOf = new Map<SubtypeFact, string>();
  const decidedOut = new Set<SubtypeFact>();
  const overMergedSubtypeFacts = (
    chosen: ExternalConstraint,
    fromIncoming: boolean,
  ): ExternalConstraint | undefined => {
    const ids: string[] = [];
    for (const id of subtypeFactIdsOf(chosen)) {
      const own = (fromIncoming ? incoming : existing).getSubtypeFact(id);
      const inIncoming = own ? fromIncoming : !fromIncoming;
      const source = own ?? (fromIncoming ? existing : incoming).getSubtypeFact(id);
      if (!source) {
        ids.push(id);
        continue;
      }
      const subtypeId = inIncoming
        ? resolveObjectTypeId(merged, source.subtypeId, incomingIdToMergedId)
        : source.subtypeId;
      const supertypeId = inIncoming
        ? resolveObjectTypeId(merged, source.supertypeId, incomingIdToMergedId)
        : source.supertypeId;
      const pair = subtypePairKey({ subtypeId, supertypeId });
      // The fact phase 4 placed for this one first, under whatever id it
      // took (its own, or one `mergedId` derived): with two over one pair
      // carried (barwise-m9b), the first by pair would retarget a
      // constraint naming the second.
      // One the decision left out is left out: the fact holding its pair
      // is at most a sibling repeat, and pointing at it named that sibling
      // twice (from the pr-review of #740). The pair fallback is for a fact
      // kept but refused as a repeat the merge itself would create.
      const placedAs = mergedIdOf.get(source);
      const same = placedAs === undefined ? undefined : merged.getSubtypeFact(placedAs);
      const kept = same && subtypePairKey(same) === pair
        ? same
        : decidedOut.has(source)
        ? undefined
        : merged.subtypeFacts.find((sf) => subtypePairKey(sf) === pair);
      ids.push(kept?.id ?? LEFT_OUT);
    }
    return withoutSubtypeFacts(
      { ...chosen, subtypeFactIds: ids } as ExternalConstraint,
      (id) => id === LEFT_OUT,
    );
  };
  // A delta with a constraint over subtype facts on either side waits for
  // phase 4, which settles the merged subtype facts and their ids
  // (orm-format-3 WS4b); either side may be the one placed.
  const overSubtypes: [ConstraintDelta, number][] = [];
  for (const [delta, idx] of constraintDeltas) {
    if ([delta.existing, delta.incoming].some((c) => c && isOverSubtypes(c))) {
      overSubtypes.push([delta, idx]);
      continue;
    }
    placeConstraint(delta, accepted.has(idx));
  }

  // Phase 3: definitions.
  const defDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "definition") as [DefinitionDelta, number][];

  for (const [delta, idx] of defDeltas) {
    const isAccepted = accepted.has(idx);

    if (delta.kind === "unchanged") {
      merged.addDefinition(delta.existing!);
    } else if (delta.kind === "added") {
      if (isAccepted) merged.addDefinition(delta.incoming!);
    } else if (delta.kind === "removed") {
      if (!isAccepted) merged.addDefinition(delta.existing!);
    } else if (delta.kind === "modified") {
      merged.addDefinition(isAccepted ? delta.incoming! : delta.existing!);
    }
  }

  // Phase 4: subtype facts. After object types, because both ends must
  // exist in `merged` before a subtype fact can reference them.
  const sfDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "subtype_fact") as [SubtypeFactDelta, number][];

  // The other side of each paired delta: a repeat from one model may sit
  // beside the fact the diff paired with its sibling from the other.
  const partner = new Map<SubtypeFact, SubtypeFact>();
  for (const [d] of sfDeltas) {
    if (d.existing && d.incoming) {
      partner.set(d.existing, d.incoming);
      partner.set(d.incoming, d.existing);
    }
  }
  // Which source fact each merged subtype fact came from, so a repeated
  // pair is carried only beside its own sibling.
  const placedFrom = new Map<string, SubtypeFact>();
  const place = (id: string, fact: SubtypeFact) => {
    placedFrom.set(id, fact);
    mergedIdOf.set(fact, id);
    // The placement stands for both sides of its delta, so a constraint
    // from the side not placed (an existing constraint naming the existing
    // fact, whose incoming modification was accepted) still finds it.
    const mate = partner.get(fact);
    if (mate !== undefined) mergedIdOf.set(mate, id);
  };
  for (const [delta, idx] of sfDeltas) {
    const isAccepted = accepted.has(idx);
    const chosen = keptSide(delta, isAccepted);
    if (!chosen) {
      // An accepted removal or a rejected addition: one side, left out.
      decidedOut.add((delta.existing ?? delta.incoming)!);
      continue;
    }
    const source = chosen === delta.incoming ? incoming : existing;
    // The chosen element may come from the INCOMING model, whose object
    // type ids are not the merged model's: an element matched by name
    // keeps the existing model's id. Phase 1 recorded the translation.
    const subtypeId = resolveObjectTypeId(merged, chosen.subtypeId, incomingIdToMergedId);
    const supertypeId = resolveObjectTypeId(merged, chosen.supertypeId, incomingIdToMergedId);
    // An accepted modification keeps the existing id so anything holding
    // it still resolves, as the object-type and fact-type phases do.
    // Otherwise the element's own id, or a derived one where the merged
    // model holds it (`mergedId`).
    const preferredId = delta.kind === "modified" && isAccepted ? delta.existing!.id : chosen.id;
    const id = mergedId("subtype-fact", preferredId, (x) => merged.getSubtypeFact(x) !== undefined);
    const config = { ...toSubtypeFactConfig(chosen), id, subtypeId, supertypeId };
    // Asked before adding because a throw loses the WHOLE merge rather than
    // one element (`mergeAndValidate` returns a null model). An accepted
    // modification can turn an end into a value type, and a rejected
    // removal plus an accepted addition can resolve to a pair already held.
    if (merged.canAddSubtypeFact({ subtypeId, supertypeId })) {
      place(merged.addSubtypeFact(config).id, chosen);
      continue;
    }
    // The same split the population phase makes below: an accepted
    // removal took the endpoint and the drop is the decision; a
    // reference NEITHER model ever defined is a dangling reference,
    // and deleting it here would delete the evidence before
    // `structural/subtype-dangling-*` could report it (barwise-997).
    if (
      isDanglingPlayer(existing, incoming, chosen.subtypeId)
      || isDanglingPlayer(existing, incoming, chosen.supertypeId)
    ) {
      place(merged.addSubtypeFact(config, { skipPlayerValidation: true }).id, chosen);
      continue;
    }
    // A pair its own model already repeated (a lenient load) is carried
    // too, so `structural/duplicate-subtype-fact` still reports it; dropping
    // one is what left nothing to report (barwise-m9b). Only when the pair
    // is the sole refusal and the fact holding it is this one's sibling in
    // its own model, or the fact the diff paired with that sibling: a
    // value-type end, a self pair, or a repeat the merge itself creates is
    // still dropped.
    if (isSiblingRepeat(source, chosen, subtypeId, supertypeId)) {
      const placed = merged.addSubtypeFact(config, { skipPlayerValidation: true });
      place(placed.id, chosen);
    }
  }
  function isSiblingRepeat(
    source: OrmModel,
    fact: SubtypeFact,
    subtypeId: string,
    supertypeId: string,
  ): boolean {
    // No check on the ends here: the holder was placed only after
    // `canAddSubtypeFact` passed for this same pair, so its ends are
    // entities and differ. A value-type end or a self pair has no holder
    // and is dropped below.
    const pair = subtypePairKey({ subtypeId, supertypeId });
    const holder = merged.subtypeFacts.find((sf) => subtypePairKey(sf) === pair);
    const origin = holder && placedFrom.get(holder.id);
    if (origin === undefined) return false;
    // A sibling in this fact's own model, or in its partner's: an accepted
    // modification brings the incoming side, whose model may no longer
    // repeat the pair while the existing side's model still does, and the
    // holder is then the existing sibling (barwise-m9b, from the retroactive
    // review of #733).
    const siblingsOf = (model: OrmModel, f: SubtypeFact) =>
      model.subtypeFacts.filter((s) => s !== f && subtypePairKey(s) === subtypePairKey(f));
    const mate = partner.get(fact);
    const other = source === existing ? incoming : existing;
    const siblings = [
      ...siblingsOf(source, fact),
      ...(mate === undefined ? [] : siblingsOf(other, mate)),
    ];
    return siblings.some((sibling) => sibling === origin || partner.get(sibling) === origin);
  }

  // Phase 4b: constraints over subtype facts, now that the merged model
  // holds its subtype facts.
  for (const [delta, idx] of overSubtypes) placeConstraint(delta, accepted.has(idx));

  // Phase 5: objectified fact types. After fact types AND object types,
  // since it references one of each. Its delta type forbids "modified",
  // so there is no content to choose between -- only whether it is in.
  const oftDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "objectified_fact_type") as [
      ObjectifiedFactTypeDelta,
      number,
    ][];

  const objectificationId = (id: string) =>
    mergedId("objectification", id, (x) => merged.getObjectifiedFactType(x) !== undefined);
  for (const [delta, idx] of oftDeltas) {
    const isAccepted = accepted.has(idx);
    const chosen = delta.kind === "unchanged"
      ? delta.existing
      : delta.kind === "added"
      ? (isAccepted ? delta.incoming : undefined)
      : (isAccepted ? undefined : delta.existing);
    if (!chosen) continue;
    const objectTypeId = resolveObjectTypeId(merged, chosen.objectTypeId, incomingIdToMergedId);
    const factTypeId = resolveFactTypeId(merged, chosen.factTypeId, incomingFtIdToMergedId);
    if (!merged.canAddObjectifiedFactType({ objectTypeId, factTypeId })) {
      // As above. The guard also refuses a pair whose
      // halves are already objectified, which is a real conflict the
      // merge resolves silently and deliberately; only the dangling
      // case is carried through to be reported.
      const dangling = isDanglingPlayer(existing, incoming, chosen.objectTypeId)
        || isDanglingFactType(existing, incoming, chosen.factTypeId);
      if (!dangling) continue;
      merged.addObjectifiedFactType(
        {
          ...toObjectifiedFactTypeConfig(chosen),
          id: objectificationId(chosen.id),
          objectTypeId,
          factTypeId,
        },
        { skipPlayerValidation: true },
      );
      continue;
    }
    // Its own id, or a derived one where the merged model holds it, as
    // for subtype facts and populations (`mergedId`).
    merged.addObjectifiedFactType({
      ...toObjectifiedFactTypeConfig(chosen),
      id: objectificationId(chosen.id),
      objectTypeId,
      factTypeId,
    });
  }

  const holdsPopulation = (x: string) => merged.getPopulation(x) !== undefined;
  // Phase 6: populations. After fact types, because a population
  // references one and keys its instances by that fact type's role ids.
  const popDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "population") as [PopulationDelta, number][];

  for (const [delta, idx] of popDeltas) {
    const isAccepted = accepted.has(idx);
    const chosen = keptSide(delta, isAccepted);
    if (!chosen) continue;

    // Which model it came from decides both translations: an incoming
    // population names the incoming model's fact type and role ids, an
    // existing one names the existing model's.
    const fromIncoming = chosen === delta.incoming;
    const factTypeId = fromIncoming
      ? resolveFactTypeId(merged, chosen.factTypeId, incomingFtIdToMergedId)
      : chosen.factTypeId;

    // Two different reasons the merged model may not hold this fact
    // type, and only one of them is the merge doing what it was asked.
    //
    // An ACCEPTED REMOVAL took it: dropping what depended on it is the
    // decision the reviewer made, and it stays silent.
    //
    // NEITHER MODEL EVER DEFINED IT: a fragment naming `ft-typo`. That
    // is a dangling reference, and dropping it is how `barwise merge`
    // came to exit 0 with a population gone and nothing said
    // (barwise-997). It reached here because PR #487 widened the
    // lenient load to populations so the VALIDATOR could report such a
    // reference -- and then the merge deleted the evidence before the
    // validator ran.
    //
    // So the element is carried through with its reference intact, and
    // `population/dangling-fact-type` reports it: an error-severity
    // rule that already exists, already runs in `getStructuralErrors`,
    // and already says exactly this. `mergeAndValidate` therefore
    // returns isValid: false and the caller refuses to write. Inventing
    // a second diagnostic here would have said the same thing twice,
    // in a channel only this function knows about.
    if (!merged.getFactType(factTypeId)) {
      if (!isDanglingFactType(existing, incoming, chosen.factTypeId)) continue;
      merged.addPopulation(
        {
          ...remapPopulationRoles(
            toPopulationConfig(chosen),
            fromIncoming ? incomingRoleIdToMergedId : roleIdMap,
          ),
          id: mergedId("population", chosen.id, holdsPopulation),
          factTypeId,
        },
        { skipPlayerValidation: true },
      );
      continue;
    }

    const preferredId = delta.kind === "modified" && isAccepted ? delta.existing!.id : chosen.id;
    const id = mergedId("population", preferredId, holdsPopulation);
    merged.addPopulation({
      ...remapPopulationRoles(
        toPopulationConfig(chosen),
        fromIncoming ? incomingRoleIdToMergedId : roleIdMap,
      ),
      id,
      factTypeId,
    });
  }

  // Phase 6b: preferred identifiers, now that every constraint is placed.
  // Each entity takes its reference from the side the reviewer kept: a
  // changed identifier is part of the entity's modification, accepted or
  // rejected with it, not a second reference. The merged fact type may
  // hold the other side's copy of that uniqueness, under the other side's
  // id (an LLM extraction shares no ids with its base), so a reference the
  // merged model lacks is followed to the uniqueness over the same roles.
  // One whose constraint the merge left out goes, so the merged model
  // names nothing it lacks.
  for (const [delta, idx] of otDeltas) {
    const takeIncoming = (delta.kind === "added" || delta.kind === "modified")
      && accepted.has(idx);
    const source = takeIncoming ? delta.incoming : delta.existing;
    if (!source) continue;
    const entityId = takeIncoming && delta.kind === "added"
      ? incomingIdToMergedId.get(source.id) ?? source.id
      : (delta.existing ?? source).id;
    const side = takeIncoming ? incoming : existing;
    const ref = side.preferredIdentifierOf(source.id);
    if (ref === undefined || merged.getObjectType(entityId)?.kind !== "entity") continue;
    const held = merged.getConstraint(ref)
      ? ref
      : sameUniquenessIn(merged, side, ref, takeIncoming ? incomingRoleIdToMergedId : roleIdMap);
    if (held !== undefined) merged.setPreferredIdentifier(entityId, held);
  }

  // Phase 7: the one kind the diff deliberately does not model.
  carryUnmodelledElements(merged, existing);

  return merged;
}

/**
 * The id of the merged model's uniqueness of the same kind over the roles
 * that `constraintId` covers in `side`, its role ids translated through
 * `roleMap` (an id with no entry is unchanged): an internal one in a fact
 * type, an external one among the model's constraints, since either can be
 * a preferred identifier (external-preferred-identifier.spec.md).
 * Undefined when the constraint is not a uniqueness, a role did not
 * survive the merge, or no uniqueness covers exactly those roles.
 */
function sameUniquenessIn(
  merged: OrmModel,
  side: OrmModel,
  constraintId: string,
  roleMap: ReadonlyMap<string, string | null>,
): string | undefined {
  const c = side.getConstraint(constraintId);
  if (!c || (!isInternalUniqueness(c) && !isExternalUniqueness(c))) return undefined;
  const roles = c.roleIds.map((r) => (roleMap.has(r) ? roleMap.get(r)! : r));
  if (roles.some((r) => r === null)) return undefined;
  // Compared as sorted lists, so a role repeated on one side is not read
  // as the same uniqueness, and with the modality, as the diff's label is.
  const key = (ids: readonly (string | null)[]) => [...ids].sort().join("\u0000");
  const wanted = key(roles);
  const sameKind = isInternalUniqueness(c) ? isInternalUniqueness : isExternalUniqueness;
  const candidates = isInternalUniqueness(c)
    ? merged.factTypes.flatMap((ft) => ft.internalConstraints)
    : merged.constraints;
  for (const u of candidates) {
    if (
      sameKind(u) && key(u.roleIds) === wanted
      && (u.modality ?? "alethic") === (c.modality ?? "alethic")
    ) {
      return u.id;
    }
  }
  return undefined;
}

/**
 * Carry populations and diagram layouts from the existing model into
 * the merged one.
 *
 * `diffModels` emits deltas for three element kinds -- object types,
 * fact types, definitions -- and `mergeModels` builds a fresh
 * `OrmModel` from those deltas alone, so every other kind used to be
 * absent from the result of every merge. A model with one subtype fact
 * and one population, diffed against itself and merged with nothing
 * accepted, came back with neither, and every caller of
 * `mergeAndValidate` wrote that loss to disk: `barwise merge`, `barwise
 * import transcript`, the MCP merge tool and the VS Code import command
 * (barwise-937).
 *
 * Two of the four kinds it used to carry are gone: subtype facts and
 * objectified fact types are diffed and merged from deltas now, so an
 * incoming model's new ones arrive when a reviewer accepts them (WS2 of
 * `docs/specs/typed-diff-all-element-kinds.spec.md`).
 *
 * Populations are WS3 and are still carried. Diagram layouts are
 * carried DELIBERATELY and permanently, which is the resolved decision
 * in that spec rather than work outstanding: a layout is only ever
 * written by a human -- the VS Code diagram panel, a named view, the
 * NORMA importer -- and `@barwise/llm` never writes one, so a
 * re-extracted incoming model has none. Diffing them would emit a
 * `removed` delta for every layout on every import, and a reviewer
 * accepting all deltas would delete their whole arrangement.
 *
 * The one thing not carried is an element the merged model cannot
 * hold -- a population whose fact type was removed. Re-adding it would
 * throw inside `OrmModel`, and a throw here loses the whole merge
 * rather than one element: `mergeAndValidate` catches it and returns a
 * null model. An accepted removal is a decision to remove, so dropping
 * what depended on it is the merge doing what the user asked. The same
 * rule now guards the two diffed phases above, through
 * `OrmModel.canAddSubtypeFact` and `canAddObjectifiedFactType`.
 */
function carryUnmodelledElements(merged: OrmModel, existing: OrmModel): void {
  // A layout references elements by id, and every element the merge keeps
  // from `existing` keeps its id -- a rename included -- so the layout
  // carries through. The one loss is an element an accepted removal took
  // out: its id is dropped here, as `OrmModel.removeObjectType` would.
  // Only those ids. A reference that was already dangling in `existing` --
  // a 1.x name the 2.0 migration kept on purpose, a hand edit -- is not
  // the merge's to delete; validation reports it.
  const inModel = (m: OrmModel, id: string) =>
    m.getObjectType(id) !== undefined || m.getFactType(id) !== undefined;
  const removed = (id: string) => inModel(existing, id) && !inModel(merged, id);
  for (const layout of existing.diagramLayouts) {
    merged.addDiagramLayout(withoutDiagramReferences(layout, removed));
  }
}

/**
 * Record how an accepted fact-type modification moved its roles, so a
 * carried population can follow them.
 *
 * The pairing is positional, and deliberately the same pairing
 * `diffFactType` used to decide there was a modification at all: it
 * compares roles by index and reports "role 2: player X -> Y", which is
 * a statement that incoming role 2 corresponds to existing role 2.
 * Matching any other way here (by name, by player) would contradict the
 * correspondence the delta the user just accepted was computed under.
 *
 * A role with no counterpart -- the incoming fact type has lower arity
 * -- maps to null, and its values are dropped rather than left pointing
 * at an id no role answers to. The reverse case needs no entry: a role
 * the incoming model added has no existing values, so instances come
 * out short and the validator says so, which is honest. That is a
 * genuine incompleteness in the data, not an artefact of id churn.
 */
function recordRoleRemap(
  roleIdMap: Map<string, string | null>,
  existingFt: import("../model/FactType.js").FactType,
  incomingFt: import("../model/FactType.js").FactType,
): void {
  for (let i = 0; i < existingFt.roles.length; i++) {
    const from = existingFt.roles[i]!.id;
    const to = incomingFt.roles[i]?.id ?? null;
    if (from !== to) roleIdMap.set(from, to);
  }
}

/**
 * Record how an incoming fact type's roles correspond to the ones the
 * merged model actually took.
 *
 * The mirror of `recordRoleRemap`, and positional for the same reason:
 * `diffFactType` compares roles by index, so index correspondence is
 * the pairing the delta the user accepted was computed under. Matching
 * any other way here would contradict it.
 *
 * A role the incoming fact type has and the merged one does not maps to
 * null, so an incoming population's values for it are dropped rather
 * than left keyed by an id nothing answers to.
 */
function recordIncomingRoleRemap(
  map: Map<string, string | null>,
  incomingFt: import("../model/FactType.js").FactType,
  mergedFt: import("../model/FactType.js").FactType,
): void {
  for (let i = 0; i < incomingFt.roles.length; i++) {
    const from = incomingFt.roles[i]!.id;
    const to = mergedFt.roles[i]?.id ?? null;
    if (from !== to) map.set(from, to);
  }
}

/**
 * Rewrite a carried population's instance keys through the role remap.
 * An unmapped key belongs to a fact type the merge did not rewrite and
 * passes through; a key mapped to null lost its role and is dropped.
 */
function remapPopulationRoles(
  config: PopulationConfig,
  roleIdMap: ReadonlyMap<string, string | null>,
): PopulationConfig {
  if (roleIdMap.size === 0 || !config.instances) return config;
  return {
    ...config,
    instances: config.instances.map((inst) => ({
      ...inst,
      roleValues: Object.fromEntries(
        Object.entries(inst.roleValues)
          .map(([roleId, value]) => {
            // Three cases, and `??` cannot tell the first two apart --
            // `null ?? roleId` is `roleId`, which silently kept a
            // dropped role's value under its dead id.
            const mapped = roleIdMap.get(roleId);
            const key = mapped === undefined ? roleId : mapped;
            return [key, value] as const;
          })
          .filter((entry): entry is readonly [string, string] => entry[0] !== null),
      ),
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The id a merged subtype fact, objectification or population takes: the
 * one it prefers, or, where the merged store already holds that, one
 * derived from the kind, the preferred id and an attempt number.
 *
 * The id is the caller's because the store refuses a held one
 * (`DuplicateIdError`), which would lose the whole merge. It used to be
 * left to the installed generator, so merging the same two models twice
 * gave those elements different ids, against the rule that core is
 * deterministic (barwise-yg5). Derived from what the merge already has,
 * it is the same every time. The attempt number walks past every id the
 * merged store already holds: a third element preferring the same id, and
 * an element that kept a derived id from an earlier merge whose output is
 * being merged again.
 */
function mergedId(
  kind: "subtype-fact" | "objectification" | "population",
  preferred: string,
  holds: (id: string) => boolean,
): string {
  if (!holds(preferred)) return preferred;
  for (let attempt = 1;; attempt++) {
    const id = derivedId(`${MERGE_ID_TAG}.${kind}`, [preferred, String(attempt)]);
    if (!holds(id)) return id;
  }
}

/**
 * Refuse a diff a merge cannot trust, before anything is built.
 *
 * Two cases, one reason: each pairs elements on evidence that two
 * different elements can share. A `matching: "content"` diff pairs object
 * types and fact types by name alone, ids saying nothing (sample
 * comparison). A rename the diff recognized by content, or that its caller
 * declared, pairs two elements of one shape -- a transcript's new
 * `Supplier` beside the base's `Vendor` -- and accepting it would fold
 * them into one (decision 8). The whole diff is refused, not only the
 * accepted deltas, because a pairing also decides what every reference to
 * the element means. Before, a comment was the only guard.
 */
function refuseUnmergeablePairing(diff: MergeInput): void {
  if (diff.matching === "content") {
    throw new Error(
      'Cannot merge a diff built with matching: "content": its ids say nothing, so its '
        + 'pairs are not evidence. Diff with matching: "id-first" to merge.',
    );
  }
  const paired = diff.deltas.filter((d) => renamePairing(d) !== undefined);
  if (paired.length > 0) {
    const names = paired.map((d) => `"${elementName(d)}"`);
    throw new Error(
      `Cannot merge a diff that pairs elements as renames (${names.join(", ")}): two `
        + "different elements can share a shape. Diff with recognizeRenames: false and "
        + "no declared renames to merge.",
    );
  }
}

/**
 * Refuse a merge that would give two object types, or two fact types, one
 * name, before anything is built.
 *
 * The diff pairs a shared id as one element (model invariants, decision
 * 1), so an accepted addition cannot collide with an id the merge keeps;
 * what is left is a NAME clash: two elements that exchanged names under
 * kept ids, with one rename accepted and the other not. Which one should
 * win is not the merge's call, so it names both and stops, and
 * `mergeAndValidate` reports it as `merge-error`. Before, `addObjectType`
 * threw a bare "already exists" halfway through the build, naming one.
 *
 * A content-matching diff never reaches this point:
 * `refuseUnmergeablePairing` refuses it first, so nothing here guards an
 * id that diff's name pass left unpaired.
 */
function refuseNameClashes(deltas: readonly ModelDelta[], accepted: ReadonlySet<number>): void {
  const kept = deltas.flatMap((d, i) => {
    if (d.elementType !== "object_type" && d.elementType !== "fact_type") return [];
    const side = keptSide<{ readonly id: string; readonly name: string; }>(d, accepted.has(i));
    if (!side) return [];
    // The id the merged element will carry: an accepted modification
    // keeps the existing one, which is the id the user can find.
    const id = d.existing?.id ?? side.id;
    const why = d.kind === "modified" && side === d.incoming
      ? `renamed from ${JSON.stringify(d.existing!.name)}`
      : d.kind === "removed"
      ? "removed by the incoming model, kept because the removal was not accepted"
      : d.kind === "added"
      ? "added"
      : d.kind === "modified"
      ? `kept, the rename to ${JSON.stringify(d.incoming!.name)} not accepted`
      : "unchanged";
    return [{ kind: d.elementType, name: side.name, label: `${id} (${why})` }];
  });
  const clashes = [...groupRepeats(kept, (k) => `${k.kind} ${k.name}`).values()];
  if (clashes.length === 0) return;
  const lines = clashes.map((group) =>
    `${group[0]!.kind.replace("_", " ")} ${JSON.stringify(group[0]!.name)}: `
    + group.map((k) => k.label).join(", ")
  );
  throw new Error(
    `two elements would take one name: ${lines.join("; ")}. `
      + "Accept or reject the changes that share a name together, "
      + "or rename one of them in the base model first.",
  );
}

/**
 * Which side of a delta the merged model keeps, or none: the one rule
 * every phase that takes an element whole applies, and that
 * `refuseNameClashes` reads ahead of them.
 */
function keptSide<T>(
  delta: { readonly kind: DeltaKind; readonly existing?: T; readonly incoming?: T; },
  isAccepted: boolean,
): T | undefined {
  return delta.kind === "unchanged"
    ? delta.existing
    : delta.kind === "added"
    ? (isAccepted ? delta.incoming : undefined)
    : delta.kind === "removed"
    ? (isAccepted ? undefined : delta.existing)
    : (isAccepted ? delta.incoming : delta.existing);
}

/**
 * Add a fact type to the merged model, remapping role player ids
 * from the source model (existing or incoming) to the merged model's ids.
 */
function addFactTypeToMerged(
  merged: OrmModel,
  source: import("../model/FactType.js").FactType,
  overrideId: string | null,
  incomingIdToMergedId: Map<string, string>,
): void {
  // The projection is the only place a role's fields are listed; this
  // overrides the one it means to change (barwise-927 review).
  const projected = toFactTypeConfig(source);
  const config: FactTypeConfig = {
    ...projected,
    id: overrideId ?? source.id,
    roles: projected.roles.map((r) => ({
      ...r,
      playerId: resolvePlayerId(merged, r.playerId, incomingIdToMergedId, source),
    })),
    constraints: remapConstraintIds(source.internalConstraints, merged, incomingIdToMergedId),
  };

  merged.addFactType(config);
}

/**
 * Resolve a player id to its merged-model equivalent.
 *
 * Tries (in order):
 * 1. The id already exists in the merged model -> use as-is (existing element).
 * 2. The id maps via incomingIdToMergedId -> use the mapped id.
 * 3. Try to find by name in the merged model (fallback for edge cases).
 */
function resolvePlayerId(
  merged: OrmModel,
  playerId: string,
  incomingIdToMergedId: Map<string, string>,
  _sourceFt: import("../model/FactType.js").FactType,
): string {
  return resolveObjectTypeId(merged, playerId, incomingIdToMergedId);
}

/**
 * Resolve an object type id from either model's id space into the
 * merged model's.
 *
 * An element matched by name keeps the EXISTING model's id, so an
 * incoming element's reference points at an id the merged model does
 * not have. Phase 1 records the translation; this applies it. Shared by
 * the fact-type roles and the subtype-fact and objectification phases,
 * which all reference object types and would otherwise each carry the
 * same three cases.
 */
function resolveObjectTypeId(
  merged: OrmModel,
  id: string,
  incomingIdToMergedId: ReadonlyMap<string, string>,
): string {
  // Direct hit in merged model.
  if (merged.getObjectType(id)) return id;

  // Mapped from incoming.
  const mapped = incomingIdToMergedId.get(id);
  if (mapped && merged.getObjectType(mapped)) return mapped;

  // This shouldn't normally happen, but return the original id to let
  // the model's own validation surface a clear error.
  return id;
}

/** The same translation for fact type ids, recorded by phase 2. */
function resolveFactTypeId(
  merged: OrmModel,
  id: string,
  incomingFtIdToMergedId: ReadonlyMap<string, string>,
): string {
  if (merged.getFactType(id)) return id;
  const mapped = incomingFtIdToMergedId.get(id);
  if (mapped && merged.getFactType(mapped)) return mapped;
  return id;
}

/**
 * Remap ids inside constraints from the source model's id space to the
 * merged model's id space, for object types: matched-by-name elements
 * keep the existing model's id, so join constraints, whose operand paths
 * carry a root object-type id, remap that root here. Role ids are the
 * caller's: a fact type keeps its source role ids, so its own constraints
 * pass through, and phase 2b translates a constraint across fact types
 * first (`mapRoleIds`), since its roles may come from another source.
 */
function remapConstraintIds<C extends import("../model/Constraint.js").Constraint>(
  constraints: readonly C[],
  merged: OrmModel,
  idMap: Map<string, string>,
): C[] {
  return constraints.map((c): C => {
    if (c.type === "join_subset") {
      return {
        ...c,
        subset: remapJoinOperand(c.subset, merged, idMap),
        superset: remapJoinOperand(c.superset, merged, idMap),
      };
    }
    if (c.type === "join_equality" || c.type === "join_exclusion") {
      return {
        ...c,
        operands: c.operands.map((o) => remapJoinOperand(o, merged, idMap)),
      };
    }
    if (c.type === "join_ring") {
      return { ...c, operand: remapJoinOperand(c.operand, merged, idMap) };
    }
    return c;
  });
}

/**
 * Rewrite every role id a constraint names through a role remap, in
 * whatever field its kind keeps them (join paths included): the walk is
 * over the constraint's values rather than a list of its fields, so a
 * kind added later is covered. A role mapped to null keeps its id, and
 * the caller's role check decides what that means. Only role ids are
 * keys of the map, so no other string can match.
 */
function mapRoleIds<C extends import("../model/Constraint.js").Constraint>(
  constraint: C,
  roleIdMap: ReadonlyMap<string, string | null>,
): C {
  if (roleIdMap.size === 0) return constraint;
  const walk = (value: unknown, key: string | undefined): unknown => {
    if (typeof value === "string") {
      if (key === "id" || key === "type" || key === "modality") return value;
      const mapped = roleIdMap.get(value);
      return mapped === undefined || mapped === null ? value : mapped;
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    }
    return value;
  };
  return walk(constraint, undefined) as C;
}

/**
 * Remap a join operand's path root to its merged-model equivalent, using
 * the same resolution order as role players: an id already present in
 * the merged model wins, then the incoming-to-merged map.
 */
function remapJoinOperand(
  operand: import("../model/Constraint.js").JoinOperand,
  merged: OrmModel,
  idMap: Map<string, string>,
): import("../model/Constraint.js").JoinOperand {
  const root = operand.path.root;
  if (merged.getObjectType(root)) return operand;

  const mapped = idMap.get(root);
  if (mapped && merged.getObjectType(mapped)) {
    return { ...operand, path: { ...operand.path, root: mapped } };
  }
  return operand;
}

/**
 * Union aliases from existing and incoming object types, deduplicating.
 * Returns undefined if neither has aliases.
 */
function unionAliases(
  existing: ObjectType,
  incoming: ObjectType,
): readonly string[] | undefined {
  const existingAliases = existing.aliases ?? [];
  const incomingAliases = incoming.aliases ?? [];

  if (existingAliases.length === 0 && incomingAliases.length === 0) {
    return undefined;
  }

  const combined = new Set([...existingAliases, ...incomingAliases]);
  return [...combined];
}

// ---------------------------------------------------------------------------
// Post-merge validation
// ---------------------------------------------------------------------------

export interface MergeValidationResult {
  /** The merged model, or null if the merge threw an error. */
  readonly model: OrmModel | null;
  /** Structural diagnostics found in the merged model. Empty if valid. */
  readonly diagnostics: readonly Diagnostic[];
  /** True when the merged model has no structural errors. */
  readonly isValid: boolean;
}

/**
 * Run structural validation on a merged model, returning only errors.
 *
 * This runs the structural rules (dangling role references, duplicate
 * names, broken subtype/objectification references, subtype cycles)
 * but NOT completeness warnings or constraint consistency checks.
 * A merged model that is structurally valid is safe to write to disk.
 *
 * The merge path is the one place in the repository that routinely
 * holds a model with unresolvable references -- `merge` loads its
 * incoming model with `lenient: true` precisely so it can diff a broken
 * file. So this cannot assume the graph builds: when it does not, the
 * unresolved references ARE the structural errors, reported under the
 * same rule ids `structuralRules` used before those checks moved into
 * `graphOf`.
 */
export function getStructuralErrors(model: OrmModel): readonly Diagnostic[] {
  const result = graphOf(model);
  const diagnostics = [
    // Duplicate names and the subtype-cycle walk read no reference, so a
    // merge that produced BOTH a dangling id and a duplicate name still
    // reports both. Dropping the second half here is exactly the loss
    // barwise-978 names, and on this path it would let a duplicate name
    // reach disk.
    ...structuralWellFormedness(model),
    ...(result.ok
      ? structuralRules(model, result.graph)
      : referenceDiagnostics(model, result.unresolved)),
  ];
  return diagnostics.filter((d) => d.severity === "error");
}

/**
 * Merge two models and validate the result in a single call.
 *
 * If `mergeModels()` throws (e.g. due to a dangling player reference
 * that OrmModel.addFactType rejects), the error is captured as a
 * diagnostic rather than propagating as an exception.
 *
 * If `mergeModels()` succeeds, structural validation runs on the
 * result to catch subtler issues (broken subtype facts, broken
 * objectification references, etc.).
 */
export function mergeAndValidate(
  existing: OrmModel,
  incoming: OrmModel,
  diff: MergeInput,
  accepted: ReadonlySet<number>,
): MergeValidationResult {
  let model: OrmModel;

  try {
    model = mergeModels(existing, incoming, diff, accepted);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      model: null,
      diagnostics: [
        report(RULE_ID.mergeError, "default", "", message),
      ],
      isValid: false,
    };
  }

  const diagnostics = getStructuralErrors(model);
  return {
    model,
    diagnostics,
    isValid: diagnostics.length === 0,
  };
}
