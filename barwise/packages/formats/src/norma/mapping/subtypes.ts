/**
 * Phases 4 and 5 of the NORMA mapping: subtype facts and objectification.
 *
 * Subtype partitions (exclusive/exhaustive) are resolved from the
 * exclusion / disjunctive-mandatory constraints NORMA places on the
 * supertype meta-roles; objectified types are linked to their nested
 * fact types once both exist.
 */
import { type FlaggedSubtypeFact, subtypeConstraintsFromFlags } from "@barwise/core";
import { derivedNormaElementId, NORMA_ID_TAGS } from "../normaId.js";
import type { NormaDocument } from "../NormaXmlTypes.js";
import { type NormaMappingContext, NormaMappingError } from "./context.js";

/** Create subtype facts with partition properties (phase 4). */
export function mapSubtypeFacts(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap } = ctx;

  // Determine subtype partition properties (exclusive/exhaustive) by
  // scanning for exclusion and disjunctive mandatory constraints on
  // SupertypeMetaRoles. These must be resolved before creating SubtypeFacts
  // because the properties are immutable.
  const subtypePartition = resolveSubtypePartitions(doc);
  // The partitions as flags, converted to constraints over the subtype
  // facts once every subtype fact exists (orm-format-3 WS4b).
  const flagged: FlaggedSubtypeFact[] = [];

  for (const sf of doc.subtypeFacts) {
    const subtypeId = objectTypeIdMap.get(sf.subtypePlayerRef);
    const supertypeId = objectTypeIdMap.get(sf.supertypePlayerRef);

    if (!subtypeId) {
      throw new NormaMappingError(
        `SubtypeFact references unknown subtype object "${sf.subtypePlayerRef}".`,
      );
    }
    if (!supertypeId) {
      throw new NormaMappingError(
        `SubtypeFact references unknown supertype object "${sf.supertypePlayerRef}".`,
      );
    }

    const partition = subtypePartition.get(sf.supertypeRoleId);
    const added = model.addSubtypeFact({
      // NORMA's own id, as for every other element the importer maps.
      ...(sf.id ? { id: sf.id } : {}),
      subtypeId,
      supertypeId,
      providesIdentification: sf.providesIdentification,
    });
    flagged.push({
      id: added.id,
      supertype: supertypeId,
      ...(partition?.isExclusive ? { is_exclusive: true } : {}),
      ...(partition?.isExhaustive ? { is_exhaustive: true } : {}),
    });
  }
  for (const c of subtypeConstraintsFromFlags(flagged)) model.addConstraint(c);
}

/** Link objectified types to their nested fact types (phase 5). */
export function mapObjectifiedTypes(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap, factTypeIdMap } = ctx;

  for (const ot of doc.objectifiedTypes) {
    const objectTypeId = objectTypeIdMap.get(ot.id);
    const factTypeId = factTypeIdMap.get(ot.nestedFactTypeRef);

    if (!objectTypeId) {
      throw new NormaMappingError(
        `ObjectifiedType "${ot.name}" has no mapped object type.`,
      );
    }
    if (!factTypeId) {
      throw new NormaMappingError(
        `ObjectifiedType "${ot.name}" references unknown fact type "${ot.nestedFactTypeRef}".`,
      );
    }

    model.addObjectifiedFactType({
      // The NestedPredicate's own id when the file gives one; otherwise the
      // link has no id in the file, and its id comes from the two it links
      // rather than the generator: one file, one model.
      id: ot.nestedPredicateId
        ?? derivedNormaElementId(NORMA_ID_TAGS.objectification, [factTypeId, objectTypeId]),
      factTypeId,
      objectTypeId,
    });
  }
}

/**
 * Resolve subtype partition constraints (exclusive/exhaustive) from NORMA's
 * top-level constraint definitions.
 *
 * In NORMA, exclusive subtypes are represented by ExclusionConstraint
 * elements whose role sequences reference SupertypeMetaRoles. Exhaustive
 * subtypes are represented by non-simple, non-implied MandatoryConstraint
 * (disjunctive mandatory) elements referencing the same SupertypeMetaRoles.
 *
 * Returns a map from SupertypeMetaRole id -> { isExclusive, isExhaustive }.
 * Each SubtypeFact's supertypeRoleId can be looked up in this map.
 */
function resolveSubtypePartitions(
  doc: NormaDocument,
): Map<string, { isExclusive: boolean; isExhaustive: boolean; }> {
  // Build a set of all SupertypeMetaRole ids for fast lookup.
  const supertypeRoleIds = new Set<string>();
  for (const sf of doc.subtypeFacts) {
    supertypeRoleIds.add(sf.supertypeRoleId);
  }

  // Track which SupertypeMetaRoles participate in exclusion constraints.
  const exclusiveRoles = new Set<string>();
  for (const nc of doc.constraints) {
    if (nc.type !== "exclusion") continue;
    const allRoles = nc.roleSequences.flat();
    const onSupertype = allRoles.every((r) => supertypeRoleIds.has(r));
    if (onSupertype && allRoles.length >= 2) {
      for (const r of allRoles) exclusiveRoles.add(r);
    }
  }

  // Track which SupertypeMetaRoles participate in disjunctive mandatory constraints.
  const exhaustiveRoles = new Set<string>();
  for (const nc of doc.constraints) {
    if (nc.type !== "mandatory" || nc.isSimple || nc.isImplied) continue;
    const onSupertype = nc.roleRefs.every((r) => supertypeRoleIds.has(r));
    if (onSupertype && nc.roleRefs.length >= 2) {
      for (const r of nc.roleRefs) exhaustiveRoles.add(r);
    }
  }

  // Build the result map.
  const result = new Map<string, { isExclusive: boolean; isExhaustive: boolean; }>();
  for (const roleId of supertypeRoleIds) {
    const isExclusive = exclusiveRoles.has(roleId);
    const isExhaustive = exhaustiveRoles.has(roleId);
    if (isExclusive || isExhaustive) {
      result.set(roleId, { isExclusive, isExhaustive });
    }
  }

  return result;
}
