/**
 * `UnresolvedReference` records from `graphOf`, mapped to the rule ids
 * validation already owns.
 *
 * This is the layering seam. `model/graph.ts` mints no `Diagnostic`:
 * nothing under `model/` imports from `validation/`, and a
 * `Diagnostic<RuleId>` there would invert that for a type the graph does
 * not need. So the graph reports what it found in its own terms and this
 * module -- which is inside `validation/`, where `RULE_ID` lives --
 * says what each finding is called.
 *
 * Every id below already existed and was emitted by a rule that resolved
 * the reference itself. Nothing new is minted, because a diagnostic id
 * is a promise to whoever reads validator output, and moving WHERE a
 * check runs must not change WHAT a consumer sees.
 *
 * One multiplicity difference is deliberate and is the exception that
 * proves the rule. `joinConstraintRules` walked a path and gave up at
 * the first bad hop, so a path with two dangling steps produced one
 * diagnostic; the graph enumerates references rather than walking, so it
 * produces two. Each is identical to the one the old rule would have
 * given for that hop alone. Reporting the second is the improvement the
 * workstream is for -- a caller sees everything knowable about a model
 * that cannot build -- but it is a change, so it is stated here rather
 * than discovered.
 */

import type { Constraint, JoinOperand } from "../model/Constraint.js";
import { joinOperandsOf } from "../model/Constraint.js";
import type { UnresolvedReference } from "../model/graph.js";
import type { RolePathStep } from "../model/RolePath.js";
import type { Diagnostic } from "./Diagnostic.js";
import { report, RULE_ID } from "./ruleId.js";

/** The constraint kinds whose role references live in a join path. */
type JoinConstraintType = "join_subset" | "join_equality" | "join_exclusion";

/**
 * The rule id for a dangling role reference on a constraint, by kind.
 *
 * A total `Record` rather than a switch with a default arm: a constraint
 * kind added later fails to compile here until it is given an id,
 * instead of silently reporting under someone else's. The join kinds are
 * excluded because their references are reported per hop, not per role
 * -- see `joinStepDiagnostic`. Kinds whose dangling roles were never
 * reported separately map to the internal-uniqueness id, which is what
 * `constraintConsistency` used for the generic case.
 */
/**
 * The invalid-role ids, every one of which renders from (factTypeName,
 * roleId). Naming the union keeps `report` type-checked at the call
 * site below, where a single id would not fit the map.
 */
type InvalidRoleRuleId =
  | typeof RULE_ID.internalUniquenessInvalidRole
  | typeof RULE_ID.mandatoryInvalidRole
  | typeof RULE_ID.frequencyInvalidRole
  | typeof RULE_ID.cardinalityInvalidRole
  | typeof RULE_ID.valueConstraintInvalidRole
  | typeof RULE_ID.valueComparisonInvalidRole
  | typeof RULE_ID.ringInvalidRole;

const CONSTRAINT_INVALID_ROLE: Record<
  Exclude<Constraint["type"], JoinConstraintType>,
  InvalidRoleRuleId
> = {
  internal_uniqueness: RULE_ID.internalUniquenessInvalidRole,
  external_uniqueness: RULE_ID.internalUniquenessInvalidRole,
  mandatory: RULE_ID.mandatoryInvalidRole,
  disjunctive_mandatory: RULE_ID.mandatoryInvalidRole,
  frequency: RULE_ID.frequencyInvalidRole,
  cardinality: RULE_ID.cardinalityInvalidRole,
  value_constraint: RULE_ID.valueConstraintInvalidRole,
  value_comparison: RULE_ID.valueComparisonInvalidRole,
  ring: RULE_ID.ringInvalidRole,
  exclusion: RULE_ID.internalUniquenessInvalidRole,
  exclusive_or: RULE_ID.mandatoryInvalidRole,
  subset: RULE_ID.internalUniquenessInvalidRole,
  equality: RULE_ID.internalUniquenessInvalidRole,
};

/** Diagnostics for every reference `graphOf` could not resolve. */
export function referenceDiagnostics(
  unresolved: readonly UnresolvedReference[],
): Diagnostic[] {
  return unresolved.map((u) => diagnosticFor(u));
}

function diagnosticFor(u: UnresolvedReference): Diagnostic {
  switch (u.from.kind) {
    case "role":
      return report(
        RULE_ID.danglingRoleReference,
        "default",
        u.from.factType.id,
        u.from.role.name,
        u.from.factType.name,
        u.missing,
      );
    case "constraint": {
      const { constraint, factType } = u.from;
      const elementId = constraint.id ?? factType.id;
      // A join operand's path root is its own finding, distinct from a
      // dangling hop.
      if (u.field === "path.root") {
        return report(RULE_ID.joinUnknownRoot, "default", elementId, factType.name, u.missing);
      }
      const operands = joinOperandsOf(constraint);
      if (operands.length > 0) {
        return joinStepDiagnostic(operands, elementId, factType.name, u.missing);
      }
      return report(
        CONSTRAINT_INVALID_ROLE[constraint.type as Exclude<Constraint["type"], JoinConstraintType>],
        "default",
        factType.id,
        factType.name,
        u.missing,
      );
    }
    case "subtypeFact":
      return report(
        u.field === "subtypeId"
          ? RULE_ID.subtypeDanglingSubtype
          : RULE_ID.subtypeDanglingSupertype,
        "default",
        u.from.subtypeFact.id,
        u.missing,
      );
    case "objectifiedFactType":
      return report(
        u.field === "factTypeId"
          ? RULE_ID.objectifiedDanglingFactType
          : RULE_ID.objectifiedDanglingObjectType,
        "default",
        u.from.objectifiedFactType.id,
        u.missing,
      );
    case "population":
      return report(
        RULE_ID.danglingFactType,
        "default",
        u.from.population.id,
        u.from.population.id,
        u.missing,
      );
  }
}

/**
 * The `joinBadStep` message names BOTH ends of the hop, and an
 * `UnresolvedReference` carries only the id that failed to resolve -- so
 * the hop is found again here rather than widening the graph's report
 * type to carry a sibling id one message needs. The first hop mentioning
 * the missing id is the one that produced it: the graph reports role ids
 * in `roleIdsOf` order, which is operand order, hop order, entry before
 * exit.
 */
function joinStepDiagnostic(
  operands: readonly JoinOperand[],
  elementId: string,
  factTypeName: string,
  missing: string,
): Diagnostic {
  let step: RolePathStep | undefined;
  for (const operand of operands) {
    step = operand.path.steps.find((s) => s.entry === missing || s.exit === missing);
    if (step) break;
  }
  return report(
    RULE_ID.joinBadStep,
    "default",
    elementId,
    factTypeName,
    step?.entry ?? missing,
    step?.exit ?? missing,
  );
}
