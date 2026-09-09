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
 * type 1 -- or `null` for a kind this fixture cannot express.
 *
 * A total `Record` and not a switch plus a hand-written list of kinds to
 * iterate. With the two separate, the compiler forced a new kind into
 * the classification and into the switch, but NOT into the run: a kind
 * missing from the list compiled and was silently never tested. Keyed
 * this way, a kind that compiles is a kind that runs.
 */
function constraintsByKind(
  foreign: string,
  foreign2: string,
): Record<Constraint["type"], Constraint | null> {
  const of = (kind: Constraint["type"]): Constraint | null => {
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
      // The join kinds keep their roles in path steps rather than in a
      // role-id list, so "a constraint naming a foreign role" is not a
      // state this fixture can express for them. They are classified
      // false, and `joinConstraintRules` -- not `constraintConsistency`
      // -- owns them.
      case "join_subset":
      case "join_equality":
      case "join_exclusion":
        return null;
    }
  };
  return {
    internal_uniqueness: of("internal_uniqueness"),
    external_uniqueness: of("external_uniqueness"),
    mandatory: of("mandatory"),
    disjunctive_mandatory: of("disjunctive_mandatory"),
    exclusion: of("exclusion"),
    exclusive_or: of("exclusive_or"),
    frequency: of("frequency"),
    cardinality: of("cardinality"),
    value_constraint: of("value_constraint"),
    value_comparison: of("value_comparison"),
    ring: of("ring"),
    subset: of("subset"),
    equality: of("equality"),
    join_subset: of("join_subset"),
    join_equality: of("join_equality"),
    join_exclusion: of("join_exclusion"),
  };
}

describe("requiresLocalRoles agrees with what validation reports", () => {
  const sample = twoFactTypes();
  const cases = constraintsByKind(sample.foreign, sample.foreign2);

  for (const [kind, constraint] of Object.entries(cases)) {
    if (!constraint) continue;
    it(`${kind}: classification matches the engine`, () => {
      const { model, foreign, foreign2 } = twoFactTypes();
      const fresh = constraintsByKind(foreign, foreign2)[kind as Constraint["type"]]!;
      model.factTypes[0]!.addConstraint({ ...fresh, id: `c-${kind}` } as Constraint);

      const reportsInvalidRole = new ValidationEngine().validate(model)
        .some((d) => d.ruleId.endsWith("-invalid-role"));

      expect(reportsInvalidRole).toBe(
        requiresLocalRoles({ type: kind } as Constraint),
      );
    });
  }

  it("covers every kind the fixture can express", () => {
    // Without this the loop could silently shrink to nothing if
    // `constraintsByKind` started returning null everywhere.
    const expressed = Object.values(cases).filter((c) => c !== null);
    expect(expressed).toHaveLength(13);
  });
});
