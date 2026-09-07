import type { OrmModel } from "../../model/OrmModel.js";
import { assertNever } from "../../util/assertNever.js";
import type { Diagnostic } from "../Diagnostic.js";
import { report, reportAs, RULE_ID } from "../ruleId.js";

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
              diagnostics.push(
                report(RULE_ID.internalUniquenessInvalidRole, "default", ft.id, ft.name, roleId),
              );
            }
          }

          if (
            constraint.roleIds.length === ft.arity
            && ft.arity > 1
            && constraint.roleIds.every((rid) => ft.hasRole(rid))
          ) {
            // A spanning constraint on a binary is the standard
            // many-to-many shape (informational); on a ternary or wider
            // it usually signals a non-elementary fact type (warning).
            diagnostics.push(
              reportAs(
                ft.arity === 2 ? "info" : "warning",
                RULE_ID.spanningAllRoles,
                "default",
                ft.id,
                ft.name,
                ft.arity,
              ),
            );
          }
          break;
        }

        case "mandatory": {
          if (!ft.hasRole(constraint.roleId)) {
            diagnostics.push(
              report(RULE_ID.mandatoryInvalidRole, "default", ft.id, ft.name, constraint.roleId),
            );
          }
          break;
        }

        case "value_constraint": {
          if (constraint.roleId && !ft.hasRole(constraint.roleId)) {
            diagnostics.push(
              report(
                RULE_ID.valueConstraintInvalidRole,
                "default",
                ft.id,
                ft.name,
                constraint.roleId,
              ),
            );
          }
          break;
        }

        case "external_uniqueness": {
          const allLocal = constraint.roleIds.every((rid) => ft.hasRole(rid));
          if (allLocal) {
            diagnostics.push(report(RULE_ID.externalUniquenessAllLocal, "default", ft.id, ft.name));
          }
          break;
        }

        // -- Phase 2 constraints --

        case "disjunctive_mandatory": {
          if (constraint.roleIds.length < 2) {
            diagnostics.push(
              report(RULE_ID.disjunctiveMandatoryTooFewRoles, "default", ft.id, ft.name),
            );
          }
          break;
        }

        case "exclusion": {
          if (constraint.roleIds.length < 2) {
            diagnostics.push(report(RULE_ID.exclusionTooFewRoles, "default", ft.id, ft.name));
          }
          break;
        }

        case "exclusive_or": {
          if (constraint.roleIds.length < 2) {
            diagnostics.push(report(RULE_ID.exclusiveOrTooFewRoles, "default", ft.id, ft.name));
          }
          break;
        }

        case "subset": {
          if (constraint.subsetRoleIds.length !== constraint.supersetRoleIds.length) {
            diagnostics.push(
              report(
                RULE_ID.subsetArityMismatch,
                "default",
                ft.id,
                ft.name,
                constraint.subsetRoleIds.length,
                constraint.supersetRoleIds.length,
              ),
            );
          }
          break;
        }

        case "equality": {
          if (constraint.roleIds1.length !== constraint.roleIds2.length) {
            diagnostics.push(
              report(
                RULE_ID.equalityArityMismatch,
                "default",
                ft.id,
                ft.name,
                constraint.roleIds1.length,
                constraint.roleIds2.length,
              ),
            );
          }
          break;
        }

        case "ring": {
          if (!ft.hasRole(constraint.roleId1)) {
            diagnostics.push(
              report(RULE_ID.ringInvalidRole, "default", ft.id, ft.name, constraint.roleId1),
            );
          }
          if (!ft.hasRole(constraint.roleId2)) {
            diagnostics.push(
              report(RULE_ID.ringInvalidRole, "default", ft.id, ft.name, constraint.roleId2),
            );
          }
          const r1 = ft.getRoleById(constraint.roleId1);
          const r2 = ft.getRoleById(constraint.roleId2);
          if (r1 && r2 && r1.playerId !== r2.playerId) {
            diagnostics.push(report(RULE_ID.ringDifferentPlayers, "default", ft.id, ft.name));
          }
          break;
        }

        case "frequency": {
          if (constraint.roleIds.length === 0) {
            diagnostics.push(report(RULE_ID.frequencyEmptyRoles, "default", ft.id, ft.name));
          }
          for (const roleId of constraint.roleIds) {
            if (!ft.hasRole(roleId)) {
              diagnostics.push(
                report(RULE_ID.frequencyInvalidRole, "default", ft.id, ft.name, roleId),
              );
            }
          }
          if (constraint.min < 1) {
            diagnostics.push(
              report(RULE_ID.frequencyInvalidMin, "default", ft.id, ft.name, constraint.min),
            );
          }
          if (constraint.max !== "unbounded" && constraint.max < constraint.min) {
            diagnostics.push(
              report(
                RULE_ID.frequencyMaxLessThanMin,
                "default",
                ft.id,
                ft.name,
                constraint.max,
                constraint.min,
              ),
            );
          }
          break;
        }

        case "cardinality": {
          if (!ft.hasRole(constraint.roleId)) {
            diagnostics.push(
              report(RULE_ID.cardinalityInvalidRole, "default", ft.id, ft.name, constraint.roleId),
            );
          }
          if (ft.arity !== 1) {
            diagnostics.push(
              report(RULE_ID.cardinalityNonUnary, "default", ft.id, ft.name, ft.arity),
            );
          }
          if (constraint.max !== "unbounded" && constraint.max < constraint.min) {
            diagnostics.push(
              report(
                RULE_ID.cardinalityMaxLessThanMin,
                "default",
                ft.id,
                ft.name,
                constraint.max,
                constraint.min,
              ),
            );
          }
          break;
        }

        case "value_comparison": {
          if (!ft.hasRole(constraint.roleId1)) {
            diagnostics.push(
              report(
                RULE_ID.valueComparisonInvalidRole,
                "default",
                ft.id,
                ft.name,
                constraint.roleId1,
              ),
            );
          }
          if (!ft.hasRole(constraint.roleId2)) {
            diagnostics.push(
              report(
                RULE_ID.valueComparisonInvalidRole,
                "default",
                ft.id,
                ft.name,
                constraint.roleId2,
              ),
            );
          }
          break;
        }

        // Join constraints (join_subset, join_equality, join_exclusion)
        // carry their roles inside path-projected operands rather than a
        // flat role id attached to this fact type; their consistency is
        // validated separately in joinConstraintRules.ts.
        case "join_subset":
        case "join_equality":
        case "join_exclusion":
          break;

        default:
          assertNever(constraint);
      }
    }
  }

  return diagnostics;
}
