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
import { report, RULE_ID } from "../ruleId.js";

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
          diagnostics.push(
            report(
              RULE_ID.joinTooFewOperands,
              "default",
              c.id ?? ft.id,
              c.type === "join_equality" ? "equality" : "exclusion",
              ft.name,
            ),
          );
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
    diagnostics.push(report(RULE_ID.joinArityMismatch, "default", c.id ?? ft.id, ft.name));
    return;
  }
  for (let col = 0; col < arity; col++) {
    const types = new Set(valid.map((t) => t[col]));
    if (types.size > 1) {
      diagnostics.push(
        report(RULE_ID.joinColumnTypeMismatch, "default", c.id ?? ft.id, ft.name, col + 1),
      );
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
      diagnostics.push(
        report(
          RULE_ID.joinBadProjection,
          "default",
          c.id ?? ft.id,
          ft.name,
          idx,
          nodeTypes.length - 1,
        ),
      );
      return undefined;
    }
    columns.push(nodeTypes[idx]!);
  }
  if (columns.length === 0) {
    diagnostics.push(report(RULE_ID.joinEmptyProjection, "default", c.id ?? ft.id, ft.name));
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
    diagnostics.push(report(RULE_ID.joinUnknownRoot, "default", c.id ?? ft.id, ft.name, path.root));
    return undefined;
  }

  const nodeTypes = [path.root];
  let currentTypeId = path.root;
  for (const step of path.steps) {
    const stepFt = factTypeOfRole(model, step.entry);
    const entryRole = stepFt?.getRoleById(step.entry);
    const exitRole = stepFt?.getRoleById(step.exit);
    if (!stepFt || !entryRole || !exitRole) {
      diagnostics.push(
        report(RULE_ID.joinBadStep, "default", c.id ?? ft.id, ft.name, step.entry, step.exit),
      );
      return undefined;
    }
    if (entryRole.playerId !== currentTypeId) {
      diagnostics.push(
        report(RULE_ID.joinDiscontiguous, "default", c.id ?? ft.id, ft.name, step.entry),
      );
      return undefined;
    }
    currentTypeId = exitRole.playerId;
    nodeTypes.push(currentTypeId);
  }
  return nodeTypes;
}
