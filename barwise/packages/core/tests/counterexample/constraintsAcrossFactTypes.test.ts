/**
 * Counterexamples over constraints across fact types (orm-format-3, Open
 * decision 9, WS3a-ii-c). A counterexample names the fact types its
 * constraint applies to, not the one a 2.0 file nests it under; the whole
 * model gives each constraint one counterexample whichever fact type nests
 * it; and a subset or equality within one fact type gets a witness, as the
 * validator checks it (barwise-0od).
 */
import { describe, expect, it } from "vitest";
import {
  generateCounterexampleForConstraint,
  generateCounterexamples,
} from "../../src/counterexample/CounterexampleGenerator.js";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { counterexampleRoundTripFailure } from "../helpers/counterexampleRules.js";

/**
 * Person drives Car, Person rides Bus, Person walks in Park. The constraint
 * given is nested under `host`, which may be a fact type it does not touch.
 */
function commute(host: "ft-drives" | "ft-rides" | "ft-walks", c: Constraint): OrmModel {
  const model = new OrmModel({ name: "Commute" });
  for (
    const [id, name] of [["ot-person", "Person"], ["ot-car", "Car"], ["ot-bus", "Bus"], [
      "ot-park",
      "Park",
    ]] as const
  ) {
    model.addObjectType({ id, name, kind: "entity", referenceMode: "id" });
  }
  const fact = (id: string, name: string, verb: string, other: string, n: number) =>
    model.addFactType({
      id,
      name,
      roles: [
        { id: `r-${n}a`, name: verb, playerId: "ot-person" },
        { id: `r-${n}b`, name: `is ${verb} by`, playerId: other },
      ],
      readings: [`{0} ${verb} {1}`],
      constraints: host === id ? [c] : [],
    });
  fact("ft-drives", "Person drives Car", "drives", "ot-car", 1);
  fact("ft-rides", "Person rides Bus", "rides", "ot-bus", 2);
  fact("ft-walks", "Person walks in Park", "walks in", "ot-park", 3);
  return model;
}

const EXCL: Constraint = { id: "c-excl", type: "exclusion", roleIds: ["r-1a", "r-2a"] };

describe("counterexamples over constraints across fact types", () => {
  it("names the fact types the constraint applies to, whichever fact type nests it", () => {
    for (const host of ["ft-drives", "ft-rides", "ft-walks"] as const) {
      const ces = generateCounterexamples(commute(host, EXCL));
      expect(ces.map((c) => [c.constraintId, c.factTypeIds]), host).toEqual([
        ["c-excl", ["ft-drives", "ft-rides"]],
      ]);
    }
  });

  it("ignores the fact type it is handed for a constraint across fact types", () => {
    const model = commute("ft-walks", EXCL);
    const walks = model.getFactType("ft-walks")!;
    const drives = model.getFactType("ft-drives")!;
    const viaWalks = generateCounterexampleForConstraint(EXCL, walks, model);
    const viaDrives = generateCounterexampleForConstraint(EXCL, drives, model);
    expect(viaWalks?.factTypeIds).toEqual(["ft-drives", "ft-rides"]);
    // Populations mint their own ids, so compare what they hold.
    const held = (ce: typeof viaWalks) => ({
      ...ce,
      forbidden: ce?.forbidden.map((p) => [p.factTypeId, p.instances.map((i) => i.roleValues)]),
    });
    expect(held(viaWalks)).toEqual(held(viaDrives));
  });

  it("lists each fact type's own constraints first, then those across fact types, as query does", () => {
    const model = commute("ft-drives", EXCL);
    model.getFactType("ft-drives")!.addConstraint({
      id: "c-uc",
      type: "internal_uniqueness",
      roleIds: ["r-1a"],
    });
    expect(generateCounterexamples(model).map((c) => c.constraintId)).toEqual(["c-uc", "c-excl"]);
  });

  it("names an internal constraint's own fact type", () => {
    const uc: Constraint = { id: "c-uc", type: "internal_uniqueness", roleIds: ["r-3a"] };
    const ces = generateCounterexamples(commute("ft-walks", uc));
    expect(ces.map((c) => [c.constraintId, c.factTypeIds])).toEqual([["c-uc", ["ft-walks"]]]);
  });
});

