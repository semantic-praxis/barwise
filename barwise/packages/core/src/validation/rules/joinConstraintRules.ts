import {
  type Constraint,
  isJoinEquality,
  isJoinExclusion,
  isJoinSubset,
  type JoinOperand,
} from "../../model/Constraint.js";
import type { FactType } from "../../model/FactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";

/**
 * Structural well-formedness for join constraints (role-path operands).
 *
 * Checks the declaration only -- the population-satisfaction evaluation is a
 * separate rule. Per the role-path spec's minimal grammar: every step is a
 * real hop (entry and exit are roles of one fact type, the entry played by
 * the current node), steps are contiguous, each projection index is a valid
 * path node, and all operands of a constraint project tuples of the same
 * arity and matching column object types (so the tuple sets are comparable).
 */
export function joinConstraintRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (isJoinSubset(c)) {
        checkOperands([c.subset, c.superset], c, ft, model, diagnostics);
      } else if (isJoinEquality(c) || isJoinExclusion(c)) {
        if (c.operands.length < 2) {
          diagnostics.push({
            severity: "error",
            message: `Join ${c.type === "join_equality" ? "equality" : "exclusion"} `
              + `constraint in fact type "${ft.name}" must have at least two operands.`,
            elementId: c.id ?? ft.id,
            ruleId: "constraint/join-too-few-operands",
          });
        }
        checkOperands(c.operands, c, ft, model, diagnostics);
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
 * Validate each operand, then that all operands project comparable tuples
 * (same arity and matching column object types). Diagnostics accumulate.
 */
function checkOperands(
  operands: readonly JoinOperand[],
  c: Constraint,
  ft: FactType,
  model: OrmModel,
  diagnostics: Diagnostic[],
): void {
  const columnTypes = operands.map((o) => checkOperand(o, c, ft, model, diagnostics));
  const valid = columnTypes.filter((t): t is readonly string[] => t !== undefined);
  if (valid.length !== operands.length) return; // a malformed operand was already flagged

  const arity = valid[0]!.length;
  if (valid.some((t) => t.length !== arity)) {
    diagnostics.push({
      severity: "error",
      message: `Join constraint in fact type "${ft.name}" has operands that project `
        + `tuples of different arity; they must match.`,
      elementId: c.id ?? ft.id,
      ruleId: "constraint/join-arity-mismatch",
    });
    return;
  }
  for (let col = 0; col < arity; col++) {
    const types = new Set(valid.map((t) => t[col]));
    if (types.size > 1) {
      diagnostics.push({
        severity: "error",
        message: `Join constraint in fact type "${ft.name}" projects column ${col + 1} `
          + `from different object types across operands; they must match.`,
        elementId: c.id ?? ft.id,
        ruleId: "constraint/join-column-type-mismatch",
      });
    }
  }
}

/**
 * Validate one operand: the path is well-formed (root exists, every step is a
 * real contiguous hop) and every projection index is a valid path node.
 * Returns the projected column object-type ids, or undefined if malformed.
 */
function checkOperand(
  operand: JoinOperand,
  c: Constraint,
  ft: FactType,
  model: OrmModel,
  diagnostics: Diagnostic[],
): readonly string[] | undefined {
  const nodeTypes = pathNodeTypes(operand, c, ft, model, diagnostics);
  if (!nodeTypes) return undefined;

  const columns: string[] = [];
  for (const idx of operand.projection) {
    if (idx < 0 || idx >= nodeTypes.length) {
      diagnostics.push({
        severity: "error",
        message: `Join constraint in fact type "${ft.name}" projects node ${idx}, `
          + `which is outside the path (0..${nodeTypes.length - 1}).`,
        elementId: c.id ?? ft.id,
        ruleId: "constraint/join-bad-projection",
      });
      return undefined;
    }
    columns.push(nodeTypes[idx]!);
  }
  if (columns.length === 0) {
    diagnostics.push({
      severity: "error",
      message: `Join constraint in fact type "${ft.name}" has an operand with an `
        + `empty projection.`,
      elementId: c.id ?? ft.id,
      ruleId: "constraint/join-empty-projection",
    });
    return undefined;
  }
  return columns;
}

/**
 * The object-type id at each path node (node 0 = root, node k = player after
 * step k), validating the root exists and every step is a contiguous hop.
 * Returns undefined if the path is malformed.
 */
function pathNodeTypes(
  operand: JoinOperand,
  c: Constraint,
  ft: FactType,
  model: OrmModel,
  diagnostics: Diagnostic[],
): string[] | undefined {
  const { path } = operand;
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

  const nodeTypes = [path.root];
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
    nodeTypes.push(currentTypeId);
  }
  return nodeTypes;
}
