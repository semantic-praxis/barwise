/**
 * `requiresLocalRoles` must agree with what validation actually reports.
 *
 * The classification now has two consumers -- `ConstraintVerbalizer`
 * reads it to decide whether a non-local role is a defect, and
 * `constraintConsistency` encodes the same judgement in its per-kind
 * switch. That is a must-agree pair, and the repo's rule is that such a
 * pair is shared, derived, registered, or drift-tested in the same
 * commit that creates it. Sharing was the first choice and does not fit:
 * `constraintConsistency` needs a different rule id per kind, not a
 * boolean, so it cannot call this and stay one switch.
 *
 * So this is the drift test, and it is empirical rather than a second
 * list: for every constraint kind, it plants a role id that belongs to
 * another fact type and asks the engine whether that is an error. If the
 * two ever disagree, the verbalizer would either call a correct
 * cross-fact-type constraint malformed, or phrase a sentence around an
 * id the fact type does not have.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { requiresLocalRoles } from "../../src/model/Constraint.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/** Two binary fact types, so the second's roles are foreign to the first. */
function twoFactTypes(): { model: OrmModel; foreign: string; foreign2: string; } {
  const model = new ModelBuilder("Drift")
    .withEntityType("Customer")
    .withValueType("Name")
    .withValueType("Code")
    .withBinaryFactType("Customer has Name", {
      role1: { player: "Customer", name: "has" },
      role2: { player: "Name", name: "is of" },
    })
    .withBinaryFactType("Customer has Code", {
      role1: { player: "Customer", name: "has code" },
      role2: { player: "Code", name: "is code of" },
    })
    .build();
  return {
    model,
    foreign: model.factTypes[1]!.roles[0]!.id,
    foreign2: model.factTypes[1]!.roles[1]!.id,
  };
}

/**
 * One constraint of each kind, on fact type 0, naming role(s) of fact
 * type 1. Exhaustive over the union with no default arm, so a kind added
 * later must be given a case here as well as a row in the classification.
 */
function constraintOfKind(
  kind: Constraint["type"],
  foreign: string,
  foreign2: string,
): Constraint {
  switch (kind) {
    case "internal_uniqueness":
      return { type: kind, roleIds: [foreign] };
    case "external_uniqueness":
      return { type: kind, roleIds: [foreign, foreign2] };
    case "mandatory":
      return { type: kind, roleId: foreign };
    case "disjunctive_mandatory":
      return { type: kind, roleIds: [foreign, foreign2] };
    case "exclusion":
      return { type: kind, roleIds: [foreign, foreign2] };
    case "exclusive_or":
      return { type: kind, roleIds: [foreign, foreign2] };
    case "frequency":
      return { type: kind, roleIds: [foreign], min: 1, max: 2 };
    case "cardinality":
      return { type: kind, roleId: foreign, min: 0, max: 1 };
    case "value_constraint":
      return { type: kind, roleId: foreign, allowedValues: ["A"] };
    case "value_comparison":
      return { type: kind, roleId1: foreign, roleId2: foreign2, operator: "=" };
    case "ring":
      return { type: kind, roleId1: foreign, roleId2: foreign2, ringType: "irreflexive" };
    case "subset":
      return { type: kind, subsetRoleIds: [foreign], supersetRoleIds: [foreign2] };
    case "equality":
      return { type: kind, roleIds1: [foreign], roleIds2: [foreign2] };
    case "join_subset":
      return {
        type: kind,
        subset: { path: { root: "x", steps: [] }, projection: [0] },
        superset: { path: { root: "x", steps: [] }, projection: [0] },
      };
    case "join_equality":
    case "join_exclusion":
      return {
        type: kind,
        operands: [
          { path: { root: "x", steps: [] }, projection: [0] },
          { path: { root: "x", steps: [] }, projection: [0] },
        ],
      };
  }
}

const KINDS: readonly Constraint["type"][] = [
  "internal_uniqueness",
  "external_uniqueness",
  "mandatory",
  "disjunctive_mandatory",
  "exclusion",
  "exclusive_or",
  "frequency",
  "cardinality",
  "value_constraint",
  "value_comparison",
  "ring",
  "subset",
  "equality",
];

describe("requiresLocalRoles agrees with what validation reports", () => {
  // The join kinds are excluded: their roles live in path steps rather
  // than in a role-id list, so "a foreign role" is not a state this
  // fixture can express for them. They are classified false, and
  // `joinConstraintRules` -- not `constraintConsistency` -- owns them.
  for (const kind of KINDS) {
    it(`${kind}: classification matches the engine`, () => {
      const { model, foreign, foreign2 } = twoFactTypes();
      model.factTypes[0]!.addConstraint({
        ...constraintOfKind(kind, foreign, foreign2),
        id: `c-${kind}`,
      } as Constraint);

      const reportsInvalidRole = new ValidationEngine().validate(model)
        .some((d) => d.ruleId.endsWith("-invalid-role"));

      expect(reportsInvalidRole).toBe(requiresLocalRoles({ type: kind } as Constraint));
    });
  }
});
