/**
 * Shared state for the NORMA-to-ORM mapping phases.
 *
 * The mapper threads one explicit context through its phases (the same
 * shape as the dbt mapper's `DbtMapperContext`): the parsed document,
 * the model under construction, and the NORMA-id-to-Barwise-id lookup
 * maps the later phases resolve references through.
 */
import { canonicalJson, type OrmModel } from "@barwise/core";
import { cardinalityId, derivedNormaElementId, NORMA_ID_TAGS, type NormaId } from "../normaId.js";
import type { NormaConstraint, NormaDataType, NormaDocument } from "../NormaXmlTypes.js";

/**
 * Error thrown when the mapper cannot resolve references or encounters
 * structural inconsistencies in the intermediate representation.
 */
export class NormaMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormaMappingError";
  }
}

/** Mutable state shared by the mapping phases. */
export interface NormaMappingContext {
  readonly doc: NormaDocument;
  readonly model: OrmModel;
  /** NORMA object-type id -> Barwise object-type id. */
  readonly objectTypeIdMap: Map<string, string>;
  /** NORMA role id -> Barwise role id. */
  readonly roleIdMap: Map<string, string>;
  /** NORMA fact id -> Barwise fact-type id. */
  readonly factTypeIdMap: Map<string, string>;
  /** NORMA data-type id -> parsed data-type definition. */
  readonly dataTypeById: Map<string, NormaDataType>;
  /** NORMA constraint id -> parsed constraint. */
  readonly constraintById: Map<string, NormaConstraint>;
  /** Ids of constraints some fact type lists, so phase 1 already mapped them. */
  readonly processedRefs: ReadonlySet<string>;
  /** Both halves of every exclusive-or pattern, computed once. */
  readonly xorPairs: ExclusiveOrPairs;
  /** The one place a mapped constraint gets its id. */
  readonly constraintIds: ConstraintIdAllocator;
}

/**
 * Hands out the id of every constraint the mapper builds, so a NORMA
 * round trip keeps constraint identity as it keeps object type identity
 * (`docs/specs/orm-format-3.spec.md`, WS2).
 *
 * Every mapping site goes through this one object rather than spelling an
 * id itself, so these rules hold by construction:
 *
 * - **An exclusive-or maps once, under its exclusion's id.** NORMA writes
 *   one as an exclusion and a disjunctive mandatory joined by couplers; the
 *   exporter writes the barwise constraint under the exclusion's id and
 *   derives the mandatory's from it. Whichever half builds the
 *   exclusive_or, in whichever phase, claims it through `buildExclusiveOr`,
 *   which then answers every other site that the pair has its constraint.
 *   A half is only a constraint that can build the
 *   exclusive-or itself, so every half maps as one, and both phases ask
 *   the one pairing whether a constraint is a half.
 * - **A constraint the file gives no id gets one from its content**, by
 *   core's `derivedId`, never from the generator or its place in the file.
 * - **No id is handed out twice, and no NORMA id is taken from its owner.**
 *   A second constraint mapped from one NORMA constraint (a simple
 *   mandatory naming two roles, or one constraint listed in two fact
 *   types) gets `<id>_2`, `<id>_3`, ..., skipping every id the document
 *   holds -- for any element, since NORMA's ids share one space; a
 *   fallback id skips them too.
 */
export interface ConstraintIdAllocator {
  /** The id for a constraint mapped from `nc`, other than an exclusive_or. */
  claim(nc: NormaConstraint): string;
  /**
   * The id for the exclusive_or over `roleIds` mapped from `nc`, an
   * exclusive-or half -- or undefined when that constraint is already built:
   * by the other half of its pair, or by another pair over the same roles
   * and modality, which says the same thing. Model-wide, because an
   * exclusive_or is the same constraint whichever fact type holds it; a
   * deontic one beside an alethic one says something else and is kept. Every
   * site that builds an exclusive_or asks this, so none can skip a check.
   */
  buildExclusiveOr(nc: NormaConstraint, roleIds: readonly string[]): string | undefined;
  /** The id for an inline cardinality: NORMA's own, or one from its role when it has none. */
  claimCardinality(id: string, roleId: NormaId): string;
}

