/**
 * Phases 4 and 5 of the NORMA mapping: subtype facts and objectification.
 *
 * The exclusion and disjunctive-mandatory constraints NORMA places on the
 * supertype meta-roles become constraints over the subtype facts, one for
 * each; objectified types are linked to their nested fact types once both
 * exist.
 */
import type { ExternalConstraint } from "@barwise/core";
import { subtypeFactRef } from "@barwise/core";
import { derivedNormaElementId, NORMA_ID_TAGS } from "../normaId.js";
import type { NormaConstraint } from "../NormaXmlTypes.js";
import { type NormaMappingContext, NormaMappingError } from "./context.js";

/** Create subtype facts and the constraints over them (phase 4). */
export function mapSubtypeFacts(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap } = ctx;

  // Each SupertypeMetaRole's subtype fact, as the model ids it.
  const bySupertypeRole = new Map<string, string>();
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

    const added = model.addSubtypeFact({
      // NORMA's own id, as for every other element the importer maps.
      ...(sf.id ? { id: sf.id } : {}),
      subtypeId,
      supertypeId,
      providesIdentification: sf.providesIdentification,
    });
    bySupertypeRole.set(sf.supertypeRoleId, subtypeFactRef(added));
  }
  for (const c of subtypeConstraints(ctx, bySupertypeRole)) model.addConstraint(c);
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
 * The constraints over subtypes NORMA states over supertype meta-roles
 * (orm-format-3 WS4b), one for each: an ExclusionConstraint whose role
 * sequences are all meta-roles is an exclusion, and a non-simple, non-implied
 * MandatoryConstraint over them a disjunctive mandatory. An exclusion and a
 * mandatory over the same subtypes, with one modality, are one exclusive-or,
 * as NORMA draws a partition. Each keeps NORMA's modality and, through the
 * allocator, its id.
 *
 * One NORMA constraint is one model constraint. This replaced reading them
 * as flags on each subtype fact, which merged two exclusions over one
 * supertype into a single wider one and dropped a deontic modality.
 */
function subtypeConstraints(
  ctx: NormaMappingContext,
  bySupertypeRole: ReadonlyMap<string, string>,
): ExternalConstraint[] {
  const over = (roles: readonly string[]) =>
    roles.length >= 2 && roles.every((r) => bySupertypeRole.has(r))
      ? roles.map((r) => bySupertypeRole.get(r)!)
      : undefined;
  const modalityOf = (nc: NormaConstraint) =>
    nc.modality === "deontic" ? ({ modality: "deontic" } as const) : {};
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));

  const exclusions: { nc: NormaConstraint; ids: string[]; }[] = [];
  const mandatories: { nc: NormaConstraint; ids: string[]; }[] = [];
  for (const nc of ctx.doc.constraints) {
    if (nc.type === "exclusion") {
      const ids = over(nc.roleSequences.flat());
      if (ids) exclusions.push({ nc, ids });
    } else if (nc.type === "mandatory" && !nc.isSimple && !nc.isImplied) {
      const ids = over(nc.roleRefs);
      if (ids) mandatories.push({ nc, ids });
    }
  }

  const out: ExternalConstraint[] = [];
  const paired = new Set<NormaConstraint>();
  for (const ex of exclusions) {
    const mandatory = mandatories.find((m) =>
      !paired.has(m.nc) && sameSet(m.ids, ex.ids)
      && (m.nc.modality === "deontic") === (ex.nc.modality === "deontic")
    );
    if (mandatory) paired.add(mandatory.nc);
    out.push({
      id: ctx.constraintIds.claim(ex.nc),
      type: mandatory ? "exclusive_or" : "exclusion",
      ...modalityOf(ex.nc),
      subtypeFactIds: ex.ids,
    });
  }
  for (const m of mandatories) {
    if (paired.has(m.nc)) continue;
    out.push({
      id: ctx.constraintIds.claim(m.nc),
      type: "disjunctive_mandatory",
      ...modalityOf(m.nc),
      subtypeFactIds: m.ids,
    });
  }
  return out;
}
