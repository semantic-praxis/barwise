/**
 * Phase 3 of the NORMA mapping: top-level constraint passes.
 *
 * NORMA defines some constraints only at the top level -- either because
 * they span fact types (external uniqueness, disjunctive mandatory, the
 * set-comparison family) or because the exporting editor did not list them
 * in any fact's InternalConstraints. Each pass finds the unprocessed
 * constraints of one family and attaches them to the owning fact type.
 */
import { type Constraint, type FactType, isExternalConstraint, roleIdsOf } from "@barwise/core";
import type { NormaConstraint } from "../NormaXmlTypes.js";
import type { NormaMappingContext } from "./context.js";
import {
  exclusiveOrFromMandatory,
  exclusiveOrToAdd,
  holdsSame,
  mapEqualityConstraint,
  mapExclusionConstraint,
  mapJoinRing,
  mapSubsetConstraint,
  mapValueComparisonConstraint,
  withModality,
} from "./factConstraints.js";
import { createJoinDecoder } from "./joinPaths.js";

/** Run every top-level constraint pass (phase 3). */
export function runConstraintPasses(ctx: NormaMappingContext): void {
  // Simple mandatory constraints are expressed as role attributes in NORMA
  // and also as top-level MandatoryConstraint elements with IsSimple=true.
  // The role-level IsMandatory flags are already captured. We now add any
  // simple mandatory constraints from the top-level that weren't applied
  // as part of a fact type's internalConstraintRefs.
  addSimpleMandatoryConstraints(ctx);

  // External uniqueness constraints span multiple fact types and are never
  // listed in any fact type's InternalConstraints section. Process them
  // as a post-processing pass.
  addExternalUniquenessConstraints(ctx);

  // Role-level value constraints may also be defined at the top level
  // without being referenced from InternalConstraints. Process any
  // unprocessed value constraints.
  addRoleLevelValueConstraints(ctx);

  // Disjunctive mandatory constraints span multiple fact types and are
  // never listed in any fact type's InternalConstraints section.
  addDisjunctiveMandatoryConstraints(ctx);

  // Subset, exclusion, and equality constraints span fact types and are
  // typically not listed in InternalConstraints.
  addMultiFactTypeConstraints(ctx);

  // Ring constraints not captured via internalConstraintRefs.
  addRingConstraints(ctx);
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
function addSimpleMandatoryConstraints(ctx: NormaMappingContext): void {
  const { doc, model, processedRefs } = ctx;
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

        addUnlessHeld(ctx, ft, nc, { type: "mandatory", roleId: roleRef });
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
function addExternalUniquenessConstraints(ctx: NormaMappingContext): void {
  const { doc, model, processedRefs } = ctx;
  for (const nc of doc.constraints) {
    if (nc.type !== "uniqueness" || nc.isInternal) continue;
    if (processedRefs.has(nc.id)) continue;

    // Find the first fact type that contains any of the referenced roles.
    const ft = model.factTypes.find((f) => nc.roleRefs.some((roleRef) => f.hasRole(roleRef)));
    if (!ft) continue;

    addUnlessHeld(ctx, ft, nc, { type: "external_uniqueness", roleIds: [...nc.roleRefs] });
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
function addRoleLevelValueConstraints(ctx: NormaMappingContext): void {
  const { doc, model, processedRefs } = ctx;
  for (const nc of doc.constraints) {
    if (nc.type !== "value_constraint") continue;
    if (processedRefs.has(nc.id)) continue;
    if (nc.values.length === 0 && (nc.ranges?.length ?? 0) === 0) continue;

    for (const roleRef of nc.roleRefs) {
      const ft = model.factTypes.find((f) => f.hasRole(roleRef));
      if (!ft) continue;

      addUnlessHeld(ctx, ft, nc, {
        type: "value_constraint",
        roleId: roleRef,
        values: [...nc.values],
        ...(nc.ranges && nc.ranges.length > 0 ? { ranges: [...nc.ranges] } : {}),
      });
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
function addDisjunctiveMandatoryConstraints(ctx: NormaMappingContext): void {
  const { doc, model, processedRefs, constraintIds: ids, xorPairs } = ctx;
  for (const nc of doc.constraints) {
    if (nc.type !== "mandatory" || nc.isSimple || nc.isImplied) continue;
    if (processedRefs.has(nc.id)) continue;
    if (nc.roleRefs.length < 2) continue;

    // Check that at least one role belongs to a known fact type.
    const ft = model.factTypes.find((f) => nc.roleRefs.some((roleRef) => f.hasRole(roleRef)));
    if (!ft) continue;

    // A mandatory coupled to an exclusion is NORMA's exclusive-or
    // encoding: the pair maps to one exclusive_or constraint, and the
    // paired exclusion is skipped in addMultiFactTypeConstraints.
    if (xorPairs.exclusiveOrIds.has(nc.id)) {
      const xor = exclusiveOrToAdd(ids, nc, exclusiveOrFromMandatory(nc));
      if (xor) model.addConstraint(xor);
      continue;
    }

    addUnlessHeld(ctx, ft, nc, { type: "disjunctive_mandatory", roleIds: [...nc.roleRefs] });
  }
}

/**
 * Add subset, exclusion, and equality constraints that span multiple fact types.
 *
 * These constraints are typically defined at the top level and reference
 * roles across multiple fact types. They may or may not appear in any
 * fact type's InternalConstraints section. A role sequence carrying a
 * join path maps to the corresponding join variant; the flat mapping is
 * the fallback.
 */
function addMultiFactTypeConstraints(ctx: NormaMappingContext): void {
  const { doc, model, xorPairs, processedRefs } = ctx;
  const joinDecoder = createJoinDecoder(ctx);

  for (const nc of doc.constraints) {
    if (processedRefs.has(nc.id)) continue;
    // A paired exclusion is consumed by its pair, which its mandatory builds:
    // in phase 1 when either half is listed, else in
    // addDisjunctiveMandatoryConstraints. `buildExclusiveOr` keeps the pair
    // to one constraint whichever site reaches it.
    if (nc.type === "exclusion" && xorPairs.mandatoryByExclusion.has(nc.id)) continue;

    switch (nc.type) {
      case "subset": {
        if (nc.subsetRoleRefs.length === 0 && nc.supersetRoleRefs.length === 0) continue;
        const allRoles = [...nc.subsetRoleRefs, ...nc.supersetRoleRefs];
        const ft = model.factTypes.find((f) => allRoles.some((r) => f.hasRole(r)));
        if (!ft) continue;

        const mapped = mapSubsetConstraint(nc, joinDecoder);
        if (!mapped) continue;

        addUnlessHeld(ctx, ft, nc, mapped);
        break;
      }

      case "value_comparison": {
        if (nc.roleRefs.length !== 2) continue;
        const ft = model.factTypes.find((f) => nc.roleRefs.every((r) => f.hasRole(r)));
        if (!ft) continue;

        const mapped = mapValueComparisonConstraint(nc, new Set(nc.roleRefs));
        if (!mapped || mapped.type !== "value_comparison") continue;

        addUnlessHeld(ctx, ft, nc, mapped);
        break;
      }

      case "exclusion": {
        const allRoles = nc.roleSequences.flat();
        if (allRoles.length === 0) continue;
        const ft = model.factTypes.find((f) => allRoles.some((r) => f.hasRole(r)));
        if (!ft) continue;

        // A paired exclusion was skipped above, left to its mandatory; one
        // coupled to no partner that builds the constraint builds it here.
        const mapped = mapExclusionConstraint(nc, xorPairs.exclusiveOrIds.has(nc.id), joinDecoder);
        if (!mapped) continue;
        if (mapped.type === "exclusive_or") {
          const xor = exclusiveOrToAdd(ctx.constraintIds, nc, mapped);
          if (xor) model.addConstraint(xor);
          break;
        }

        addUnlessHeld(ctx, ft, nc, mapped);
        break;
      }

      case "equality": {
        if (nc.roleSequences.length < 2) continue;
        const allRoles = nc.roleSequences.flat();
        const ft = model.factTypes.find((f) => allRoles.some((r) => f.hasRole(r)));
        if (!ft) continue;

        const mapped = mapEqualityConstraint(nc, joinDecoder);
        if (!mapped) continue;

        addUnlessHeld(ctx, ft, nc, mapped);
        break;
      }

      default:
        break;
    }
  }
}

/**
 * Add `mapped`, with `nc`'s modality and its claimed id, unless the model
 * already holds a constraint saying exactly the same thing (`holdsSame`):
 * `ft` for a constraint of one fact type, and anywhere for one across fact
 * types, whichever fact type it was nested under (orm-format-3, Open
 * decision 9).
 */
function addUnlessHeld(
  ctx: NormaMappingContext,
  ft: FactType,
  nc: NormaConstraint,
  mapped: Constraint,
): void {
  const candidate = withModality(nc, mapped);
  if (isExternalConstraint(candidate)) {
    // A duplicate an entity names as its identifier, or that NORMA marks
    // IsPreferred, stays, as the internal pass spares one: dropping it
    // would drop the identifier with it.
    const identifies = ctx.namedIdentifiers.has(nc.id)
      || (nc.type === "uniqueness" && nc.isPreferred);
    if (!identifies && holdsSame(ctx.model.constraints, candidate)) return;
    ctx.model.addConstraint({ ...candidate, id: ctx.constraintIds.claim(nc) });
  } else {
    if (holdsSame(ft.internalConstraints, candidate)) return;
    ft.addConstraint({ ...candidate, id: ctx.constraintIds.claim(nc) });
  }
}

/**
 * Add ring constraints not already captured via internalConstraintRefs.
 */
function addRingConstraints(ctx: NormaMappingContext): void {
  const { doc, model, processedRefs } = ctx;
  const joinDecoder = createJoinDecoder(ctx);
  for (const nc of doc.constraints) {
    if (nc.type !== "ring") continue;

    // Over a join path, mapped here and only here, whether or not a fact
    // lists it: phase 1 leaves such a ring alone, so one listed under two
    // fact types maps once, and a one-hop ring listed under a fact type
    // other than its hop's still lands on its hop's. The fact type passed
    // is the first hop's, which `addUnlessHeld` uses only for a plain ring.
    if (nc.joinPath || nc.unreadableJoin) {
      const mapped = nc.joinPath && mapJoinRing(nc, joinDecoder);
      if (!mapped) continue;
      const firstRole = roleIdsOf(mapped)[0];
      const ft = model.factTypes.find((f) => firstRole !== undefined && f.hasRole(firstRole));
      if (ft) addUnlessHeld(ctx, ft, nc, mapped);
      continue;
    }

    if (processedRefs.has(nc.id)) continue;
    if (nc.roleRefs.length < 2) continue;

    const ft = model.factTypes.find((f) => nc.roleRefs.every((roleRef) => f.hasRole(roleRef)));
    if (!ft) continue;

    addUnlessHeld(ctx, ft, nc, {
      type: "ring",
      roleId1: nc.roleRefs[0]!,
      roleId2: nc.roleRefs[1]!,
      ringType: nc.ringType,
    });
  }
}