/**
 * Every id the parsed document holds, for any kind of element: each `id`
 * field at any depth and each field named `...Id` (the model's own, a
 * derivation note's, a subtype fact's roles). A `...Id` field that is a
 * reference names an id already collected, so taking it costs nothing.
 */
function documentIds(doc: NormaDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if ((k === "id" || k.endsWith("Id")) && typeof v === "string") {
          if (v !== "") ids.add(v);
        } else visit(v);
      }
    }
  };
  visit(doc);
  return ids;
}

export function createConstraintIdAllocator(
  doc: NormaDocument,
  pairs: ExclusiveOrPairs,
): ConstraintIdAllocator {
  // Every id the document gives any element: NORMA ids share one space, so
  // a suffix or a fallback must never take one, claimed yet or not.
  const reserved = documentIds(doc);
  const taken = new Set<string>();
  const builtPairs = new Set<string>();
  const builtRoleSets = new Set<string>();
  const roleSetKey = (nc: NormaConstraint, roleIds: readonly string[]) =>
    canonicalJson([nc.modality ?? "alethic", ...[...new Set(roleIds)].sort()]);
  // A paired mandatory takes its exclusion's id; any other half, its own.
  const pairId = (nc: NormaConstraint): string | undefined =>
    pairs.exclusionByMandatory.get(nc.id) ?? (pairs.exclusiveOrIds.has(nc.id) ? nc.id : undefined);
  // A NORMA constraint the file gives no id (the parser reads a missing
  // attribute as "") gets one derived from its content, by core's rule
  // (`derivedId`): the generator would give it a new id on every import,
  // and its place in the document would hand its id to another constraint
  // when one is inserted before it. Identical ones are told apart by suffix.
  const claimOwn = (nc: NormaConstraint): string => {
    if (nc.id === "") {
      return take(derivedNormaElementId(NORMA_ID_TAGS.constraint, [canonicalJson(nc)]), false);
    }
    return take(nc.id, true);
  };
  const take = (id: string, own: boolean): string => {
    // An owner's own id is reserved for exactly that claim; anything else
    // must be free of every claimed id and every id the document holds.
    const free = (candidate: string) =>
      !taken.has(candidate) && (own && candidate === id || !reserved.has(candidate));
    let candidate = id;
    for (let n = 2; !free(candidate); n++) candidate = `${id}_${n}`;
    taken.add(candidate);
    return candidate;
  };
  return {
    claim: claimOwn,
    buildExclusiveOr: (nc, roleIds) => {
      const id = pairId(nc);
      // Only an exclusive-or half maps to an exclusive_or; one that is not
      // means the mapper and the pairing disagree about the document.
      if (id === undefined) {
        throw new NormaMappingError(`Exclusive-or mapped from ${nc.id}, which pairs with nothing`);
      }
      const key = roleSetKey(nc, roleIds);
      if (builtPairs.has(id) || builtRoleSets.has(key)) return undefined;
      builtPairs.add(id);
      builtRoleSets.add(key);
      return take(id, true);
    },
    claimCardinality: (id, roleId) => id ? take(id, true) : take(cardinalityId(roleId), false),
  };
}

/** Both halves of every exclusive-or pattern in one document. */
export interface ExclusiveOrPairs {
  /** Every constraint that maps as an exclusive-or: a half that can build it, paired or alone. */
  readonly exclusiveOrIds: ReadonlySet<string>;
  /** The inverse of `exclusionByMandatory`: each paired exclusion's mandatory. */
  readonly mandatoryByExclusion: ReadonlyMap<string, string>;
  /** The exclusion half of each pair, by its mandatory's id: the pair's id. */
  readonly exclusionByMandatory: ReadonlyMap<string, string>;
}

/**
 * Both halves of every exclusive-or pattern, keyed from either coupler
 * direction (NORMA writes both; a hand-authored file may carry only one).
 * A half whose coupler finds no partner that can build the constraint -- a
 * deleted one, a simple or one-role mandatory, the exclusion that lost a
 * disagreement -- is still an exclusive-or half on its own: its coupler says
 * so, and its own roles say over what. It builds the constraint itself
 * rather than being skipped for a partner that never does.
 * Computed once per import and read by the constraint passes and the id
 * allocator alike, so the two cannot disagree about which constraints pair.
 *
 * When the couplers disagree -- a mandatory names one exclusion while
 * another exclusion names that mandatory -- the mandatory's own coupler
 * wins, whatever the document order.
 */
