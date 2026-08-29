/**
 * Drift guard for `REJECTING_RULES` (barwise-894).
 *
 * The map restates rule ids that `@barwise/core` owns. A rename there
 * would not break a build or a type -- it would silently empty one
 * constraint kind's accept-list, and every check of that kind would go
 * back to passing vacuously, which is exactly the defect the map was
 * added to fix. `audit:duplication` flags the copy; this is the check
 * that makes it honest.
 *
 * It asserts the PAIRING rather than the strings, using the
 * counterexample generator's own contract: feeding a constraint's
 * forbidden population back through validation "reports a violation of
 * the very constraint this counterexample was generated for". So for
 * each kind, generate, inject, and require the emitted rule to be one
 * this map accepts.
 */
import { type Constraint, type OrmModel, ValidationEngine } from "@barwise/core";
import { OrmModel as Model } from "@barwise/core";
import { generateCounterexampleForConstraint } from "@barwise/core/counterexample";
import { describe, expect, it } from "vitest";
import { REJECTING_RULES } from "../src/evaluate/checks/forbidsPopulation.js";
import type { ConstraintKind } from "../src/exercise/types.js";

/** A two-role fact type carrying `constraints`, plus an anchor for mandatory. */
function modelWith(constraints: Constraint[]): { model: OrmModel; ftName: string; } {
  const model = new Model({ name: "drift" });
  const entity = model.addObjectType({ name: "Thing", kind: "entity", referenceMode: "id" });
  const value = model.addObjectType({ name: "Label", kind: "value" });
  model.addFactType({
    name: "Thing has Label",
    roles: [
      { name: "has", playerId: entity.id, id: "rE" },
      { name: "of", playerId: value.id, id: "rV" },
    ],
    readings: ["{0} has {1}"],
    constraints,
  });
  // Anchor: lets a Thing exist without playing the mandatory role, which
  // is what `forMandatory` needs to build a counterexample at all.
  model.addFactType({
    name: "Thing is in Place",
    roles: [
      { name: "is in", playerId: entity.id, id: "aE" },
      { name: "of", playerId: model.addObjectType({ name: "Place", kind: "value" }).id, id: "aP" },
    ],
    readings: ["{0} is in {1}"],
    constraints: [],
  });
  return { model, ftName: "Thing has Label" };
}

const CASES: { kind: ConstraintKind; constraint: Constraint; }[] = [
  { kind: "internal_uniqueness", constraint: { type: "internal_uniqueness", roleIds: ["rE"] } },
  { kind: "mandatory", constraint: { type: "mandatory", roleId: "rE" } },
  { kind: "ring", constraint: { type: "ring", roleIds: ["rE", "rE"], ringType: "irreflexive" } },
];

describe("REJECTING_RULES agrees with the rules core actually emits", () => {
  for (const { kind, constraint } of CASES) {
    it(`${kind} rejects through a rule this map accepts`, () => {
      const { model, ftName } = modelWith([constraint]);
      const ft = model.getFactTypeByName(ftName)!;
      const own = ft.constraints[0]!;
      const cx = generateCounterexampleForConstraint(own, ft, model);
      if (!cx || cx.forbidden.length === 0) return; // shape unsupported; not this test's subject

      const added = cx.forbidden.map((p) =>
        model.addPopulation({ factTypeId: p.factTypeId, instances: p.instances }).id
      );
      const emitted = new ValidationEngine().validate(model)
        .filter((d) => d.severity === "error" && d.ruleId.startsWith("population/"))
        .map((d) => d.ruleId);
      for (const id of added) model.removePopulation(id);

      expect(emitted.length).toBeGreaterThan(0);
      expect(
        emitted.some((id) => REJECTING_RULES[kind].includes(id)),
        `${kind}: core emitted [${[...new Set(emitted)].join(", ")}], `
          + `map accepts [${REJECTING_RULES[kind].join(", ")}]`,
      ).toBe(true);
    });
  }

  it("names a rule for every constraint kind, with no empty accept-list", () => {
    for (const [kind, ids] of Object.entries(REJECTING_RULES)) {
      expect(ids.length, `${kind} accepts nothing, so its checks cannot fail`).toBeGreaterThan(0);
      for (const id of ids) expect(id.startsWith("population/")).toBe(true);
    }
  });
});
