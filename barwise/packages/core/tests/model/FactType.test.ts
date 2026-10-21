/**
 * Tests for the FactType model class.
 *
 * A FactType records a relationship between object types via roles.
 * It carries readings (natural-language templates), inline constraints,
 * and an optional definition. These tests verify:
 *   - Construction with varying arities (unary, binary, ternary)
 *   - Role access and reading storage
 *   - Constraint attachment (uniqueness, mandatory, value)
 *   - Definition getter/setter
 *   - Validation of required fields (at least one role, one reading)
 */
import { describe, expect, it } from "vitest";
import { FactType } from "../../src/model/FactType.js";

describe("FactType", () => {
  const player1Id = "ot-1";
  const player2Id = "ot-2";

  it("creates a binary fact type with two roles and a reading", () => {
    const ft = new FactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: player1Id },
        { name: "is placed by", playerId: player2Id },
      ],
      readings: ["{0} places {1}"],
    });

    expect(ft.name).toBe("Customer places Order");
    expect(ft.arity).toBe(2);
    expect(ft.roles).toHaveLength(2);
    expect(ft.readings).toHaveLength(1);
  });

  it("creates a fact type with multiple readings", () => {
    const ft = new FactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: player1Id },
        { name: "is placed by", playerId: player2Id },
      ],
      readings: ["{0} places {1}", "{1} is placed by {0}"],
    });

    expect(ft.readings).toHaveLength(2);
  });

  it("throws on no roles", () => {
    expect(
      () =>
        new FactType({
          name: "Empty",
          roles: [],
          readings: ["{0}"],
        }),
    ).toThrow("at least one role");
  });

  it("throws on no readings", () => {
    expect(
      () =>
        new FactType({
          name: "No readings",
          roles: [{ name: "r1", playerId: player1Id }],
          readings: [],
        }),
    ).toThrow("at least one reading");
  });

  it("throws on invalid reading template", () => {
    expect(
      () =>
        new FactType({
          name: "Bad reading",
          roles: [
            { name: "r1", playerId: player1Id },
            { name: "r2", playerId: player2Id },
          ],
          readings: ["{0} only mentions one"],
        }),
    ).toThrow("missing placeholder");
  });

  it("finds a role by id", () => {
    const ft = new FactType({
      name: "Test",
      roles: [
        { name: "r1", playerId: player1Id, id: "role-1" },
        { name: "r2", playerId: player2Id, id: "role-2" },
      ],
      readings: ["{0} test {1}"],
    });

    expect(ft.getRoleById("role-1")?.name).toBe("r1");
    expect(ft.getRoleById("role-2")?.name).toBe("r2");
    expect(ft.getRoleById("nonexistent")).toBeUndefined();
  });

  it("reports hasRole correctly", () => {
    const ft = new FactType({
      name: "Test",
      roles: [
        { name: "r1", playerId: player1Id, id: "role-1" },
        { name: "r2", playerId: player2Id, id: "role-2" },
      ],
      readings: ["{0} test {1}"],
    });

    expect(ft.hasRole("role-1")).toBe(true);
    expect(ft.hasRole("role-999")).toBe(false);
  });

  it("finds roles for a player", () => {
    const ft = new FactType({
      name: "Test",
      roles: [
        { name: "r1", playerId: player1Id },
        { name: "r2", playerId: player2Id },
      ],
      readings: ["{0} test {1}"],
    });

    expect(ft.rolesForPlayer(player1Id)).toHaveLength(1);
    expect(ft.rolesForPlayer(player1Id)[0]?.name).toBe("r1");
    expect(ft.rolesForPlayer("nobody")).toHaveLength(0);
  });

  it("accepts and stores its own constraints", () => {
    const ft = new FactType({
      name: "Test",
      roles: [
        { name: "r1", playerId: player1Id, id: "role-1" },
        { name: "r2", playerId: player2Id, id: "role-2" },
      ],
      readings: ["{0} test {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["role-2"] },
        { type: "mandatory", roleId: "role-2" },
      ],
    });

    expect(ft.internalConstraints.map((c) => c.type)).toEqual(["internal_uniqueness", "mandatory"]);
  });

  it("refuses a constraint across fact types when it has no model to hold it", () => {
    const ft = new FactType({
      name: "Test",
      roles: [
        { name: "r1", playerId: player1Id, id: "role-1" },
        { name: "r2", playerId: player2Id, id: "role-2" },
      ],
      readings: ["{0} test {1}"],
    });
    expect(() => ft.addConstraint({ type: "exclusion", roleIds: ["role-1", "role-2"] })).toThrow(
      /lives in a model/,
    );
    expect(ft.internalConstraints).toEqual([]);
  });

  it("allows adding constraints after construction", () => {
    const ft = new FactType({
      name: "Test",
      roles: [
        { name: "r1", playerId: player1Id, id: "role-1" },
        { name: "r2", playerId: player2Id, id: "role-2" },
      ],
      readings: ["{0} test {1}"],
    });

    expect(ft.internalConstraints).toHaveLength(0);
    ft.addConstraint({ type: "mandatory", roleId: "role-1" });
    expect(ft.internalConstraints.map((c) => c.type)).toEqual(["mandatory"]);
  });

  it("stores a definition", () => {
    const ft = new FactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: player1Id },
        { name: "is placed by", playerId: player2Id },
      ],
      readings: ["{0} places {1}"],
      definition: "The act of a customer submitting an order.",
    });

    expect(ft.definition).toBe("The act of a customer submitting an order.");
  });

  it("allows setting the definition after construction", () => {
    const ft = new FactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: player1Id },
        { name: "is placed by", playerId: player2Id },
      ],
      readings: ["{0} places {1}"],
    });

    expect(ft.definition).toBeUndefined();
    ft.definition = "Updated definition.";
    expect(ft.definition).toBe("Updated definition.");
  });

  it("allows clearing the definition", () => {
    const ft = new FactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: player1Id },
        { name: "is placed by", playerId: player2Id },
      ],
      readings: ["{0} places {1}"],
      definition: "Original definition.",
    });

    ft.definition = undefined;
    expect(ft.definition).toBeUndefined();
  });
});
