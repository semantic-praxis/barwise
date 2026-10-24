import {
  isJoinEquality,
  isJoinExclusion,
  isJoinRing,
  isJoinSubset,
  type JoinOperand,
  type JoinRingConstraint,
} from "../../model/Constraint.js";
import type { ModelGraph } from "../../model/graph.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";
import { report, RULE_ID } from "../ruleId.js";
import { constraintElementId, constraintSpan } from "../span.js";

/** Where a join constraint's diagnostics point, and how they name it. */
interface At {
  readonly id: string;
  readonly span: string;
}

/**
 * Structural well-formedness for join constraints (role-path operands).
 *
 * Checks the declaration only -- the population-satisfaction evaluation is a
 * separate rule. Per the role-path spec's minimal grammar: every step is a
 * real hop (entry and exit are roles of one fact type, the entry played by
 * the current node), steps are contiguous, each projection index is a valid
 * path node, and all operands of a constraint project tuples of the same
 * arity and matching column object types (so the tuple sets are comparable).
 *
 * Whether a path root or a step role names anything at all is `graphOf`'s
 * question, not this rule's. What survives here is what the graph cannot
 * answer: that a step's exit is a role of the SAME fact type as its
 * entry. That is a locality check, and `joinBadStep` still reports it --
 * a role of another fact type resolves perfectly well and is still not a
 * hop.
 */
export function joinConstraintRules(model: OrmModel, graph: ModelGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const c of model.constraints) {
    if (!isJoinSubset(c) && !isJoinEquality(c) && !isJoinExclusion(c) && !isJoinRing(c)) {
      continue;
    }
    const at = { id: constraintElementId(c), span: constraintSpan(model, c) };
    if (isJoinRing(c)) {
      checkRing(c, at, graph, diagnostics);
    } else if (isJoinSubset(c)) {
      checkOperands([c.subset, c.superset], at, graph, diagnostics);
    } else {
      if (c.operands.length < 2) {
        diagnostics.push(
          report(
            RULE_ID.joinTooFewOperands,
            "default",
            at.id,
            c.type === "join_equality" ? "equality" : "exclusion",
            at.span,
          ),
        );
      }
      checkOperands(c.operands, at, graph, diagnostics);
    }
  }

  return diagnostics;
}

/**
 * A join ring's one operand: well-formed as any operand is, then exactly
 * two columns played by one object type, which is what makes the projected
 * pairs a relation of that type to itself. A one-hop path within one fact
 * type is the plain `ring` spelled the long way, so two files could state
 * one constraint two ways that diff never pairs; a warning names it, and a
 * path of two or more hops is never this case, even a self-join whose
 * projected roles share a fact type.
 */
function checkRing(
  c: JoinRingConstraint,
  at: At,
  graph: ModelGraph,
  diagnostics: Diagnostic[],
): void {
  const columns = checkOperand(c.operand, at, graph, diagnostics);
  if (!columns) return;
  if (columns.length !== 2) {
    diagnostics.push(report(RULE_ID.joinRingArity, "default", at.id, at.span, columns.length));
    return;
  }
  if (columns[0] !== columns[1]) {
    diagnostics.push(report(RULE_ID.joinRingDifferentPlayers, "default", at.id, at.span));
  }
  // A well-formed hop is within one fact type by construction, so one
  // hop projecting both of its ends is exactly what a plain ring states.
  const [from, to] = c.operand.projection;
  if (c.operand.path.steps.length === 1 && from !== to) {
    diagnostics.push(report(RULE_ID.joinRingSingleFactType, "default", at.id, at.span));
  }
}

/**
 * Validate each operand, then that all operands project comparable tuples
 * (same arity and matching column object types). Diagnostics accumulate.
 */
function checkOperands(
  operands: readonly JoinOperand[],
  at: At,
  graph: ModelGraph,
  diagnostics: Diagnostic[],
): void {
  const columnTypes = operands.map((o) => checkOperand(o, at, graph, diagnostics));
  const valid = columnTypes.filter((t): t is readonly string[] => t !== undefined);
  if (valid.length !== operands.length) return; // a malformed operand was already flagged

  const arity = valid[0]!.length;
  if (valid.some((t) => t.length !== arity)) {
    diagnostics.push(report(RULE_ID.joinArityMismatch, "default", at.id, at.span));
    return;
  }
  for (let col = 0; col < arity; col++) {
    const types = new Set(valid.map((t) => t[col]));
    if (types.size > 1) {
      diagnostics.push(
        report(RULE_ID.joinColumnTypeMismatch, "default", at.id, at.span, col + 1),
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
  at: At,
  graph: ModelGraph,
  diagnostics: Diagnostic[],
): readonly string[] | undefined {
  const nodeTypes = pathNodeTypes(operand, at, graph, diagnostics);
  if (!nodeTypes) return undefined;

  const columns: string[] = [];
  for (const idx of operand.projection) {
    if (idx < 0 || idx >= nodeTypes.length) {
      diagnostics.push(
        report(
          RULE_ID.joinBadProjection,
          "default",
          at.id,
          at.span,
          idx,
          nodeTypes.length - 1,
        ),
      );
      return undefined;
    }
    columns.push(nodeTypes[idx]!);
  }
  if (columns.length === 0) {
    diagnostics.push(report(RULE_ID.joinEmptyProjection, "default", at.id, at.span));
    return undefined;
  }
  return columns;
}

/**
 * The object-type id at each path node (node 0 = root, node k = player after
 * step k), validating that every step is a contiguous hop. Returns undefined
 * if the path is malformed.
 *
 * The root and both step roles resolve -- the graph is the precondition for
 * running at all -- so what is left to check is that entry and exit belong to
 * one fact type, and that the entry is played by the node the path has
 * reached.
 */
function pathNodeTypes(
  operand: JoinOperand,
  at: At,
  graph: ModelGraph,
  diagnostics: Diagnostic[],
): string[] | undefined {
  const { path } = operand;
  const nodeTypes = [path.root];
  let currentTypeId = path.root;
  for (const step of path.steps) {
    const stepFt = graph.factTypeOf(graph.role(step.entry));
    const entryRole = stepFt.getRoleById(step.entry);
    const exitRole = stepFt.getRoleById(step.exit);
    if (!entryRole || !exitRole) {
      diagnostics.push(
        report(RULE_ID.joinBadStep, "default", at.id, at.span, step.entry, step.exit),
      );
      return undefined;
    }
    if (entryRole.playerId !== currentTypeId) {
      diagnostics.push(
        report(RULE_ID.joinDiscontiguous, "default", at.id, at.span, step.entry),
      );
      return undefined;
    }
    currentTypeId = exitRole.playerId;
    nodeTypes.push(currentTypeId);
  }
  return nodeTypes;
}
