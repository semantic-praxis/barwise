import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";

/**
 * Constraint consistency rules.
 *
 * These verify that constraints reference valid roles and are
 * logically coherent.
 */
export function constraintConsistencyRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const constraint of ft.constraints) {
      switch (constraint.type) {
        case "internal_uniqueness": {
          for (const roleId of constraint.roleIds) {
            if (!ft.hasRole(roleId)) {
              diagnostics.push({
                severity: "error",
                message: `Internal uniqueness constraint in fact type "${ft.name}" `
                  + `references role id "${roleId}" which does not belong to this fact type.`,
                elementId: ft.id,
                ruleId: "constraint/internal-uniqueness-invalid-role",
              });
            }
          }

          if (
            constraint.roleIds.length === ft.arity
            && ft.arity > 1
            && constraint.roleIds.every((rid) => ft.hasRole(rid))
          ) {
            diagnostics.push({
              severity: "warning",
              message: `Internal uniqueness constraint in fact type "${ft.name}" `
                + `spans all ${ft.arity} roles. This means each complete fact `
                + `can only appear once, which is often redundant.`,
              elementId: ft.id,
              ruleId: "constraint/spanning-all-roles",
            });
          }
          break;
        }

        case "mandatory": {
          if (!ft.hasRole(constraint.roleId)) {
            diagnostics.push({
              severity: "error",
              message: `Mandatory constraint in fact type "${ft.name}" `
                + `references role id "${constraint.roleId}" which does not belong to this fact type.`,
              elementId: ft.id,
              ruleId: "constraint/mandatory-invalid-role",
            });
          }
          break;
        }

        case "value_constraint": {
          if (constraint.roleId && !ft.hasRole(constraint.roleId)) {
            diagnostics.push({
              severity: "error",
              message: `Value constraint in fact type "${ft.name}" `
                + `references role id "${constraint.roleId}" which does not belong to this fact type.`,
              elementId: ft.id,
              ruleId: "constraint/value-constraint-invalid-role",
            });
          }
          break;
        }

        case "external_uniqueness": {
          const allLocal = constraint.roleIds.every((rid) => ft.hasRole(rid));
          if (allLocal) {
            diagnostics.push({
              severity: "warning",
              message: `External uniqueness constraint in fact type "${ft.name}" `
                + `references only roles within this fact type. `
                + `Consider using internal uniqueness instead.`,
              elementId: ft.id,
              ruleId: "constraint/external-uniqueness-all-local",
            });
          }
          break;
        }

        // -- Phase 2 constraints --

        case "disjunctive_mandatory": {
          if (constraint.roleIds.length < 2) {
            diagnostics.push({
              severity: "error",
              message: `Disjunctive mandatory constraint in fact type "${ft.name}" `
                + `must reference at least 2 roles.`,
              elementId: ft.id,
              ruleId: "constraint/disjunctive-mandatory-too-few-roles",
            });
          }
          break;
        }

        case "exclusion": {
          if (constraint.roleIds.length < 2) {
            diagnostics.push({
              severity: "error",
              message: `Exclusion constraint in fact type "${ft.name}" `
                + `must reference at least 2 roles.`,
              elementId: ft.id,
              ruleId: "constraint/exclusion-too-few-roles",
            });
          }
          break;
        }

        case "exclusive_or": {
          if (constraint.roleIds.length < 2) {
            diagnostics.push({
              severity: "error",
              message: `Exclusive-or constraint in fact type "${ft.name}" `
                + `must reference at least 2 roles.`,
              elementId: ft.id,
              ruleId: "constraint/exclusive-or-too-few-roles",
            });
          }
          break;
        }

        case "subset": {
          if (constraint.subsetRoleIds.length !== constraint.supersetRoleIds.length) {
            diagnostics.push({
              severity: "error",
              message: `Subset constraint in fact type "${ft.name}" `
                + `has mismatched role sequence lengths: subset has ${constraint.subsetRoleIds.length} roles, `
                + `superset has ${constraint.supersetRoleIds.length} roles.`,
              elementId: ft.id,
              ruleId: "constraint/subset-arity-mismatch",
            });
          }
          break;
        }

        case "equality": {
          if (constraint.roleIds1.length !== constraint.roleIds2.length) {
            diagnostics.push({
              severity: "error",
              message: `Equality constraint in fact type "${ft.name}" `
                + `has mismatched role sequence lengths: first has ${constraint.roleIds1.length} roles, `
                + `second has ${constraint.roleIds2.length} roles.`,
              elementId: ft.id,
              ruleId: "constraint/equality-arity-mismatch",
            });
          }
          break;
        }

        case "ring": {
          if (!ft.hasRole(constraint.roleId1)) {
            diagnostics.push({
              severity: "error",
              message: `Ring constraint in fact type "${ft.name}" `
                + `references role id "${constraint.roleId1}" which does not belong to this fact type.`,
              elementId: ft.id,
              ruleId: "constraint/ring-invalid-role",
            });
          }
          if (!ft.hasRole(constraint.roleId2)) {
            diagnostics.push({
              severity: "error",
              message: `Ring constraint in fact type "${ft.name}" `
                + `references role id "${constraint.roleId2}" which does not belong to this fact type.`,
              elementId: ft.id,
              ruleId: "constraint/ring-invalid-role",
            });
          }
          const r1 = ft.getRoleById(constraint.roleId1);
          const r2 = ft.getRoleById(constraint.roleId2);
          if (r1 && r2 && r1.playerId !== r2.playerId) {
            diagnostics.push({
              severity: "error",
              message: `Ring constraint in fact type "${ft.name}" `
                + `requires both roles to be played by the same object type.`,
              elementId: ft.id,
              ruleId: "constraint/ring-different-players",
            });
          }
          break;
        }

        case "frequency": {
          if (constraint.roleIds.length === 0) {
            diagnostics.push({
              severity: "error",
              message: `Frequency constraint in fact type "${ft.name}" `
                + `must reference at least one role.`,
              elementId: ft.id,
              ruleId: "constraint/frequency-empty-roles",
            });
          }
          for (const roleId of constraint.roleIds) {
            if (!ft.hasRole(roleId)) {
              diagnostics.push({
                severity: "error",
                message: `Frequency constraint in fact type "${ft.name}" `
                  + `references role id "${roleId}" which does not belong to this fact type.`,
                elementId: ft.id,
                ruleId: "constraint/frequency-invalid-role",
              });
            }
          }
          if (constraint.min < 1) {
            diagnostics.push({
              severity: "error",
              message: `Frequency constraint in fact type "${ft.name}" `
                + `has min ${constraint.min}, which must be at least 1.`,
              elementId: ft.id,
              ruleId: "constraint/frequency-invalid-min",
            });
          }
          if (constraint.max !== "unbounded" && constraint.max < constraint.min) {
            diagnostics.push({
              severity: "error",
              message: `Frequency constraint in fact type "${ft.name}" `
                + `has max (${constraint.max}) less than min (${constraint.min}).`,
              elementId: ft.id,
              ruleId: "constraint/frequency-max-less-than-min",
            });
          }
          break;
        }

        case "cardinality": {
          if (!ft.hasRole(constraint.roleId)) {
            diagnostics.push({
              severity: "error",
              message: `Cardinality constraint in fact type "${ft.name}" `
                + `references role id "${constraint.roleId}" which does not belong to this fact type.`,
              elementId: ft.id,
              ruleId: "constraint/cardinality-invalid-role",
            });
          }
          if (ft.arity !== 1) {
            diagnostics.push({
              severity: "error",
              message: `Cardinality constraint in fact type "${ft.name}" `
                + `applies to a unary role, but the fact type has arity ${ft.arity}.`,
              elementId: ft.id,
              ruleId: "constraint/cardinality-non-unary",
            });
          }
          if (constraint.max !== "unbounded" && constraint.max < constraint.min) {
            diagnostics.push({
              severity: "error",
              message: `Cardinality constraint in fact type "${ft.name}" `
                + `has max (${constraint.max}) less than min (${constraint.min}).`,
              elementId: ft.id,
              ruleId: "constraint/cardinality-max-less-than-min",
            });
          }
          break;
        }
      }
    }
  }

  return diagnostics;
}