/** One binary fact type, Person mentors Person, nesting the constraint given. */
function reviews(c: (ft: string) => Constraint): OrmModel {
  const model = new OrmModel({ name: "Reviews" });
  model.addObjectType({ id: "ot-person", name: "Person", kind: "entity", referenceMode: "id" });
  model.addFactType({
    id: "ft-pair",
    name: "Person mentors Person",
    roles: [
      { id: "r-mentor", name: "mentors", playerId: "ot-person" },
      { id: "r-mentee", name: "is mentored by", playerId: "ot-person" },
    ],
    readings: ["{0} mentors {1}"],
    constraints: [c("ft-pair")],
  });
  return model;
}

describe("subset and equality within one fact type (barwise-0od)", () => {
  it("gives a local subset a witness that trips the subset rule", () => {
    const model = reviews(() => ({
      id: "c-sub",
      type: "subset",
      subsetRoleIds: ["r-mentor"],
      supersetRoleIds: ["r-mentee"],
    }));
    const ces = generateCounterexamples(model);
    expect(ces.map((c) => [c.constraintId, c.factTypeIds])).toEqual([["c-sub", ["ft-pair"]]]);
    expect(counterexampleRoundTripFailure(model)).toBeUndefined();
  });

  it("gives a local equality a witness that trips the equality rule", () => {
    const model = reviews(() => ({
      id: "c-eq",
      type: "equality",
      roleIds1: ["r-mentor"],
      roleIds2: ["r-mentee"],
    }));
    expect(generateCounterexamples(model).map((c) => c.constraintId)).toEqual(["c-eq"]);
    expect(counterexampleRoundTripFailure(model)).toBeUndefined();
  });

  it("finds a witness when a value constraint makes the first choice collide", () => {
    // RoomCode admits x and y on one role and only x on the other, so the
    // first values minted for the two sides are the same, x.
    const model = new OrmModel({ name: "Codes" });
    model.addObjectType({ id: "ot-code", name: "Code", kind: "value" });
    model.addFactType({
      id: "ft-maps",
      name: "Code maps to Code",
      roles: [
        { id: "r-from", name: "maps to", playerId: "ot-code" },
        { id: "r-to", name: "is mapped from", playerId: "ot-code" },
      ],
      readings: ["{0} maps to {1}"],
      constraints: [
        { id: "vc-from", type: "value_constraint", roleId: "r-from", values: ["x", "y"] },
        { id: "vc-to", type: "value_constraint", roleId: "r-to", values: ["x"] },
        { id: "c-sub", type: "subset", subsetRoleIds: ["r-from"], supersetRoleIds: ["r-to"] },
      ],
    });
    expect(generateCounterexamples(model).map((c) => c.constraintId)).toContain("c-sub");
    expect(counterexampleRoundTripFailure(model)).toBeUndefined();
  });

  it("finds a witness when the two sequences share only some roles", () => {
    const model = new OrmModel({ name: "Referrals" });
    model.addObjectType({ id: "ot-emp", name: "Emp", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "ot-person", name: "Person", kind: "entity", referenceMode: "id" });
    model.addFactType({
      id: "ft-recommends",
      name: "Emp recommends Person to Person",
      roles: [
        { id: "r-1", name: "recommends", playerId: "ot-emp" },
        { id: "r-2", name: "is recommended", playerId: "ot-person" },
        { id: "r-3", name: "is recommended to", playerId: "ot-person" },
      ],
      readings: ["{0} recommends {1} to {2}"],
      constraints: [
        {
          id: "c-sub",
          type: "subset",
          subsetRoleIds: ["r-1", "r-2"],
          supersetRoleIds: ["r-1", "r-3"],
        },
      ],
    });
    expect(generateCounterexamples(model).map((c) => c.constraintId)).toEqual(["c-sub"]);
    expect(counterexampleRoundTripFailure(model)).toBeUndefined();
  });

  it("gives none when the two sequences are the same roles", () => {
    const model = reviews(() => ({
      id: "c-self",
      type: "subset",
      subsetRoleIds: ["r-mentor"],
      supersetRoleIds: ["r-mentor"],
    }));
    expect(generateCounterexamples(model)).toEqual([]);
  });
});
