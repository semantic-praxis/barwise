/**
 * A binary mandatory or uniqueness on the role no reading names first is
 * written from the reading as given (binary-reverse-reading-verbalization.spec.md,
 * barwise-wsl). It used to slice that reading's predicate and read it
 * backwards: "Each Customer is placed by at least one Order".
 */
import { describe, expect, it } from "vitest";
import type { InternalConstraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";

/** Order (role 0) is placed by Customer (role 1), with the given readings. */
function placed(readings: string[], constraint: InternalConstraint) {
  const model = new OrmModel({ name: "Test" });
  model.addObjectType({ id: "o", name: "Order", kind: "entity", referenceMode: "nr" });
  model.addObjectType({ id: "c", name: "Customer", kind: "entity", referenceMode: "id" });
  const ft = model.addFactType({
    id: "ft",
    name: "Order is placed by Customer",
    roles: [
      { id: "ro", name: "is placed by", playerId: "o" },
      { id: "rc", name: "places", playerId: "c" },
    ],
    readings,
    constraints: [constraint],
  });
  return new ConstraintVerbalizer().verbalizeAll(ft.id, model).map((v) => v.text);
}

describe("a binary constraint on the role no reading names first", () => {
  const only = ["{0} is placed by {1}"];

  it("writes a mandatory from the reading as given", () => {
    expect(placed(only, { type: "mandatory", roleId: "rc" })).toEqual([
      "For each Customer, some Order is placed by that Customer.",
    ]);
  });

  it("writes a uniqueness from the reading as given", () => {
    expect(placed(only, { type: "internal_uniqueness", roleIds: ["rc"] })).toEqual([
      "For each Customer, at most one Order is placed by that Customer.",
    ]);
  });

  it("keeps a lead after the quantifier and after 'that'", () => {
    expect(placed(["{0} is placed by first- {1}"], { type: "mandatory", roleId: "rc" })).toEqual([
      "For each first Customer, some Order is placed by that first Customer.",
    ]);
    expect(
      placed(["online- {0} is placed by {1}"], { type: "internal_uniqueness", roleIds: ["rc"] }),
    )
      .toEqual(["For each Customer, at most one online Order is placed by that Customer."]);
  });

  it("names a repeated placeholder with 'that' after its first mention", () => {
    expect(placed(["{0} is placed by {1} for {0}"], { type: "mandatory", roleId: "rc" })).toEqual([
      "For each Customer, some Order is placed by that Customer for that Order.",
    ]);
  });

  it("numbers the players when both roles have the same one", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    const ft = model.addFactType({
      id: "ft",
      name: "Person reports to Person",
      roles: [
        { id: "r1", name: "reports to", playerId: "p" },
        { id: "r2", name: "is reported to by", playerId: "p" },
      ],
      readings: ["{0} reports to {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["r2"] }],
    });
    expect(new ConstraintVerbalizer().verbalizeAll(ft.id, model).map((v) => v.text)).toEqual([
      "For each Person2, at most one Person1 reports to that Person2.",
    ]);
  });

  it("lowercases the frame under a deontic modality", () => {
    expect(placed(only, { type: "mandatory", roleId: "rc", modality: "deontic" })).toEqual([
      "It is obligatory that for each Customer, some Order is placed by that Customer.",
    ]);
  });

  it("still opens with 'Each' when a reading names the role first", () => {
    const both = ["{0} is placed by {1}", "{1} places {0}"];
    expect(placed(both, { type: "mandatory", roleId: "rc" })).toEqual([
      "Each Customer places at least one Order.",
    ]);
    expect(placed(both, { type: "internal_uniqueness", roleIds: ["rc"] })).toEqual([
      "Each Customer places at most one Order.",
    ]);
  });

  it("keeps the forward sentence for the role the only reading names first", () => {
    expect(placed(only, { type: "mandatory", roleId: "ro" })).toEqual([
      "Each Order is placed by at least one Customer.",
    ]);
    expect(placed(only, { type: "internal_uniqueness", roleIds: ["ro"] })).toEqual([
      "Each Order is placed by at most one Customer.",
    ]);
  });
});
