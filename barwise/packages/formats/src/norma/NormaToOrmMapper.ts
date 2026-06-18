/**
 * Maps a NormaDocument (intermediate representation) to an OrmModel.
 *
 * The mapper resolves NORMA XML id references into Barwise model
 * objects and translates NORMA constraint representations into
 * the Barwise Constraint discriminated union.
 *
 * We do not embed or redistribute any NORMA source code or XSD schemas.
 * These mappings are derived from publicly documented format information.
 */
import {
  type ConceptualDataTypeName,
  type Constraint,
  type DataTypeDef,
  OrmModel,
  type RoleConfig,
  type ValueConstraintDef,
} from "@barwise/core";
import type {
  NormaConstraint,
  NormaDataType,
  NormaDocument,
  NormaEqualityConstraint,
  NormaExclusionConstraint,
  NormaFactType,
  NormaFrequencyConstraint,
  NormaMandatoryConstraint,
  NormaRingConstraint,
  NormaSubsetConstraint,
  NormaUniquenessConstraint,
  NormaValueConstraint,
  NormaValueConstraintInline,
} from "./NormaXmlTypes.js";

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

/** Map a NORMA inline value constraint to a core value-constraint definition. */
function toValueConstraintDef(
  vc: NormaValueConstraintInline | undefined,
): ValueConstraintDef | undefined {
  if (!vc) return undefined;
  if (vc.values.length === 0 && (vc.ranges?.length ?? 0) === 0) return undefined;
  return vc.ranges && vc.ranges.length > 0
    ? { values: vc.values, ranges: vc.ranges }
    : { values: vc.values };
}

/**
 * Map a parsed NormaDocument into an OrmModel.
 *
 * The mapping proceeds in phases to satisfy referential integrity
 * requirements of OrmModel:
 *
 * 1. Object types (entity + value) -- no dependencies
 * 2. Fact types with roles and readings -- depend on object types
 * 3. Constraints -- applied to fact types
 * 4. Subtype facts -- depend on object types
 * 5. Objectified fact types -- depend on both object types and fact types
 */
