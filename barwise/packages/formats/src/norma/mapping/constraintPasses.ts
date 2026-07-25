/**
 * Phase 3 of the NORMA mapping: top-level constraint passes.
 *
 * NORMA defines some constraints only at the top level -- either because
 * they span fact types (external uniqueness, disjunctive mandatory, the
 * set-comparison family) or because the exporting editor did not list them
 * in any fact's InternalConstraints. Each pass finds the unprocessed
 * constraints of one family and attaches them to the owning fact type.
 */
import type { OrmModel } from "@barwise/core";
import type { NormaDocument } from "../NormaXmlTypes.js";
import { collectProcessedRefs, type NormaMappingContext } from "./context.js";

/** Run every top-level constraint pass (phase 3). */
export function runConstraintPasses(ctx: NormaMappingContext): void {
  const { doc, model } = ctx;

  // Simple mandatory constraints are expressed as role attributes in NORMA
  // and also as top-level MandatoryConstraint elements with IsSimple=true.
  // The role-level IsMandatory flags are already captured. We now add any
  // simple mandatory constraints from the top-level that weren't applied
  // as part of a fact type's internalConstraintRefs.
  addSimpleMandatoryConstraints(doc, model);

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
): void {
  const processedRefs = collectProcessedRefs(doc);

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
  const processedRefs = collectProcessedRefs(doc);

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
  const processedRefs = collectProcessedRefs(doc);

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