export function collectExclusiveOrPairs(
  doc: NormaDocument,
  byId: ReadonlyMap<string, NormaConstraint> = constraintsById(doc),
): ExclusiveOrPairs {
  // A mandatory can be an exclusive-or when it is not simple or implied and
  // spans two roles or more; a coupled one that cannot maps as what it is
  // and keeps its own id.
  const canBuildMandatory = (id: string) => {
    const m = byId.get(id);
    return m?.type === "mandatory" && !m.isSimple && !m.isImplied && m.roleRefs.length >= 2;
  };
  // Two halves pair when the mandatory can build the constraint and each is
  // in one pair only. The pair then maps to one exclusive_or over the
  // mandatory's roles, and its exclusion is consumed, join path or not:
  // NORMA couples only plain role sequences, and the pair says what both
  // halves mean.
  const exclusiveOrIds = new Set<string>();
  const exclusionByMandatory = new Map<string, string>();
  const mandatoryByExclusion = new Map<string, string>();
  const pair = (mandatoryId: string, exclusionId: string) => {
    if (
      !canBuildMandatory(mandatoryId) || byId.get(exclusionId)?.type !== "exclusion"
      || exclusionByMandatory.has(mandatoryId) || mandatoryByExclusion.has(exclusionId)
    ) return;
    exclusionByMandatory.set(mandatoryId, exclusionId);
    mandatoryByExclusion.set(exclusionId, mandatoryId);
    exclusiveOrIds.add(mandatoryId);
    exclusiveOrIds.add(exclusionId);
  };
  // Couplers that agree in both directions pair first, so a pair the file
  // states both ways never loses its exclusion to a one-way claim made
  // earlier in the document.
  for (const nc of doc.constraints) {
    const ref = nc.type === "mandatory" ? nc.exclusiveOrExclusionRef : undefined;
    const back = ref ? byId.get(ref) : undefined;
    if (back?.type === "exclusion" && back.exclusiveOrMandatoryRef === nc.id) pair(nc.id, ref!);
  }
  // A half with no partner builds the constraint over its own roles when it
  // can: a mandatory as above, or an exclusion over two roles or more with
  // no join path (one with a path maps as the join exclusion it is).
  for (const nc of doc.constraints) {
    if (nc.type === "mandatory" && nc.id !== "" && nc.exclusiveOrExclusionRef) {
      if (canBuildMandatory(nc.id)) exclusiveOrIds.add(nc.id);
      pair(nc.id, nc.exclusiveOrExclusionRef);
    }
  }
  for (const nc of doc.constraints) {
    if (nc.type === "exclusion" && nc.id !== "" && nc.exclusiveOrMandatoryRef) {
      const plain = !(nc.joinPaths ?? []).some((path) => path !== undefined);
      // An exclusive-or excludes single roles: two sequences or more, each
      // of one role. Pairwise sequences ([r1, r2], [r3, r4]) say something
      // else, and flattening them would build a stronger constraint.
      const singleRoles = nc.roleSequences.length >= 2
        && nc.roleSequences.every((q) => q.length === 1);
      if (plain && singleRoles) exclusiveOrIds.add(nc.id);
      pair(nc.exclusiveOrMandatoryRef, nc.id);
    }
  }
  return { exclusiveOrIds, exclusionByMandatory, mandatoryByExclusion };
}

/**
 * The document's constraints by id, the one lookup every phase and the
 * pairing resolve references through. A constraint with no id is left out:
 * a reference is an id, and keyed by "" one id-less constraint would answer
 * every empty reference in the file.
 */
export function constraintsById(doc: NormaDocument): Map<string, NormaConstraint> {
  return new Map(doc.constraints.filter((c) => c.id !== "").map((c) => [c.id, c]));
}

/**
 * Collect all constraint IDs that are referenced from some fact type's
 * InternalConstraints section (and were therefore already applied while
 * mapping that fact type).
 */
export function collectProcessedRefs(doc: NormaDocument): Set<string> {
  const refs = new Set<string>();
  for (const nft of doc.factTypes) {
    for (const ref of nft.internalConstraintRefs) {
      refs.add(ref);
    }
  }
  return refs;
}