export function mapNormaToOrm(doc: NormaDocument): OrmModel {
  const model = new OrmModel({ name: doc.modelName });

  // NORMA id -> Barwise id mappings.
  // Object types use generated ids from OrmModel.addObjectType().
  const objectTypeIdMap = new Map<string, string>();
  // Role ids: NORMA role id -> Barwise role id.
  const roleIdMap = new Map<string, string>();
  // Fact type ids: NORMA fact id -> Barwise fact id.
  const factTypeIdMap = new Map<string, string>();

  // Build a lookup from NORMA data type id to NormaDataType.
  const dataTypeById = new Map<string, NormaDataType>();
  for (const dt of doc.dataTypes) {
    dataTypeById.set(dt.id, dt);
  }

  // ---- Phase 1: Object Types ----

  // Entity types from both EntityType and ObjectifiedType elements.
  for (const et of doc.entityTypes) {
    const ot = model.addObjectType({
      name: et.name,
      kind: "entity",
      referenceMode: et.referenceMode || `${snakeCase(et.name)}_id`,
      definition: et.definition,
    });
    objectTypeIdMap.set(et.id, ot.id);
  }

  // Value types.
  for (const vt of doc.valueTypes) {
    const ot = model.addObjectType({
      name: vt.name,
      kind: "value",
      definition: vt.definition,
      valueConstraint: toValueConstraintDef(vt.valueConstraint),
      dataType: resolveDataType(vt.dataTypeRef, vt.dataTypeLength, vt.dataTypeScale, dataTypeById),
    });
    objectTypeIdMap.set(vt.id, ot.id);
  }

  // Objectified types create entity object types (the objectification
  // link is established after fact types are created).
  for (const ot of doc.objectifiedTypes) {
    const objectType = model.addObjectType({
      name: ot.name,
      kind: "entity",
      referenceMode: ot.referenceMode || `${snakeCase(ot.name)}_id`,
      definition: ot.definition,
    });
    objectTypeIdMap.set(ot.id, objectType.id);
  }

  // ---- Phase 2: Fact Types ----

  // Build a lookup from NORMA constraint id to NormaConstraint.
  const constraintById = new Map<string, NormaConstraint>();
  for (const c of doc.constraints) {
    constraintById.set(c.id, c);
  }

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
    const constraints = resolveConstraintsForFactType(
      nft,
      constraintById,
      roleIdMap,
    );

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

  // ---- Phase 3: Post-process top-level constraints not in internalConstraintRefs ----

  // Simple mandatory constraints are expressed as role attributes in NORMA
  // and also as top-level MandatoryConstraint elements with IsSimple=true.
  // The role-level IsMandatory flags are already captured. We now add any
  // simple mandatory constraints from the top-level that weren't applied
  // as part of a fact type's internalConstraintRefs.
  addSimpleMandatoryConstraints(doc, model, factTypeIdMap, constraintById);

  // External uniqueness constraints span multiple fact types and are never
  // listed in any fact type's InternalConstraints section. Process them
  // as a post-processing pass.
  addExternalUniquenessConstraints(doc, model);

  // Role-level value constraints may also be defined at the top level
  // without being referenced from InternalConstraints. Process any
  // unprocessed value constraints.
  addRoleLevelValueConstraints(doc, model);

  // Disjunctive mandatory constraints span multiple fact types and are
  // never listed in any fact type's InternalConstraints section.
  addDisjunctiveMandatoryConstraints(doc, model);

  // Subset, exclusion, and equality constraints span fact types and are
  // typically not listed in InternalConstraints.
  addMultiFactTypeConstraints(doc, model);

  // Ring constraints not captured via internalConstraintRefs.
  addRingConstraints(doc, model);

  // ---- Phase 4: Subtype Facts ----

  // Determine subtype partition properties (exclusive/exhaustive) by
  // scanning for exclusion and disjunctive mandatory constraints on
  // SupertypeMetaRoles. These must be resolved before creating SubtypeFacts
  // because the properties are immutable.
  const subtypePartition = resolveSubtypePartitions(doc);

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
    model.addSubtypeFact({
      subtypeId,
      supertypeId,
      providesIdentification: sf.providesIdentification,
      isExclusive: partition?.isExclusive,
      isExhaustive: partition?.isExhaustive,
    });
  }

  // ---- Phase 5: Objectified Fact Types ----

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
      factTypeId,
      objectTypeId,
    });
  }

  return model;
}

// ---- Helpers ----

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
  _roleIdMap: Map<string, string>,
): Constraint[] {
  const constraints: Constraint[] = [];
  const internalRefs = new Set(nft.internalConstraintRefs);

  for (const ref of internalRefs) {
    const nc = constraintById.get(ref);
    if (!nc) continue;

    const mapped = mapNormaConstraint(nc, nft);
    if (mapped) {
      constraints.push(mapped);
    }
  }

  return constraints;
}

/**
 * Map a single NORMA constraint to a Barwise Constraint.
 * Returns undefined if the constraint cannot be mapped (e.g., it references
 * roles outside this fact type).
 */
function mapNormaConstraint(
  nc: NormaConstraint,
  nft: NormaFactType,
): Constraint | undefined {
  const factRoleIds = new Set(nft.roles.map((r) => r.id));

  switch (nc.type) {
    case "uniqueness":
      return mapUniquenessConstraint(nc, factRoleIds);
    case "mandatory":
      return mapMandatoryConstraint(nc, factRoleIds);
    case "frequency":
      return mapFrequencyConstraint(nc, factRoleIds);
    case "value_constraint":
      return mapValueConstraint(nc, factRoleIds);
    case "subset":
      return mapSubsetConstraint(nc);
    case "exclusion":
      return mapExclusionConstraint(nc);
    case "equality":
      return mapEqualityConstraint(nc);
    case "ring":
      return mapRingConstraint(nc, factRoleIds);
    default:
      return undefined;
  }
}

