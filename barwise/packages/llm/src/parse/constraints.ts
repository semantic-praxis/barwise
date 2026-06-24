/**
 * Pass 3 of the draft-model parse: apply inferred constraints.
 */

import { type Constraint, type FactType, type OrmModel, type RingType } from "@barwise/core";
import type { ConstraintProvenance, InferredConstraint } from "../ExtractionTypes.js";
import { resolveRolesByPlayerName, VALID_RING_TYPES } from "./helpers.js";

/**
 * Apply inferred constraints to fact types in the model.
 * Mutates `model` and `warnings`; returns the constraint provenance.
 */
export function parseConstraints(
  section: readonly InferredConstraint[],
  model: OrmModel,
  warnings: string[],
): ConstraintProvenance[] {
  const constraintProvenance: ConstraintProvenance[] = [];

  for (const ic of section) {
    const ft = model.getFactTypeByName(ic.fact_type);
    if (!ft) {
      constraintProvenance.push({
        description: ic.description,
        confidence: ic.confidence,
        sourceReferences: ic.source_references ?? [],
        applied: false,
        skipReason: `Fact type "${ic.fact_type}" not found in model.`,
      });
      continue;
    }

    if (ic.type === "internal_uniqueness") {
      // Find the role(s) by player name or role name.
      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length > 0) {
        const constraint: Constraint = ic.is_preferred
          ? { type: "internal_uniqueness", roleIds, isPreferred: true }
          : { type: "internal_uniqueness", roleIds };

        // Skip duplicate constraints (LLMs often emit the same constraint
        // in multiple phrasings, e.g. "each X has at most one Y" and
        // "each Y identifies at most one X" both targeting the same role).
        if (isDuplicateConstraint(ft, constraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (identical type and roles already present).",
          });
        } else {
          ft.addConstraint(constraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      } else {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Could not resolve roles [${
            ic.roles.join(", ")
          }] in fact type "${ic.fact_type}".`,
        });
      }
    } else if (ic.type === "mandatory") {
      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length === 1 && roleIds[0]) {
        const mandatoryConstraint: Constraint = {
          type: "mandatory",
          roleId: roleIds[0],
        };
        if (isDuplicateConstraint(ft, mandatoryConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (identical type and role already present).",
          });
        } else {
          ft.addConstraint(mandatoryConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      } else {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: roleIds.length === 0
            ? `Could not resolve role [${ic.roles.join(", ")}] in fact type "${ic.fact_type}".`
            : `Mandatory constraint requires exactly one role, got ${roleIds.length}.`,
        });
      }
    } else if (ic.type === "value_constraint") {
      // Role-level value constraint: restrict allowed values for a
      // specific role within a fact type.
      if (!ic.values || ic.values.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: "Value constraint has no values specified.",
        });
        continue;
      }

      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length !== 1) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: roleIds.length === 0
            ? `Could not resolve role [${ic.roles.join(", ")}] in fact type "${ic.fact_type}".`
            : `Value constraint requires exactly one role, got ${roleIds.length}.`,
        });
      } else {
        const vcConstraint: Constraint = {
          type: "value_constraint",
          roleId: roleIds[0]!,
          values: [...ic.values],
        };
        if (isDuplicateConstraint(ft, vcConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason:
              "Duplicate constraint (identical value constraint on same role already present).",
          });
        } else {
          ft.addConstraint(vcConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (
      ic.type === "external_uniqueness"
      || ic.type === "disjunctive_mandatory"
      || ic.type === "exclusion"
      || ic.type === "exclusive_or"
    ) {
      // Multi-role constraints within a single fact type.
      // All four share the same structure: { type, roleIds }.
      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Could not resolve roles [${
            ic.roles.join(", ")
          }] in fact type "${ic.fact_type}".`,
        });
      } else {
        const constraint: Constraint = {
          type: ic.type,
          roleIds,
        };
        if (isDuplicateConstraint(ft, constraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: `Duplicate constraint (identical ${ic.type} already present).`,
          });
        } else {
          ft.addConstraint(constraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (ic.type === "frequency") {
      // Frequency constraint: single role with min/max bounds.
      if (ic.min === undefined || ic.min === null) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: "Frequency constraint requires min value.",
        });
        continue;
      }
      if (ic.max === undefined || ic.max === null) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: "Frequency constraint requires max value.",
        });
        continue;
      }

      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length !== 1) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: roleIds.length === 0
            ? `Could not resolve role [${ic.roles.join(", ")}] in fact type "${ic.fact_type}".`
            : `Frequency constraint requires exactly one role, got ${roleIds.length}.`,
        });
      } else {
        const freqConstraint: Constraint = {
          type: "frequency",
          roleIds: [roleIds[0]!],
          min: ic.min,
          max: ic.max,
        };
        if (isDuplicateConstraint(ft, freqConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (frequency on same role already present).",
          });
        } else {
          ft.addConstraint(freqConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (ic.type === "ring") {
      // Ring constraint: exactly 2 roles, same fact type, with a ring_type.
      if (!ic.ring_type || !VALID_RING_TYPES.has(ic.ring_type)) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: ic.ring_type
            ? `Unrecognized ring_type "${ic.ring_type}".`
            : "Ring constraint requires a ring_type.",
        });
        continue;
      }

      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length !== 2) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Ring constraint requires exactly 2 roles, got ${roleIds.length}.`,
        });
      } else {
        const ringConstraint: Constraint = {
          type: "ring",
          roleId1: roleIds[0]!,
          roleId2: roleIds[1]!,
          ringType: ic.ring_type as RingType,
        };
        if (isDuplicateConstraint(ft, ringConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (ring on same roles already present).",
          });
        } else {
          ft.addConstraint(ringConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (ic.type === "subset" || ic.type === "equality") {
      // Subset and equality constraints: two role sequences across two fact types.
      if (!ic.superset_fact_type) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `${ic.type} constraint requires superset_fact_type.`,
        });
        continue;
      }
      if (!ic.superset_roles || ic.superset_roles.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `${ic.type} constraint requires superset_roles.`,
        });
        continue;
      }

      const supersetFt = model.getFactTypeByName(ic.superset_fact_type);
      if (!supersetFt) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Superset fact type "${ic.superset_fact_type}" not found in model.`,
        });
        continue;
      }

      const subsetRoleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      const supersetRoleIds = resolveRolesByPlayerName(
        supersetFt,
        ic.superset_roles,
        model,
        warnings,
        ic.description,
      );

      if (subsetRoleIds.length === 0 || supersetRoleIds.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Could not resolve roles for ${ic.type} constraint.`,
        });
      } else if (subsetRoleIds.length !== supersetRoleIds.length) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason:
            `${ic.type} constraint requires matching arity: got ${subsetRoleIds.length} vs ${supersetRoleIds.length}.`,
        });
      } else {
        const constraint: Constraint = ic.type === "subset"
          ? { type: "subset", subsetRoleIds, supersetRoleIds }
          : { type: "equality", roleIds1: subsetRoleIds, roleIds2: supersetRoleIds };

        if (isDuplicateConstraint(ft, constraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: `Duplicate constraint (identical ${ic.type} already present).`,
          });
        } else {
          ft.addConstraint(constraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    }
  }

  return constraintProvenance;
}

/**
 * Check whether a structurally identical constraint already exists on a fact type.
 * Two internal_uniqueness constraints are duplicates if they cover the same set
 * of role IDs. The isPreferred flag is promoted (if either is preferred, the
 * existing one wins).
 */
function isDuplicateConstraint(
  ft: FactType,
  candidate: Constraint,
): boolean {
  if (candidate.type === "internal_uniqueness") {
    const candidateRoles = [...candidate.roleIds].sort();
    return ft.constraints.some((existing) => {
      if (existing.type !== "internal_uniqueness") return false;
      const existingRoles = [...existing.roleIds].sort();
      return (
        existingRoles.length === candidateRoles.length
        && existingRoles.every((id, i) => id === candidateRoles[i])
      );
    });
  }
  if (candidate.type === "mandatory") {
    return ft.constraints.some(
      (existing) =>
        existing.type === "mandatory"
        && existing.roleId === candidate.roleId,
    );
  }
  if (candidate.type === "value_constraint") {
    return ft.constraints.some(
      (existing) =>
        existing.type === "value_constraint"
        && existing.roleId === candidate.roleId,
    );
  }
  // Multi-role constraints with sorted role ID comparison.
  if (
    candidate.type === "external_uniqueness"
    || candidate.type === "disjunctive_mandatory"
    || candidate.type === "exclusion"
    || candidate.type === "exclusive_or"
  ) {
    const candidateRoles = [...candidate.roleIds].sort();
    return ft.constraints.some((existing) => {
      if (existing.type !== candidate.type) return false;
      const existingRoles = [...(existing as typeof candidate).roleIds].sort();
      return (
        existingRoles.length === candidateRoles.length
        && existingRoles.every((id, i) => id === candidateRoles[i])
      );
    });
  }
  if (candidate.type === "frequency") {
    const candRoles = [...candidate.roleIds].sort();
    return ft.constraints.some(
      (existing) =>
        existing.type === "frequency"
        && existing.roleIds.length === candRoles.length
        && [...existing.roleIds].sort().every((id, i) => id === candRoles[i]),
    );
  }
  if (candidate.type === "ring") {
    const roles = [candidate.roleId1, candidate.roleId2].sort();
    return ft.constraints.some((existing) => {
      if (existing.type !== "ring") return false;
      if (existing.ringType !== candidate.ringType) return false;
      const existingRoles = [existing.roleId1, existing.roleId2].sort();
      return existingRoles[0] === roles[0] && existingRoles[1] === roles[1];
    });
  }
  if (candidate.type === "subset") {
    return ft.constraints.some((existing) => {
      if (existing.type !== "subset") return false;
      return (
        arraysEqual(existing.subsetRoleIds, candidate.subsetRoleIds)
        && arraysEqual(existing.supersetRoleIds, candidate.supersetRoleIds)
      );
    });
  }
  if (candidate.type === "equality") {
    return ft.constraints.some((existing) => {
      if (existing.type !== "equality") return false;
      return (
        arraysEqual(existing.roleIds1, candidate.roleIds1)
        && arraysEqual(existing.roleIds2, candidate.roleIds2)
      );
    });
  }
  return false;
}

/** Compare two readonly string arrays for equality (order-sensitive). */
function arraysEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
