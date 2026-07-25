/**
 * Phase 2 of the NORMA mapping: fact types.
 *
 * Creates each fact type with its roles (preserving NORMA role ids),
 * readings, and the constraints its InternalConstraints section references.
 */
import type { Constraint, OrmModel, RoleConfig } from "@barwise/core";
import type { NormaConstraint, NormaFactType } from "../NormaXmlTypes.js";
import { type NormaMappingContext, NormaMappingError } from "./context.js";
import { mapNormaConstraint } from "./factConstraints.js";
import { createJoinDecoder, type NormaJoinDecoder } from "./joinPaths.js";

/** Create fact types with roles, readings, and internal constraints (phase 2). */
export function mapFactTypes(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap, roleIdMap, factTypeIdMap, constraintById } = ctx;
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
    const constraints = resolveConstraintsForFactType(nft, constraintById, joinDecoder);

    const ft = model.addFactType({
      name: nft.name || generateFactTypeName(nft, objectTypeIdMap, model),
      roles,
      readings,
      constraints,
      definition: nft.definition,
    });

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
 * Resolve NORMA constraints that belong to a specific fact type
 * by matching the fact type's internalConstraintRefs against the
 * top-level constraint definitions.
 *
 * The resulting constraints use the NORMA role ids directly, since
 * we pass those as the RoleConfig.id when creating fact types.
 */
function resolveConstraintsForFactType(
  nft: NormaFactType,
  constraintById: Map<string, NormaConstraint>,
  joinDecoder: NormaJoinDecoder,
): Constraint[] {
  const constraints: Constraint[] = [];
  const internalRefs = new Set(nft.internalConstraintRefs);

  for (const ref of internalRefs) {
    const nc = constraintById.get(ref);
    if (!nc) continue;

    const mapped = mapNormaConstraint(nc, nft, joinDecoder);
    if (mapped) {
      constraints.push(mapped);
    }
  }

  return constraints;
}