function mapUniquenessConstraint(
  nc: NormaUniquenessConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  // Only map internal uniqueness constraints that reference roles in this fact type.
  const relevantRoles = nc.roleRefs.filter((r) => factRoleIds.has(r));
  if (relevantRoles.length === 0) return undefined;

  if (nc.isInternal) {
    const result: Constraint = {
      type: "internal_uniqueness",
      roleIds: relevantRoles,
    };
    if (nc.isPreferred) {
      return { ...result, isPreferred: true } as Constraint;
    }
    return result;
  } else {
    return {
      type: "external_uniqueness",
      roleIds: nc.roleRefs,
    };
  }
}

function mapMandatoryConstraint(
  nc: NormaMandatoryConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  // NORMA auto-generates implied mandatory constraints for all played roles.
  // These are not part of the user's model and must be excluded.
  if (nc.isImplied) return undefined;

  if (nc.isSimple) {
    // Simple mandatory -> maps to mandatory role constraint.
    const roleId = nc.roleRefs.find((r) => factRoleIds.has(r));
    if (!roleId) return undefined;
    return { type: "mandatory", roleId };
  } else {
    // Disjunctive mandatory -> maps to disjunctive_mandatory.
    return {
      type: "disjunctive_mandatory",
      roleIds: nc.roleRefs,
    };
  }
}

function mapFrequencyConstraint(
  nc: NormaFrequencyConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  const roleId = nc.roleRefs.find((r) => factRoleIds.has(r));
  if (!roleId) return undefined;
  return {
    type: "frequency",
    roleId,
    min: nc.min,
    max: nc.max,
  };
}

function mapValueConstraint(
  nc: NormaValueConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  const roleId = nc.roleRefs.find((r) => factRoleIds.has(r));
  if (!roleId) return undefined;
  return {
    type: "value_constraint",
    roleId,
    values: nc.values,
    ...(nc.ranges && nc.ranges.length > 0 ? { ranges: nc.ranges } : {}),
  };
}

function mapSubsetConstraint(
  nc: NormaSubsetConstraint,
): Constraint | undefined {
  return {
    type: "subset",
    subsetRoleIds: [...nc.subsetRoleRefs],
    supersetRoleIds: [...nc.supersetRoleRefs],
  };
}

function mapExclusionConstraint(
  nc: NormaExclusionConstraint,
): Constraint | undefined {
  // Flatten role sequences into a single array of role ids.
  const allRoleIds = nc.roleSequences.flat();
  if (allRoleIds.length === 0) return undefined;

  // Check if NORMA paired this with a mandatory constraint (exclusive-or).
  // In NORMA, exclusive-or is an exclusion constraint + a mandatory constraint
  // on the same roles. The mapper currently maps them separately and lets
  // validation detect the pattern if needed.
  return {
    type: "exclusion",
    roleIds: allRoleIds,
  };
}

function mapEqualityConstraint(
  nc: NormaEqualityConstraint,
): Constraint | undefined {
  if (nc.roleSequences.length < 2) return undefined;
  return {
    type: "equality",
    roleIds1: [...nc.roleSequences[0]!],
    roleIds2: [...nc.roleSequences[1]!],
  };
}

function mapRingConstraint(
  nc: NormaRingConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  const relevantRoles = nc.roleRefs.filter((r) => factRoleIds.has(r));
  if (relevantRoles.length < 2) return undefined;
  return {
    type: "ring",
    roleId1: relevantRoles[0]!,
    roleId2: relevantRoles[1]!,
    ringType: nc.ringType,
  };
}

/**
 * Add simple mandatory constraints from NORMA's top-level constraint
 * definitions that weren't already captured by fact type internalConstraintRefs.
 *
 * NORMA expresses simple mandatory constraints both as role-level
 * IsMandatory="true" attributes AND as top-level MandatoryConstraint
 * elements with IsSimple="true". We need to handle cases where the
 * mandatory constraint is defined at the top level but not referenced
 * from within a fact type's InternalConstraints section.
 */
