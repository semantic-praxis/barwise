/**
 * Validation of constraints across fact types (orm-format-3, Open decision
 * 9, WS3a-ii-b). A diagnostic about such a constraint is located by the
 * constraint's own id and names the fact types it spans, and the whole
 * result is the same whichever fact type a 2.0 file nests the constraint
 * under -- the property the host fallacy broke.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import type { Diagnostic } from "../../src/validation/Diagnostic.js";
import { RULE_ID } from "../../src/validation/ruleId.js";
import { spanPhrase } from "../../src/validation/span.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

/**
 * Room is in Building, Room has RoomNumber, Room has Area. The constraints
 * across fact types are malformed or violated on purpose, and `host` picks
 * the fact type that nests them, as a 2.0 file might.
 */
function rooms(host: "ft-in" | "ft-nr" | "ft-area"): OrmModel {
  const across: Constraint[] = [
    // Too few roles: spans only "Room is in Building".
    { id: "c-excl-one", type: "exclusion", roleIds: ["r-1"] },
    // Arity mismatch across two fact types.
    {
      id: "c-subset",
      type: "subset",
      subsetRoleIds: ["r-1"],
      supersetRoleIds: ["r-3", "r-4"],
    },
    // Every role in "Room has RoomNumber": an internal uniqueness would do.
    { id: "c-ext-local", type: "external_uniqueness", roleIds: ["r-3", "r-4"] },
    // Well formed, and violated by the population below: both roles of one
    // fact type, so checked against that fact type's population.
    { id: "c-excl-local", type: "exclusion", roleIds: ["r-3", "r-4"] },
    // The only constraint touching "Room has Area".
    { id: "c-in-or-area", type: "disjunctive_mandatory", roleIds: ["r-1", "r-5"] },
  ];
  const model = new OrmModel({ name: "Facilities" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({
    id: "ot-building",
    name: "Building",
    kind: "entity",
    referenceMode: "code",
  });
  model.addObjectType({
    id: "ot-nr",
    name: "RoomNumber",
    kind: "value",
    dataType: { name: "text" },
  });
  model.addObjectType({
    id: "ot-area",
    name: "Area",
    kind: "value",
    dataType: { name: "integer" },
  });
  const nested = (ftId: string) => (host === ftId ? across : []);
  model.addFactType({
    id: "ft-in",
    name: "Room is in Building",
    roles: [
      { id: "r-1", name: "is in", playerId: "ot-room" },
      { id: "r-2", name: "houses", playerId: "ot-building" },
    ],
    readings: ["{0} is in {1}"],
    constraints: [
      { id: "c-one-building", type: "internal_uniqueness", roleIds: ["r-1"] },
      ...nested("ft-in"),
    ],
  });
  model.addFactType({
    id: "ft-nr",
    name: "Room has RoomNumber",
    roles: [
      { id: "r-3", name: "has", playerId: "ot-room" },
      { id: "r-4", name: "is of", playerId: "ot-nr" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { id: "c-one-nr", type: "internal_uniqueness", roleIds: ["r-3"] },
      ...nested("ft-nr"),
    ],
  });
  model.addFactType({
    id: "ft-area",
    name: "Room has Area",
    roles: [
      { id: "r-5", name: "has", playerId: "ot-room" },
      { id: "r-6", name: "is of", playerId: "ot-area" },
    ],
    readings: ["{0} has {1}"],
    constraints: nested("ft-area"),
  });
  const pop = model.addPopulation({ id: "pop-nr", factTypeId: "ft-nr" });
  pop.addInstance({ id: "i-1", roleValues: { "r-3": "X", "r-4": "X" } });
  return model;
}

const validate = (m: OrmModel) => new ValidationEngine().validate(m);

/** Order-free comparison: the order of `model.constraints` is still file order. */
const sorted = (ds: Diagnostic[]) =>
  ds.map((d) => `${d.ruleId}|${d.elementId}|${d.severity}|${d.message}`).sort();

describe("validating constraints across fact types", () => {
  it("gives the same diagnostics whichever fact type nests them", () => {
    const fromIn = sorted(validate(rooms("ft-in")));
    expect(sorted(validate(rooms("ft-nr")))).toEqual(fromIn);
    expect(sorted(validate(rooms("ft-area")))).toEqual(fromIn);
  });

  it("locates each by its own id and names the fact types it spans", () => {
    const ds = validate(rooms("ft-area"));
    const byRule = (ruleId: string) => ds.filter((d) => d.ruleId === ruleId);

    expect(byRule(RULE_ID.exclusionTooFewRoles)).toEqual([
      expect.objectContaining({
        elementId: "c-excl-one",
        message:
          `Exclusion constraint over fact type "Room is in Building" must reference at least 2 roles.`,
      }),
    ]);
    expect(byRule(RULE_ID.subsetArityMismatch)).toEqual([
      expect.objectContaining({
        elementId: "c-subset",
        message:
          `Subset constraint over fact types "Room is in Building" and "Room has RoomNumber" has mismatched role sequence lengths: subset has 1 roles, superset has 2 roles.`,
      }),
    ]);
  });

  it("warns that an external uniqueness is all local when its roles sit in a fact type other than the one nesting it", () => {
    // Nested under "Room is in Building", over roles of "Room has RoomNumber":
    // the host-relative check never fired here.
    const ds = validate(rooms("ft-in")).filter((d) =>
      d.ruleId === RULE_ID.externalUniquenessAllLocal
    );
    expect(ds).toEqual([
      expect.objectContaining({
        elementId: "c-ext-local",
        message:
          `External uniqueness constraint over fact type "Room has RoomNumber" references only roles within that fact type. Consider using internal uniqueness instead.`,
      }),
    ]);
  });

  it("checks an exclusion across the population, nested anywhere", () => {
    for (const host of ["ft-in", "ft-nr", "ft-area"] as const) {
      const ds = validate(rooms(host)).filter((d) => d.ruleId === RULE_ID.exclusionViolation);
      expect(ds, host).toHaveLength(1);
    }
  });

  it("counts a constraint across fact types for the fact types it touches, not for its host", () => {
    for (const host of ["ft-in", "ft-nr", "ft-area"] as const) {
      const without = validate(rooms(host))
        .filter((d) => d.ruleId === RULE_ID.factTypeWithoutConstraints)
        .map((d) => d.elementId);
      // "Room has Area" has no constraint of its own, but the disjunctive
      // mandatory touches it.
      expect(without, host).toEqual([]);
    }
  });
});

describe("a constraint across fact types with no roles", () => {
  it("draws no population violation from every fact type's population", () => {
    // Only a model built in code can hold one: the schema refuses it on load.
    const model = rooms("ft-in");
    model.getFactType("ft-in")!.addConstraint({
      id: "c-xor-empty",
      type: "exclusive_or",
      roleIds: [],
    });
    const ds = validate(model).filter((d) => d.ruleId === RULE_ID.exclusiveOrViolation);
    expect(ds).toEqual([]);
  });
});

describe("a constraint across fact types naming a role no fact type has", () => {
  it("is reported against its own id and span, whichever fact type nests it", () => {
    for (const host of ["ft-in", "ft-nr", "ft-area"] as const) {
      const model = rooms(host);
      model.getFactType(host)!.addConstraint({
        id: "c-excl-gone",
        type: "exclusion",
        roleIds: ["r-1", "r-gone"],
      });
      // Every diagnostic naming the dangling id, so a second report under a
      // borrowed internal kind's id would show here too.
      const ds = validate(model).filter((d) => d.message.includes('"r-gone"'));
      expect(ds, host).toEqual([
        expect.objectContaining({
          ruleId: RULE_ID.acrossFactTypesUnknownRole,
          elementId: "c-excl-gone",
          message:
            `Exclusion constraint over fact type "Room is in Building" references role id "r-gone", which no fact type in the model has.`,
        }),
      ]);
    }
  });

  it("names each kind by its own label, wherever in the constraint the dangling id sits", () => {
    const cases: [string, Constraint][] = [
      ["External uniqueness", {
        id: "c",
        type: "external_uniqueness",
        roleIds: ["r-1", "r-gone"],
      }],
      ["Disjunctive mandatory", {
        id: "c",
        type: "disjunctive_mandatory",
        roleIds: ["r-1", "r-gone"],
      }],
      ["Exclusion", { id: "c", type: "exclusion", roleIds: ["r-1", "r-gone"] }],
      ["Exclusive-or", { id: "c", type: "exclusive_or", roleIds: ["r-1", "r-gone"] }],
      ["Subset", { id: "c", type: "subset", subsetRoleIds: ["r-1"], supersetRoleIds: ["r-gone"] }],
      ["Equality", { id: "c", type: "equality", roleIds1: ["r-1"], roleIds2: ["r-gone"] }],
    ];
    for (const [label, constraint] of cases) {
      const model = rooms("ft-nr");
      model.getFactType("ft-nr")!.addConstraint(constraint);
      const ds = validate(model).filter((d) => d.ruleId === RULE_ID.acrossFactTypesUnknownRole);
      expect(ds.map((d) => d.message), label).toEqual([
        `${label} constraint over fact type "Room is in Building" references role id "r-gone", which no fact type in the model has.`,
      ]);
    }
  });

  it("names no span when none of its roles resolve", () => {
    const model = rooms("ft-in");
    model.getFactType("ft-in")!.addConstraint({
      id: "c-excl-lost",
      type: "exclusion",
      roleIds: ["r-gone", "r-lost"],
    });
    const ds = validate(model).filter((d) => d.ruleId === RULE_ID.acrossFactTypesUnknownRole);
    expect(ds.map((d) => [d.elementId, d.message])).toEqual(
      ["r-gone", "r-lost"].map((id) => [
        "c-excl-lost",
        `Exclusion constraint references role id "${id}", which no fact type in the model has; none of its roles resolve.`,
      ]),
    );
  });

  it("leaves an internal constraint's dangling role under its own fact type's template", () => {
    const model = rooms("ft-in");
    model.getFactType("ft-nr")!.addConstraint({ id: "c-m", type: "mandatory", roleId: "r-gone" });
    const ds = validate(model).filter((d) => d.ruleId === RULE_ID.mandatoryInvalidRole);
    expect(ds).toEqual([
      expect.objectContaining({
        elementId: "ft-nr",
        message:
          `Mandatory constraint in fact type "Room has RoomNumber" references role id "r-gone" which does not belong to this fact type.`,
      }),
    ]);
  });
});

describe("spanPhrase", () => {
  it("names one, two and more fact types in the order given", () => {
    expect(spanPhrase([])).toBe("no fact type in the model");
    expect(spanPhrase(["A"])).toBe(`fact type "A"`);
    expect(spanPhrase(["A", "B"])).toBe(`fact types "A" and "B"`);
    expect(spanPhrase(["A", "B", "C"])).toBe(`fact types "A", "B" and "C"`);
  });
});
