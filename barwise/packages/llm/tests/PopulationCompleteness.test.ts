/**
 * A population instance must be able to fill every role, and then must
 * actually fill it
 * (docs/specs/population-instance-completeness.spec.md).
 *
 * Two defects, and the second is the one worth reading about.
 *
 * `population/incomplete-instance` is an **error** in the validator and
 * conformance never checked it, so an instance short a role value cost
 * 0.1 -- the fourth instance of the class barwise-826 named.
 *
 * Underneath that, one whole class of fact type could not comply at all.
 * `parsePopulations` resolved `role_values` keys by player name only and
 * took `rolesForPlayer(...)[0]`, so on `Employee mentors Employee` --
 * both roles played by `Employee` -- a JSON object cannot carry the key
 * twice, and naming the roles instead failed to resolve. Neither
 * spelling could produce a valid population, which made every ring and
 * self-referencing fact type structurally incapable of carrying an
 * example. No prompt text could have fixed that; the model was being
 * asked for something the parser would not accept.
 */
import { ValidationEngine } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parseDraftModel } from "../src/DraftModelParser.js";
import { enforceConformance } from "../src/ExtractionConformance.js";
import type { ExtractionResponse } from "../src/ExtractionTypes.js";

const REF = [{ lines: [1, 2] as [number, number], excerpt: "test" }];

/** A self-referencing binary -- the shape that could not be populated. */
function selfReferencing(
  roleValues: ReadonlyArray<Readonly<Record<string, string>>>,
): ExtractionResponse {
  return {
    object_types: [{ name: "Employee", kind: "entity", source_references: REF }],
    fact_types: [{
      name: "Employee mentors Employee",
      reading: "Employee mentors Employee",
      roles: [
        { player: "Employee", role_name: "mentors" },
        { player: "Employee", role_name: "is mentored by" },
      ],
      source_references: REF,
    }],
    subtypes: [],
    inferred_constraints: [],
    ambiguities: [],
    populations: [{
      fact_type: "Employee mentors Employee",
      description: "Alice mentors Bob",
      instances: roleValues.map((rv) => ({ role_values: { ...rv } })),
      source_references: REF,
    }],
  };
}

/** An ordinary ternary, every role played by a different object type. */
function ternary(roleValues: Readonly<Record<string, string>>): ExtractionResponse {
  return {
    object_types: [
      { name: "Shipment", kind: "entity", source_references: REF },
      { name: "Product", kind: "entity", source_references: REF },
      { name: "Quantity", kind: "value", source_references: REF },
    ],
    fact_types: [{
      name: "Shipment contains Product in Quantity",
      reading: "Shipment contains Product in Quantity",
      roles: [
        { player: "Shipment", role_name: "contains" },
        { player: "Product", role_name: "is contained in" },
        { player: "Quantity", role_name: "is the quantity for" },
      ],
      source_references: REF,
    }],
    subtypes: [],
    inferred_constraints: [],
    ambiguities: [],
    populations: [{
      fact_type: "Shipment contains Product in Quantity",
      description: "one line",
      instances: [{ role_values: { ...roleValues } }],
      source_references: REF,
    }],
  };
}