function addSimpleMandatoryConstraints(
  doc: NormaDocument,
  model: OrmModel,
  _factTypeIdMap: Map<string, string>,
  _constraintById: Map<string, NormaConstraint>,
): void {
  // Collect all constraint refs already processed via internalConstraintRefs.
  const processedRefs = new Set<string>();
  for (const nft of doc.factTypes) {
    for (const ref of nft.internalConstraintRefs) {
      processedRefs.add(ref);
    }
  }

  // Process unprocessed simple mandatory constraints.
  // Skip implied constraints -- they are NORMA auto-generated.
  for (const nc of doc.constraints) {
    if (nc.type !== "mandatory" || !nc.isSimple || nc.isImplied) continue;
    if (processedRefs.has(nc.id)) continue;

    // Find which fact type contains this role.
    for (const roleRef of nc.roleRefs) {
      for (const nft of doc.factTypes) {
        const role = nft.roles.find((r) => r.id === roleRef);
        if (!role) continue;

        // Find the corresponding Barwise fact type.
        const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === roleRef));
        if (!ft) continue;

        // Check if this mandatory constraint is already on the fact type.
        const alreadyExists = ft.constraints.some(
          (c) => c.type === "mandatory" && c.roleId === roleRef,
        );
        if (!alreadyExists) {
          ft.addConstraint({ type: "mandatory", roleId: roleRef });
        }
      }
    }
  }
}

/**
 * Add external uniqueness constraints from NORMA's top-level constraint
 * definitions.
 *
 * External uniqueness constraints span multiple fact types and are never
 * listed in any fact type's InternalConstraints section. This function
 * finds unprocessed external uniqueness constraints and attaches them
 * to the first fact type that contains one of the referenced roles.
 */
function addExternalUniquenessConstraints(
  doc: NormaDocument,
  model: OrmModel,
): void {
  // Collect all constraint refs already processed via internalConstraintRefs.
  const processedRefs = new Set<string>();
  for (const nft of doc.factTypes) {
    for (const ref of nft.internalConstraintRefs) {
      processedRefs.add(ref);
    }
  }

  for (const nc of doc.constraints) {
    if (nc.type !== "uniqueness" || nc.isInternal) continue;
    if (processedRefs.has(nc.id)) continue;

    // Find the first fact type that contains any of the referenced roles.
    const ft = model.factTypes.find((f) => nc.roleRefs.some((roleRef) => f.hasRole(roleRef)));
    if (!ft) continue;

    // Check if this constraint is already on the fact type.
    const alreadyExists = ft.constraints.some(
      (c) =>
        c.type === "external_uniqueness"
        && c.roleIds.length === nc.roleRefs.length
        && c.roleIds.every((id) => nc.roleRefs.includes(id)),
    );
    if (!alreadyExists) {
      ft.addConstraint({
        type: "external_uniqueness",
        roleIds: [...nc.roleRefs],
      });
    }
  }
}

/**
 * Add role-level value constraints from NORMA's top-level constraint
 * definitions that weren't already captured by fact type internalConstraintRefs.
 *
 * Role-level value constraints restrict the allowed values for a specific
 * role in a fact type (as opposed to type-level value restrictions on
 * ValueType objects). They may or may not appear in a fact type's
 * InternalConstraints section depending on the NORMA version and editor.
 */
function addRoleLevelValueConstraints(
  doc: NormaDocument,
  model: OrmModel,
): void {
  const processedRefs = new Set<string>();
  for (const nft of doc.factTypes) {
    for (const ref of nft.internalConstraintRefs) {
      processedRefs.add(ref);
    }
  }

  for (const nc of doc.constraints) {
    if (nc.type !== "value_constraint") continue;
    if (processedRefs.has(nc.id)) continue;
    if (nc.values.length === 0 && (nc.ranges?.length ?? 0) === 0) continue;

    for (const roleRef of nc.roleRefs) {
      const ft = model.factTypes.find((f) => f.hasRole(roleRef));
      if (!ft) continue;

      const alreadyExists = ft.constraints.some(
        (c) => c.type === "value_constraint" && c.roleId === roleRef,
      );
      if (!alreadyExists) {
        ft.addConstraint({
          type: "value_constraint",
          roleId: roleRef,
          values: [...nc.values],
          ...(nc.ranges && nc.ranges.length > 0 ? { ranges: [...nc.ranges] } : {}),
        });
      }
    }
  }
}

