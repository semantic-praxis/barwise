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
 * Every id below but one already existed and was emitted by a rule that
 * resolved the reference itself, because a diagnostic id is a promise to
 * whoever reads validator output, and moving WHERE a check runs must not
 * change WHAT a consumer sees. The exception is `acrossFactTypesUnknownRole`
 * (orm-format-3 WS3a-ii-c): a dangling role on a constraint across fact
 * types used to borrow an internal kind's id and template, which named the
 * fact type a 2.0 file nested it under and, for an exclusion, subset or
 * equality, the wrong kind. That message was wrong rather than merely
 * moved, so it changed deliberately.
 *
 * One multiplicity difference is deliberate. `joinConstraintRules`
 * walked a path and gave up at the first bad hop, so a path with two
 * dangling steps produced one diagnostic; the graph enumerates
 * references rather than walking, so it produces two. Each is identical
 * to the one the old rule would have given for that hop alone. Reporting
 * the second is an improvement, but it is still a change, so it is
 * stated here rather than discovered.
 */

import type { ExternalConstraint, InternalConstraint, JoinOperand } from "../model/Constraint.js";
import { joinOperandsOf } from "../model/Constraint.js";
import type { UnresolvedReference } from "../model/graph.js";
import { objectificationRef } from "../model/ObjectifiedFactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { RolePathStep } from "../model/RolePath.js";
import { subtypeFactRef } from "../model/SubtypeFact.js";
import type { Diagnostic } from "./Diagnostic.js";
import { report, RULE_ID } from "./ruleId.js";
import { constraintElementId, constraintSpan, spanPhrase } from "./span.js";

/** The constraint kinds whose role references live in a join path. */
type JoinConstraintType = "join_subset" | "join_equality" | "join_exclusion" | "join_ring";

/**
 * The invalid-role ids, every one of which renders from (factTypeName,
 * roleId). Naming the union rather than widening to every rule id keeps
 * `report` type-checked where the map is read.
 */
type InvalidRoleRuleId =
  | typeof RULE_ID.internalUniquenessInvalidRole
  | typeof RULE_ID.mandatoryInvalidRole
  | typeof RULE_ID.frequencyInvalidRole
  | typeof RULE_ID.cardinalityInvalidRole
  | typeof RULE_ID.valueConstraintInvalidRole
  | typeof RULE_ID.valueComparisonInvalidRole
  | typeof RULE_ID.ringInvalidRole;

/**
 * The rule id for a dangling role reference on an internal constraint, by
 * kind. Each renders from (factTypeName, roleId): an internal constraint
 * lives in one fact type, and the message names it.
 *
 * A total `Record` rather than a switch with a default arm: a constraint
 * kind added later fails to compile here until it is given an id,
 * instead of silently reporting under someone else's.
 */
const CONSTRAINT_INVALID_ROLE: Record<InternalConstraint["type"], InvalidRoleRuleId> = {
  internal_uniqueness: RULE_ID.internalUniquenessInvalidRole,
  mandatory: RULE_ID.mandatoryInvalidRole,
  frequency: RULE_ID.frequencyInvalidRole,
  cardinality: RULE_ID.cardinalityInvalidRole,
  value_constraint: RULE_ID.valueConstraintInvalidRole,
  value_comparison: RULE_ID.valueComparisonInvalidRole,
  ring: RULE_ID.ringInvalidRole,
};

/**
 * How `acrossFactTypesUnknownRole` names each kind of constraint across fact types, by
 * kind. These reported under the internal kinds' templates until
 * orm-format-3 WS3a-ii-c, which named the fact type a 2.0 file nested
 * them under and the wrong kind ("Internal uniqueness constraint in fact
 * type ..." for an exclusion). The join kinds are excluded because their
 * references are reported per hop, not per role -- see
 * `joinStepDiagnostic`.
 */
const EXTERNAL_KIND_LABEL: Record<
  Exclude<ExternalConstraint["type"], JoinConstraintType>,
  string
> = {
  external_uniqueness: "External uniqueness",
  disjunctive_mandatory: "Disjunctive mandatory",
  exclusion: "Exclusion",
  exclusive_or: "Exclusive-or",
  subset: "Subset",
  equality: "Equality",
};

