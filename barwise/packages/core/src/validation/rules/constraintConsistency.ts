import type { ExternalConstraint } from "../../model/Constraint.js";
import type { OrmModel } from "../../model/OrmModel.js";
import { assertNever } from "../../util/assertNever.js";
import type { Diagnostic } from "../Diagnostic.js";
import { report, reportAs, RULE_ID } from "../ruleId.js";
import { constraintElementId, constraintSpan, localFactTypeOf } from "../span.js";

/**
 * Constraint consistency rules.
 *
 * These verify that constraints reference valid roles and are
 * logically coherent. An internal constraint is checked against the fact
 * type it lives in and reported there; a constraint across fact types is
 * checked once, located by its own id and named by the fact types it
 * spans (orm-format-3, Open decision 9).
 */
export function constraintConsistencyRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const constraint of ft.internalConstraints) {
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

        default:
          assertNever(constraint);
      }
    }
  }

  for (const constraint of model.constraints) {
    diagnostics.push(...externalConsistency(model, constraint));
  }

  return diagnostics;
}

/**
 * A constraint over a supertype's subtypes (orm-format-3, Open decision 2):
 * an exclusion or exclusive-or needs two subtype facts or more, since
 * exclusion within a one-member group always holds and states nothing;
 * a disjunctive mandatory needs one, since "every Person is a Male" is a
 * real rule. Every subtype fact must share one supertype. A subtype fact
 * id that resolves to nothing is `referenceDiagnostics`', not this rule's.
 */
function subtypeOperandConsistency(
  model: OrmModel,
  id: string,
  kind: string,
  subtypeFactIds: readonly string[],
  min: number,
): Diagnostic[] {
  const facts = subtypeFactIds.flatMap((sf) => model.getSubtypeFact(sf) ?? []);
  const supertypes = [...new Set(facts.map((sf) => sf.supertypeId))];
  const nameOf = (ot: string) => model.getObjectType(ot)?.name ?? ot;
  if (supertypes.length > 1) {
    return [
      report(
        RULE_ID.subtypeConstraintMixedSupertypes,
        "default",
        id,
        kind,
        supertypes.map(nameOf).join(", "),
      ),
    ];
  }
  // Distinct subtype facts: one named twice is still one subtype.
  const count = new Set(subtypeFactIds).size;
  if (count < min) {
    const supertype = supertypes[0] === undefined ? "its supertype" : nameOf(supertypes[0]);
    return [
      report(
        RULE_ID.subtypeConstraintTooFewSubtypes,
        "default",
        id,
        kind,
        supertype,
        count,
        min,
      ),
    ];
  }
  return [];
}

function externalConsistency(model: OrmModel, constraint: ExternalConstraint): Diagnostic[] {
  const id = constraintElementId(constraint);
  const span = constraintSpan(model, constraint);
  switch (constraint.type) {
    case "external_uniqueness": {
      // All local means all in ONE fact type, whichever it is -- not all in
      // the fact type a 2.0 file happened to nest it under.
      // An empty one is reported too, as it always was (by vacuous truth):
      // nothing else reports an external uniqueness with no roles, and the
      // schema's minItems guards only a loaded file.
      if (constraint.roleIds.length === 0) {
        return [report(RULE_ID.externalUniquenessAllLocal, "noRoles", id)];
      }
      return localFactTypeOf(model, constraint)
        ? [report(RULE_ID.externalUniquenessAllLocal, "default", id, span)]
        : [];
    }

    case "disjunctive_mandatory":
      if (constraint.subtypeFactIds) {
        return subtypeOperandConsistency(
          model,
          id,
          "Disjunctive mandatory",
          constraint.subtypeFactIds,
          1,
        );
      }
      return constraint.roleIds.length < 2
        ? [report(RULE_ID.disjunctiveMandatoryTooFewRoles, "default", id, span)]
        : [];

    case "exclusion":
      if (constraint.subtypeFactIds) {
        return subtypeOperandConsistency(model, id, "Exclusion", constraint.subtypeFactIds, 2);
      }
      return constraint.roleIds.length < 2
        ? [report(RULE_ID.exclusionTooFewRoles, "default", id, span)]
        : [];

    case "exclusive_or":
      if (constraint.subtypeFactIds) {
        return subtypeOperandConsistency(model, id, "Exclusive-or", constraint.subtypeFactIds, 2);
      }
      return constraint.roleIds.length < 2
        ? [report(RULE_ID.exclusiveOrTooFewRoles, "default", id, span)]
        : [];

    case "subset":
      return constraint.subsetRoleIds.length !== constraint.supersetRoleIds.length
        ? [
          report(
            RULE_ID.subsetArityMismatch,
            "default",
            id,
            span,
            constraint.subsetRoleIds.length,
            constraint.supersetRoleIds.length,
          ),
        ]
        : [];

    case "equality":
      return constraint.roleIds1.length !== constraint.roleIds2.length
        ? [
          report(
            RULE_ID.equalityArityMismatch,
            "default",
            id,
            span,
            constraint.roleIds1.length,
            constraint.roleIds2.length,
          ),
        ]
        : [];

    // Join constraints (join_subset, join_equality, join_exclusion,
    // join_ring) carry their roles inside path-projected operands rather
    // than a flat list of roles; their consistency is validated
    // separately in joinConstraintRules.ts.
    case "join_subset":
    case "join_equality":
    case "join_exclusion":
    case "join_ring":
      return [];

    default:
      return assertNever(constraint);
  }
}