/**
 * Add disjunctive mandatory constraints that span multiple fact types.
 *
 * NORMA disjunctive mandatory constraints (InclusiveOrConstraint) are never
 * listed in a fact type's InternalConstraints section because they span
 * multiple fact types. They're defined as top-level MandatoryConstraint
 * elements with IsSimple=false and IsImplied=false.
 */
function addDisjunctiveMandatoryConstraints(
  doc: NormaDocument,
  model: OrmModel,
): void {
  const processedRefs = collectProcessedRefs(doc);

  for (const nc of doc.constraints) {
    if (nc.type !== "mandatory" || nc.isSimple || nc.isImplied) continue;
    if (processedRefs.has(nc.id)) continue;
    if (nc.roleRefs.length < 2) continue;

    // Check that at least one role belongs to a known fact type.
    const ft = model.factTypes.find((f) => nc.roleRefs.some((roleRef) => f.hasRole(roleRef)));
    if (!ft) continue;

    // Check if already exists on this fact type.
    const alreadyExists = ft.constraints.some(
      (c) =>
        c.type === "disjunctive_mandatory"
        && c.roleIds.length === nc.roleRefs.length
        && nc.roleRefs.every((id) => c.roleIds.includes(id)),
    );
    if (!alreadyExists) {
      ft.addConstraint({
        type: "disjunctive_mandatory",
        roleIds: [...nc.roleRefs],
      });
    }
  }
}

/**
 * Add subset, exclusion, and equality constraints that span multiple fact types.
 *
 * These constraints are typically defined at the top level and reference
 * roles across multiple fact types. They may or may not appear in any
 * fact type's InternalConstraints section.
 */
function addMultiFactTypeConstraints(
  doc: NormaDocument,
  model: OrmModel,
): void {
  const processedRefs = collectProcessedRefs(doc);

  for (const nc of doc.constraints) {
    if (processedRefs.has(nc.id)) continue;

    switch (nc.type) {
      case "subset": {
        if (nc.subsetRoleRefs.length === 0 && nc.supersetRoleRefs.length === 0) continue;
        const allRoles = [...nc.subsetRoleRefs, ...nc.supersetRoleRefs];
        const ft = model.factTypes.find((f) => allRoles.some((r) => f.hasRole(r)));
        if (!ft) continue;

        const alreadyExists = ft.constraints.some(
          (c) =>
            c.type === "subset"
            && c.subsetRoleIds.length === nc.subsetRoleRefs.length
            && nc.subsetRoleRefs.every((id) => c.subsetRoleIds.includes(id)),
        );
        if (!alreadyExists) {
          ft.addConstraint({
            type: "subset",
            subsetRoleIds: [...nc.subsetRoleRefs],
            supersetRoleIds: [...nc.supersetRoleRefs],
          });
        }
        break;
      }

      case "exclusion": {
        const allRoles = nc.roleSequences.flat();
        if (allRoles.length === 0) continue;
        const ft = model.factTypes.find((f) => allRoles.some((r) => f.hasRole(r)));
        if (!ft) continue;

        const alreadyExists = ft.constraints.some(
          (c) =>
            c.type === "exclusion"
            && c.roleIds.length === allRoles.length
            && allRoles.every((id) => c.roleIds.includes(id)),
        );
        if (!alreadyExists) {
          ft.addConstraint({
            type: "exclusion",
            roleIds: [...allRoles],
          });
        }
        break;
      }

      case "equality": {
        if (nc.roleSequences.length < 2) continue;
        const allRoles = nc.roleSequences.flat();
        const ft = model.factTypes.find((f) => allRoles.some((r) => f.hasRole(r)));
        if (!ft) continue;

        const alreadyExists = ft.constraints.some(
          (c) =>
            c.type === "equality"
            && c.roleIds1.length === nc.roleSequences[0]!.length
            && nc.roleSequences[0]!.every((id) => c.roleIds1.includes(id)),
        );
        if (!alreadyExists) {
          ft.addConstraint({
            type: "equality",
            roleIds1: [...nc.roleSequences[0]!],
            roleIds2: [...nc.roleSequences[1]!],
          });
        }
        break;
      }

      default:
        break;
    }
  }
}

