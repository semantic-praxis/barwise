/**
 * Phase 2 of the NORMA mapping: fact types.
 *
 * Creates each fact type with its roles (preserving NORMA role ids),
 * readings, and the constraints its InternalConstraints section references.
 */
import {
  type Constraint,
  isExternalConstraint,
  isInternalConstraint,
  type OrmModel,
  type RoleConfig,
} from "@barwise/core";
import type { NormaConstraint, NormaFactType } from "../NormaXmlTypes.js";
import {
  type ConstraintIdAllocator,
  type NormaMappingContext,
  NormaMappingError,
} from "./context.js";
import { exclusiveOrToAdd, holdsSame, mapNormaConstraint } from "./factConstraints.js";
import { createJoinDecoder, type NormaJoinDecoder } from "./joinPaths.js";

/** Create fact types with roles, readings, and internal constraints (phase 2). */
export function mapFactTypes(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap, roleIdMap, factTypeIdMap } = ctx;
  const joinDecoder = createJoinDecoder(ctx);

  for (const nft of doc.factTypes) {
    const roles: RoleConfig[] = nft.roles.map((nr) => {
      const playerId = objectTypeIdMap.get(nr.playerRef);
      if (!playerId) {
        throw new NormaMappingError(
          `Role "${nr.name}" in fact type "${nft.name}" references `
            + `unknown object type "${nr.playerRef}".`,
        );
      }
      return {
        name: nr.name || nr.id,
        playerId,
        id: nr.id, // Preserve NORMA role id for constraint mapping.
      };
    });

    // Extract reading templates from reading orders.
    const readings = extractReadings(nft);
    if (readings.length === 0) {
      // Use a placeholder if no readings defined.
      readings.push(
        nft.roles.map((_, i) => `{${i}}`).join(" ... "),
      );
    }

    // Resolve constraints that belong to this fact type.
    const constraints = resolveConstraintsForFactType(ctx, nft, joinDecoder);
    constraints.push(...roleCardinalityConstraints(nft, ctx.constraintIds));

    const ft = model.addFactType({
      // NORMA's own id, as object types keep theirs, so one file imports to
      // one model every time and exports back under the ids it had.
      ...(nft.id ? { id: nft.id } : {}),
      name: nft.name || generateFactTypeName(nft, objectTypeIdMap, model),
      roles,
      readings,
      constraints: constraints.filter(isInternalConstraint),
      definition: nft.definition,
      note: nft.note,
      ...(nft.derivationRule
        ? {
          derivation: {
            kind: nft.derivationRule.completeness === "PartiallyDerived"
              ? ("semiderived" as const)
              : ("derived" as const),
            ...(nft.derivationRule.storage === "Stored"
              ? { storage: "derived_and_stored" as const }
              : {}),
            expression: nft.derivationRule.noteBody,
          },
        }
        : {}),
    });

    // NORMA lists a constraint across fact types under a fact type it
    // spans; the model holds it (orm-format-3 WS3c), in the order read.
    for (const c of constraints.filter(isExternalConstraint)) model.addConstraint(c);

    factTypeIdMap.set(nft.id, ft.id);

    // Record role id mappings (NORMA id -> Barwise id).
    // Since we pass NORMA role ids as the id in RoleConfig, the
    // Barwise role ids will be the same NORMA ids (FactType constructor
    // uses the provided id).
    for (const nr of nft.roles) {
      const role = ft.getRoleById(nr.id);
      if (role) {
        roleIdMap.set(nr.id, role.id);
      }
    }
  }
}

/**
 * Extract reading templates from a NORMA fact type's reading orders.
 * NORMA uses "{0}", "{1}" placeholders which match Barwise's format.
 */
function extractReadings(nft: NormaFactType): string[] {
  const readings: string[] = [];
  for (const ro of nft.readingOrders) {
    for (const reading of ro.readings) {
      if (reading.data) {
        readings.push(reading.data);
      }
    }
  }
  return readings;
}

/**
 * Generate a fact type name from the roles when NORMA doesn't provide one.
 */
