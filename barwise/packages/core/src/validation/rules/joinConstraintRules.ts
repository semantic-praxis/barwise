import {
  type Constraint,
  isJoinEquality,
  isJoinExclusion,
  isJoinSubset,
  type RolePath,
} from "../../model/Constraint.js";
import type { FactType } from "../../model/FactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";

/**
 * Structural well-formedness for join constraints (role-path operands).
 *
 * Checks the declaration only -- the population-satisfaction evaluation of a
 * join path is a separate rule. Per the role-path spec's minimal grammar:
 * every step is a real hop (entry and exit are roles of one fact type, the
 * entry played by the current node), steps are contiguous, and all operand
 * paths of a constraint share the same root and endpoint object type.
 */
export function joinConstraintRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (isJoinSubset(c)) {
        checkOperands([c.subset, c.superset], c, ft, model, diagnostics);
      } else if (isJoinEquality(c) || isJoinExclusion(c)) {
        if (c.paths.length < 2) {
          diagnostics.push({
            severity: "error",
            message: `Join ${c.type === "join_equality" ? "equality" : "exclusion"} `
              + `constraint in fact type "${ft.name}" must have at least two paths.`,
            elementId: c.id ?? ft.id,
            ruleId: "constraint/join-too-few-paths",
          });
        }
        checkOperands(c.paths, c, ft, model, diagnostics);
      }
    }
  }

  return diagnostics;
}

/** The fact type owning a role id, scanning the model. */
function factTypeOfRole(model: OrmModel, roleId: string): FactType | undefined {
  for (const ft of model.factTypes) {
    if (ft.getRoleById(roleId)) return ft;
  }
  return undefined;
}

/**
 * Validate each operand path is well-formed, then that all operands share a
 * root type and an endpoint type. Returns nothing -- diagnostics accumulate.
 */
function checkOperands(
  paths: readonly RolePath[],
  c: Constraint,
  ft: FactType,
  model: OrmModel,
  diagnostics: Diagnostic[],
): void {
  const endpoints: (string | undefined)[] = [];
  for (const path of paths) {
    endpoints.push(checkPath(path, c, ft, model, diagnostics));
  }

  const roots = new Set(paths.map((p) => p.root));
  if (roots.size > 1) {
    diagnostics.push({
      severity: "error",
      message: `Join constraint in fact type "${ft.name}" has operand paths with `
        + `different root object types; they must share one join variable.`,
      elementId: c.id ?? ft.id,
      ruleId: "constraint/join-root-mismatch",
    });
  }

  const definedEndpoints = endpoints.filter((e): e is string => e !== undefined);
  if (definedEndpoints.length === paths.length && new Set(definedEndpoints).size > 1) {
    diagnostics.push({
      severity: "error",
      message: `Join constraint in fact type "${ft.name}" has operand paths that `
        + `project to different endpoint object types; they must match.`,
      elementId: c.id ?? ft.id,
      ruleId: "constraint/join-endpoint-mismatch",
    });
  }
}

/**
 * Validate a single path: the root exists, each step's entry and exit are
 * roles of one fact type, the entry is played by the current node, and steps
 * are contiguous. Returns the endpoint object type id, or undefined if the
 * path is malformed.
 */
function checkPath(
  path: RolePath,
  c: Constraint,
  ft: FactType,
  model: OrmModel,
  diagnostics: Diagnostic[],
): string | undefined {
  if (!model.getObjectType(path.root)) {
    diagnostics.push({
      severity: "error",
      message: `Join constraint in fact type "${ft.name}" references an unknown `
        + `root object type "${path.root}".`,
      elementId: c.id ?? ft.id,
      ruleId: "constraint/join-unknown-root",
    });
    return undefined;
  }

  let currentTypeId = path.root;
  for (const step of path.steps) {
    const stepFt = factTypeOfRole(model, step.entry);
    const entryRole = stepFt?.getRoleById(step.entry);
    const exitRole = stepFt?.getRoleById(step.exit);
    if (!stepFt || !entryRole || !exitRole) {
      diagnostics.push({
        severity: "error",
        message: `Join constraint in fact type "${ft.name}" has a step whose entry `
          + `"${step.entry}" / exit "${step.exit}" are not both roles of one fact type.`,
        elementId: c.id ?? ft.id,
        ruleId: "constraint/join-bad-step",
      });
      return undefined;
    }
    if (entryRole.playerId !== currentTypeId) {
      diagnostics.push({
        severity: "error",
        message: `Join constraint in fact type "${ft.name}" is not contiguous: the `
          + `entry role "${step.entry}" is not played by the preceding path node.`,
        elementId: c.id ?? ft.id,
        ruleId: "constraint/join-discontiguous",
      });
      return undefined;
    }
    currentTypeId = exitRole.playerId;
  }
  return currentTypeId;
}