/**
 * Add ring constraints not already captured via internalConstraintRefs.
 */
function addRingConstraints(
  doc: NormaDocument,
  model: OrmModel,
): void {
  const processedRefs = collectProcessedRefs(doc);

  for (const nc of doc.constraints) {
    if (nc.type !== "ring") continue;
    if (processedRefs.has(nc.id)) continue;
    if (nc.roleRefs.length < 2) continue;

    const ft = model.factTypes.find((f) => nc.roleRefs.every((roleRef) => f.hasRole(roleRef)));
    if (!ft) continue;

    const alreadyExists = ft.constraints.some(
      (c) =>
        c.type === "ring"
        && c.roleId1 === nc.roleRefs[0]
        && c.roleId2 === nc.roleRefs[1],
    );
    if (!alreadyExists) {
      ft.addConstraint({
        type: "ring",
        roleId1: nc.roleRefs[0]!,
        roleId2: nc.roleRefs[1]!,
        ringType: nc.ringType,
      });
    }
  }
}

/**
 * Collect all constraint IDs that were already processed via
 * fact type internalConstraintRefs.
 */
function collectProcessedRefs(doc: NormaDocument): Set<string> {
  const refs = new Set<string>();
  for (const nft of doc.factTypes) {
    for (const ref of nft.internalConstraintRefs) {
      refs.add(ref);
    }
  }
  return refs;
}

// ---- Subtype Partition Resolution ----

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

// ---- Data Type Resolution ----

/**
 * Maps NORMA data type kind strings (from dataTypeTagToKind in the parser)
 * to portable ConceptualDataTypeName values.
 *
 * The NORMA kinds use snake_case derived from the XML tag name (e.g.
 * "variable_length_text" from VariableLengthTextDataType). This table
 * normalizes them to the Barwise conceptual type vocabulary.
 */
const normaKindToConceptual: Record<string, ConceptualDataTypeName> = {
  // Text types
  variable_length_text: "text",
  fixed_length_text: "text",
  large_length_text: "text",

  // Numeric types
  signed_integer_numeric: "integer",
  unsigned_integer_numeric: "integer",
  signed_small_integer_numeric: "integer",
  unsigned_small_integer_numeric: "integer",
  signed_large_integer_numeric: "integer",
  unsigned_large_integer_numeric: "integer",
  auto_counter_numeric: "auto_counter",
  decimal_numeric: "decimal",
  money_numeric: "money",
  floating_point_numeric: "float",
  single_precision_floating_point_numeric: "float",
  double_precision_floating_point_numeric: "float",

  // Boolean
  true_or_false_logical: "boolean",

  // Date/time types
  date_and_time_temporal: "datetime",
  date_temporal: "date",
  time_temporal: "time",
  auto_timestamp_temporal: "timestamp",

  // Binary types
  variable_length_raw_data: "binary",
  fixed_length_raw_data: "binary",
  large_length_raw_data: "binary",
  picture_raw_data: "binary",
  ole_object_raw_data: "binary",

  // UUID
  unique_identifier: "uuid",

  // Row counter (NORMA-specific, treat as auto_counter)
  row_counter_numeric: "auto_counter",
};

/**
 * Resolve a NORMA DataType reference into a portable DataTypeDef.
 * Returns undefined if the reference is absent or unrecognized.
 */
function resolveDataType(
  dataTypeRef: string | undefined,
  length: number | undefined,
  scale: number | undefined,
  dataTypeById: Map<string, NormaDataType>,
): DataTypeDef | undefined {
  if (!dataTypeRef) return undefined;

  const normaDt = dataTypeById.get(dataTypeRef);
  if (!normaDt) return undefined;

  const conceptualName = normaKindToConceptual[normaDt.kind] ?? "other";

  const result: { name: ConceptualDataTypeName; length?: number; scale?: number; } = {
    name: conceptualName,
  };
  if (length !== undefined) result.length = length;
  if (scale !== undefined) result.scale = scale;
  return result;
}

/**
 * Convert a PascalCase or camelCase name to snake_case.
 */
function snakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
}