function generateFactTypeName(
  nft: NormaFactType,
  objectTypeIdMap: Map<string, string>,
  model: OrmModel,
): string {
  const playerNames = nft.roles.map((r) => {
    const barwiseId = objectTypeIdMap.get(r.playerRef);
    if (barwiseId) {
      const ot = model.getObjectType(barwiseId);
      if (ot) return ot.name;
    }
    return "Unknown";
  });
  return playerNames.join(" has ");
}

/**
 * Unary-role cardinality restrictions carried inline on the Role elements
 * (not in InternalConstraints) -> CardinalityConstraint. First NORMA range
 * -> the model's single bound, mirroring the object-type mapping.
 */
function roleCardinalityConstraints(
  nft: NormaFactType,
  ids: ConstraintIdAllocator,
): Constraint[] {
  const constraints: Constraint[] = [];
  for (const nr of nft.roles) {
    const card = nr.cardinality;
    const r = card?.ranges[0];
    if (!card || !r) continue;
    constraints.push({
      type: "cardinality",
      // One the file leaves without an id gets one derived from its role
      // (`cardinalityId`), so the import stays deterministic rather than
      // falling to the generator.
      id: ids.claimCardinality(card.id, nr.id),
      roleId: nr.id,
      min: r.from,
      max: r.to ?? "unbounded",
      ...(card.modality ? { modality: card.modality } : {}),
    });
  }
  return constraints;
}

/**
 * Resolve NORMA constraints that belong to a specific fact type
 * by matching the fact type's internalConstraintRefs against the
 * top-level constraint definitions.
 *
 * The resulting constraints use the NORMA role ids directly, since
 * we pass those as the RoleConfig.id when creating fact types.
 */
function resolveConstraintsForFactType(
  ctx: NormaMappingContext,
  nft: NormaFactType,
  joinDecoder: NormaJoinDecoder,
): Constraint[] {
  const { constraintById, constraintIds: ids, xorPairs } = ctx;
  const constraints: Constraint[] = [];
  const internalRefs = new Set(nft.internalConstraintRefs);
  // A uniqueness an entity's PreferredIdentifier names is never dropped as a
  // duplicate: the identifier must keep the constraint it names. Any other
  // is dropped as a duplicate of one held that is named, or that NORMA marks
  // IsPreferred exactly as it does, as it was while the flag rode on the
  // mapped constraint, before format 3.0.
  const keep = new Set<Constraint>();
  const preferred = new Set<Constraint>();
  const isPreferred = (nc: NormaConstraint) => nc.type === "uniqueness" && nc.isPreferred;

  for (const ref of internalRefs) {
    const nc = constraintById.get(ref);
    if (!nc) continue;

    // A pair builds its exclusive_or from the mandatory -- its roles, its
    // modality -- so the constraint has one shape whichever half maps first.
    const mandatoryId = nc.type === "exclusion"
      ? xorPairs.mandatoryByExclusion.get(nc.id)
      : undefined;
    const source = (mandatoryId !== undefined ? constraintById.get(mandatoryId) : undefined) ?? nc;
    const mapped = mapNormaConstraint(
      source,
      nft,
      xorPairs.exclusiveOrIds.has(source.id),
      joinDecoder,
    );
    if (!mapped) continue;
    if (mapped.type === "exclusive_or") {
      // Both halves of a pair map to the same exclusive_or, and a file may
      // list them in one fact type or two; the pair maps once. A second,
      // distinct pair over the same roles says the same thing.
      const xor = exclusiveOrToAdd(ids, source, mapped);
      if (xor) constraints.push(xor);
      continue;
    }
    const named = ctx.namedIdentifiers.has(source.id);
    const flagged = isPreferred(source);
    const comparable = constraints.filter((c) => keep.has(c) || preferred.has(c) === flagged);
    if (!named && holdsSame(comparable, mapped)) continue;
    const added = { ...mapped, id: ids.claim(source) };
    if (named) keep.add(added);
    if (flagged) preferred.add(added);
    constraints.push(added);
  }

  return constraints;
}
