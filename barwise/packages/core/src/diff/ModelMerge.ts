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

import { type FactTypeConfig, toFactTypeConfig } from "../model/FactType.js";
import { toObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import { type ObjectType, toObjectTypeConfig } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import { type PopulationConfig, toPopulationConfig } from "../model/Population.js";
import { toSubtypeFactConfig } from "../model/SubtypeFact.js";
import type { Diagnostic } from "../validation/Diagnostic.js";
import { report, RULE_ID } from "../validation/ruleId.js";
import { structuralRules } from "../validation/rules/structural.js";
import type {
  DefinitionDelta,
  FactTypeDelta,
  ModelDelta,
  ObjectifiedFactTypeDelta,
  ObjectTypeDelta,
  SubtypeFactDelta,
} from "./ModelDiff.js";

/**
 * Build a merged OrmModel from the existing model plus a set of accepted
 * delta indices.
 *
 * @param existing  The current model on disk.
 * @param incoming  The freshly extracted model (source of new content).
 * @param deltas    The full diff result.
 * @param accepted  Set of indices into `deltas` that the user accepted.
 */
export function mergeModels(
  existing: OrmModel,
  incoming: OrmModel,
  deltas: readonly ModelDelta[],
  accepted: ReadonlySet<number>,
): OrmModel {
  const merged = new OrmModel({
    name: existing.name,
    domainContext: existing.domainContext,
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
      merged.addObjectType(toObjectTypeConfig(ot));
      if (delta.incoming) {
        incomingIdToMergedId.set(delta.incoming.id, ot.id);
      }
    } else if (delta.kind === "added") {
      if (isAccepted) {
        const ot = delta.incoming!;
        merged.addObjectType(toObjectTypeConfig(ot));
        incomingIdToMergedId.set(ot.id, ot.id);
      }
      // If rejected: simply omit.
    } else if (delta.kind === "removed") {
      if (!isAccepted) {
        // Rejected removal -> keep the existing element.
        const ot = delta.existing!;
        merged.addObjectType(toObjectTypeConfig(ot));
      }
      // If accepted: omit (remove).
    } else if (delta.kind === "modified") {
      if (isAccepted) {
        // Keep existing id, take incoming content.
        // For aliases, union existing + incoming (deduplicated).
        const existingOt = delta.existing!;
        const incomingOt = delta.incoming!;
        merged.addObjectType({
          ...toObjectTypeConfig(incomingOt),
          id: existingOt.id,
          aliases: unionAliases(existingOt, incomingOt),
        });
        incomingIdToMergedId.set(incomingOt.id, existingOt.id);
      } else {
        // Rejected: keep existing as-is.
        const ot = delta.existing!;
        merged.addObjectType(toObjectTypeConfig(ot));
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
      if (delta.incoming) incomingFtIdToMergedId.set(delta.incoming.id, delta.existing!.id);
    } else if (delta.kind === "added") {
      if (isAccepted) {
        addFactTypeToMerged(merged, delta.incoming!, null, incomingIdToMergedId);
        incomingFtIdToMergedId.set(delta.incoming!.id, delta.incoming!.id);
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
      } else {
        addFactTypeToMerged(merged, delta.existing!, null, incomingIdToMergedId);
      }
      incomingFtIdToMergedId.set(delta.incoming!.id, delta.existing!.id);
    }
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

  for (const [delta, idx] of sfDeltas) {
    const isAccepted = accepted.has(idx);
    const chosen = delta.kind === "unchanged"
      ? delta.existing
      : delta.kind === "added"
      ? (isAccepted ? delta.incoming : undefined)
      : delta.kind === "removed"
      ? (isAccepted ? undefined : delta.existing)
      : (isAccepted ? delta.incoming : delta.existing);
    if (!chosen) continue;
    // Keep the existing element's id through an accepted modification,
    // as the object-type and fact-type phases do, so anything holding
    // the old id still resolves.
    // The chosen element may come from the INCOMING model, whose object
    // type ids are not the merged model's: an element matched by name
    // keeps the existing model's id. Phase 1 recorded the translation.
    const subtypeId = resolveObjectTypeId(merged, chosen.subtypeId, incomingIdToMergedId);
    const supertypeId = resolveObjectTypeId(merged, chosen.supertypeId, incomingIdToMergedId);
    if (!addableSubtypeFact(merged, subtypeId, supertypeId)) continue;
    // An accepted modification keeps the existing id so anything holding
    // it still resolves. Otherwise the element's own id -- unless the
    // merged model already holds that id, in which case reusing it would
    // silently EVICT the other one, because `_subtypeFacts` is a Map
    // keyed by id and `set` overwrites without complaint.
    const preferredId = delta.kind === "modified" && isAccepted ? delta.existing!.id : chosen.id;
    const id = merged.subtypeFacts.some((sf) => sf.id === preferredId) ? undefined : preferredId;
    merged.addSubtypeFact({ ...toSubtypeFactConfig(chosen), id, subtypeId, supertypeId });
  }

  // Phase 5: objectified fact types. After fact types AND object types,
  // since it references one of each. Its delta type forbids "modified",
  // so there is no content to choose between -- only whether it is in.
  const oftDeltas = deltas
    .map((d, i) => [d, i] as const)
    .filter(([d]) => d.elementType === "objectified_fact_type") as [
      ObjectifiedFactTypeDelta,
      number,
    ][];

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
    if (!addableObjectification(merged, objectTypeId, factTypeId)) continue;
    merged.addObjectifiedFactType({
      ...toObjectifiedFactTypeConfig(chosen),
      objectTypeId,
      factTypeId,
    });
  }

  // Phase 6: the element kinds the diff still does not model.
  carryUnmodelledElements(merged, existing, roleIdMap);

  return merged;
}

/**
 * Can the merged model hold this subtype fact?
 *
 * This mirrors every guard `OrmModel.addSubtypeFact` enforces, because
 * a throw here loses the WHOLE merge rather than one element:
 * `mergeAndValidate` catches it and returns a null model. Skipping the
 * element instead degrades one relationship; throwing degrades
 * everything.
 *
 * Both ends must exist and be entity types -- an accepted modification
 * can turn an entity into a value type. And the pair must not already
 * be present: a rejected removal and an accepted addition can resolve
 * to the SAME merged pair (a supertype rename over id-stable files does
 * exactly this), which `addSubtypeFact` rejects as a duplicate
 * relationship.
 */
function addableSubtypeFact(merged: OrmModel, subtypeId: string, supertypeId: string): boolean {
  // `SubtypeFact`'s own constructor rejects self-subtyping, and both ids
  // pass through a resolver here, so the two could in principle land on
  // one merged element even though the source model kept them apart.
  if (subtypeId === supertypeId) return false;
  if (merged.getObjectType(subtypeId)?.kind !== "entity") return false;
  if (merged.getObjectType(supertypeId)?.kind !== "entity") return false;
  return !merged.subtypeFacts.some(
    (sf) => sf.subtypeId === subtypeId && sf.supertypeId === supertypeId,
  );
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
 * rule now guards the two diffed phases above, as
 * `addableSubtypeFact` and `addableObjectification`.
 */
function carryUnmodelledElements(
  merged: OrmModel,
  existing: OrmModel,
  roleIdMap: ReadonlyMap<string, string | null>,
): void {
  for (const pop of existing.populations) {
    if (!merged.getFactType(pop.factTypeId)) continue;
    merged.addPopulation(remapPopulationRoles(toPopulationConfig(pop), roleIdMap));
  }

  // A layout references object and fact types by name rather than by
  // id, and already tolerates naming an element that is not present, so
  // it carries through whole.
  for (const layout of existing.diagramLayouts) {
    merged.addDiagramLayout(layout);
  }
}

/**
 * Can the merged model hold this objectification?
 *
 * The same reasoning as `addableSubtypeFact`, against
 * `OrmModel.addObjectifiedFactType`'s guards: the fact type and the
 * entity type must exist, and NEITHER may already take part in an
 * objectification -- one fact type is objectified by at most one entity
 * type and vice versa. A rejected removal plus an accepted addition,
 * which is the default accept-added / reject-removed policy, reaches
 * exactly that state after a fact type is renamed.
 */
function addableObjectification(
  merged: OrmModel,
  objectTypeId: string,
  factTypeId: string,
): boolean {
  // `ObjectifiedFactType`'s constructor rejects the two being equal, for
  // the same reason as above: both ids pass through a resolver.
  if (objectTypeId === factTypeId) return false;
  if (merged.getObjectType(objectTypeId)?.kind !== "entity") return false;
  if (!merged.getFactType(factTypeId)) return false;
  return !merged.objectifiedFactTypes.some(
    (oft) => oft.factTypeId === factTypeId || oft.objectTypeId === objectTypeId,
  );
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
    constraints: remapConstraintIds(source.constraints, source, merged, incomingIdToMergedId),
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
 * merged model's id space. Role ids are preserved verbatim by the merge
 * (every fact type keeps its source role ids), so role references pass
 * through. The one id space the merge does rewrite is object types --
 * matched-by-name elements keep the existing model's id -- so join
 * constraints, whose operand paths carry a root object-type id, remap
 * that root here.
 */
function remapConstraintIds(
  constraints: readonly import("../model/Constraint.js").Constraint[],
  _source: import("../model/FactType.js").FactType,
  merged: OrmModel,
  idMap: Map<string, string>,
): import("../model/Constraint.js").Constraint[] {
  return constraints.map((c) => {
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
    return c;
  });
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
 */
export function getStructuralErrors(model: OrmModel): readonly Diagnostic[] {
  return structuralRules(model).filter((d) => d.severity === "error");
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
  deltas: readonly ModelDelta[],
  accepted: ReadonlySet<number>,
): MergeValidationResult {
  let model: OrmModel;

  try {
    model = mergeModels(existing, incoming, deltas, accepted);
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