/** Diagnostics for every reference `graphOf` could not resolve. */
export function referenceDiagnostics(
  model: OrmModel,
  unresolved: readonly UnresolvedReference[],
): Diagnostic[] {
  return unresolved.map((u) => diagnosticFor(model, u));
}

function diagnosticFor(model: OrmModel, u: UnresolvedReference): Diagnostic {
  switch (u.from.kind) {
    case "role":
      // Two different findings share this source: a role whose player
      // does not exist, and a role whose own id is already taken. The
      // second is new -- the graph is the first thing that needed role
      // ids to be unique -- so it gets its own id and message rather
      // than borrowing one that would report the wrong thing.
      return report(
        u.field === "id" ? RULE_ID.duplicateRoleId : RULE_ID.danglingRoleReference,
        "default",
        u.from.factType.id,
        u.from.role.name,
        u.from.factType.name,
        u.missing,
      );
    case "constraint": {
      const { constraint, factType } = u.from;
      // A join operand's path root is its own finding, distinct from a
      // dangling hop.
      if (u.field === "path.root") {
        return report(
          RULE_ID.joinUnknownRoot,
          "default",
          constraintElementId(constraint),
          constraintSpan(model, constraint),
          u.missing,
        );
      }
      // Narrowed on the kind rather than on `joinOperandsOf(...).length`,
      // which reads the same and is not: a `join_equality` declaring no
      // operands would take the second branch, and the `Record` has no
      // entry for it. That is a cast away from `report(undefined, ...)`
      // for a state `joinTooFewOperands` already reports.
      if (
        constraint.type === "join_subset"
        || constraint.type === "join_equality"
        || constraint.type === "join_exclusion"
        || constraint.type === "join_ring"
      ) {
        return joinStepDiagnostic(
          joinOperandsOf(constraint),
          constraintElementId(constraint),
          constraintSpan(model, constraint),
          u.missing,
        );
      }
      if (u.field === "subtypeFactIds") {
        return report(
          RULE_ID.subtypeConstraintUnknownSubtypeFact,
          "default",
          constraintElementId(constraint),
          // Only the three kinds with a subtype operand reach here.
          EXTERNAL_KIND_LABEL[constraint.type as keyof typeof EXTERNAL_KIND_LABEL],
          u.missing,
        );
      }
      if (factType === undefined) {
        const kind = EXTERNAL_KIND_LABEL[constraint.type];
        const held = model.factTypesOf(constraint);
        return held.length === 0
          ? report(
            RULE_ID.acrossFactTypesUnknownRole,
            "noSpan",
            constraintElementId(constraint),
            kind,
            u.missing,
          )
          : report(
            RULE_ID.acrossFactTypesUnknownRole,
            "default",
            constraintElementId(constraint),
            kind,
            spanPhrase(held.map((ft) => ft.name)),
            u.missing,
          );
      }
      return report(
        CONSTRAINT_INVALID_ROLE[constraint.type],
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
        subtypeFactRef(u.from.subtypeFact),
        u.missing,
      );
    case "objectifiedFactType":
      return report(
        u.field === "factTypeId"
          ? RULE_ID.objectifiedDanglingFactType
          : RULE_ID.objectifiedDanglingObjectType,
        "default",
        objectificationRef(u.from.objectifiedFactType),
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
  span: string,
  missing: string,
): Diagnostic {
  let step: RolePathStep | undefined;
  for (const operand of operands) {
    step = operand.path.steps.find((s) => s.entry === missing || s.exit === missing);
    if (step) break;
  }
  // The search cannot miss: `roleIdsOf` derives a join constraint's role
  // ids from these same steps, so an id the graph could not resolve came
  // from one of them. Naming the missing id twice is what the old rule
  // did for a step it could not resolve at all, so the degraded form is
  // the old form rather than something new to read.
  return report(
    RULE_ID.joinBadStep,
    "default",
    elementId,
    span,
    step?.entry ?? missing,
    step?.exit ?? missing,
  );
}