describe("a self-referencing fact type can carry a population", () => {
  it("resolves both roles when the instance names them by role name", () => {
    const { response, corrections } = enforceConformance(
      selfReferencing([{ "mentors": "Alice", "is mentored by": "Bob" }]),
    );
    const { model } = parseDraftModel(response, "SelfRef");
    const instances = model.populations.flatMap((p) => p.instances);

    expect(corrections).toEqual([]);
    expect(instances).toHaveLength(1);

    // Two DISTINCT roles, which is the assertion that matters. The bug
    // was `rolesForPlayer(...)[0]` returning the same role for every
    // key, and asserting "two entries" would pass on that too, since
    // roleValues is keyed by role id and the second write would simply
    // overwrite the first.
    const roleIds = Object.keys(instances[0]!.roleValues);
    expect(roleIds).toHaveLength(2);
    expect(new Set(roleIds).size).toBe(2);
  });

  it("produces no validation error, end to end", () => {
    const { response } = enforceConformance(
      selfReferencing([{ "mentors": "Alice", "is mentored by": "Bob" }]),
    );
    const { model } = parseDraftModel(response, "SelfRef");

    const errors = new ValidationEngine().validate(model)
      .filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("keeps the values with the roles the instance named", () => {
    // Order matters: naming the inverse role first must not silently
    // transpose the fact. A resolver that consumed roles positionally
    // rather than by name would pass every test above and still record
    // that Bob mentors Alice.
    const { response } = enforceConformance(
      selfReferencing([{ "is mentored by": "Bob", "mentors": "Alice" }]),
    );
    const { model } = parseDraftModel(response, "SelfRef");
    const ft = model.factTypes[0]!;
    const inst = model.populations.flatMap((p) => p.instances)[0]!;

    const mentors = ft.roles.find((r) => r.name === "mentors")!;
    const mentored = ft.roles.find((r) => r.name === "is mentored by")!;
    expect(inst.roleValues[mentors.id]).toBe("Alice");
    expect(inst.roleValues[mentored.id]).toBe("Bob");
  });
});

describe("an instance that cannot fill every role", () => {
  it("is dropped, charging a correction rather than a validation error", () => {
    // The player-name spelling on a self-referencing fact type: a JSON
    // object cannot carry "Employee" twice, so one role is unfillable.
    const { response, corrections } = enforceConformance(
      selfReferencing([{ "Employee": "Alice" }]),
    );
    const { model } = parseDraftModel(response, "Incomplete");

    expect(corrections.filter((c) => c.category === "incomplete_instance")).toHaveLength(1);
    const errors = new ValidationEngine().validate(model)
      .filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("charges once, not twice, when dropping empties the population", () => {
    // The instance correction already names the defect; an empty
    // population is our own consequence, not a second thing the
    // extraction did wrong. Charging both would price one defect at
    // 0.04.
    const { response, corrections } = enforceConformance(
      selfReferencing([{ "Employee": "Alice" }]),
    );

    expect(corrections).toHaveLength(1);
    expect(response.populations ?? []).toEqual([]);
  });

  it("drops only the bad instance, keeping its siblings", () => {
    // A population of good instances and one bad one is mostly
    // evidence; discarding the good to punish the bad is the opposite
    // of what sample semantics were introduced to do.
    const { response, corrections } = enforceConformance(selfReferencing([
      { "mentors": "Alice", "is mentored by": "Bob" },
      { "Employee": "Carol" },
      { "mentors": "Dan", "is mentored by": "Erin" },
    ]));

    expect(corrections.filter((c) => c.category === "incomplete_instance")).toHaveLength(1);
    expect(response.populations?.[0]?.instances).toHaveLength(2);
  });

  it("is dropped on an ordinary fact type too, not just self-referencing ones", () => {
    const { response, corrections } = enforceConformance(
      ternary({ "Shipment": "S-100", "Product": "P-77" }),
    );
    const { model } = parseDraftModel(response, "Incomplete");

    const dropped = corrections.filter((c) => c.category === "incomplete_instance");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.description).toContain("is the quantity for");
    expect(new ValidationEngine().validate(model).filter((d) => d.severity === "error"))
      .toEqual([]);
  });
});

describe("a complete instance is untouched", () => {
  it("survives player-name keying, which is what the recorded payload uses", () => {
    // `freight-corrections.json` -- the only population in the seven
    // recorded answer keys -- is keyed this way over three distinct
    // players. Role-name matching misses and player-name matching hits,
    // so the pinned scores must not move.
    const { response, corrections } = enforceConformance(
      ternary({ "Shipment": "S-100", "Product": "P-77", "Quantity": "5" }),
    );
    const { model } = parseDraftModel(response, "Complete");

    expect(corrections.filter((c) => c.category === "incomplete_instance")).toEqual([]);
    expect(response.populations?.[0]?.instances).toHaveLength(1);
    expect(model.populations.flatMap((p) => p.instances)).toHaveLength(1);
  });

  it("matches a role name case-insensitively, as constraint resolution does", () => {
    const { response, corrections } = enforceConformance(
      selfReferencing([{ "MENTORS": "Alice", "Is Mentored By": "Bob" }]),
    );

    expect(corrections).toEqual([]);
    expect(response.populations?.[0]?.instances).toHaveLength(1);
  });
});
