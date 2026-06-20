/**
 * Tests demonstrating that population validation is integrated into
 * the standard ValidationEngine and runs as part of validate().
 *
 * This confirms the Stage C requirement that population validation
 * diagnostics are included in the standard validation run when
 * populations exist in the model.
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

describe("Population validation integration", () => {
  it("includes population diagnostics in standard validation", () => {
    const engine = new ValidationEngine();
    const model = new OrmModel({ name: "Test" });

    // Create a fact type with a uniqueness constraint
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const order = model.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
    });

    const ft = model.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: customer.id, id: "r1" },
        { name: "is placed by", playerId: order.id, id: "r2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r2"] }, // Order is unique
      ],
    });

    // Add a population with a uniqueness violation
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
    pop.addInstance({ roleValues: { r1: "C002", r2: "O123" } }); // Duplicate!

    // Run standard validation
    const diagnostics = engine.validate(model);

    // Should have population violation diagnostics
    const populationDiags = diagnostics.filter((d) => d.ruleId.startsWith("population/"));
    expect(populationDiags.length).toBeGreaterThan(0);

    // Should have the specific uniqueness violation
    const uniquenessViolation = diagnostics.find(
      (d) => d.ruleId === "population/uniqueness-violation",
    );
    expect(uniquenessViolation).toBeDefined();
    expect(uniquenessViolation?.severity).toBe("error");
    expect(uniquenessViolation?.message).toContain("violates");
    expect(uniquenessViolation?.message).toContain("uniqueness");
  });

  it("includes value constraint violations", () => {
    const engine = new ValidationEngine();
    const model = new OrmModel({ name: "Test" });

    const status = model.addObjectType({
      name: "Status",
      kind: "value",
      dataType: { name: "text", length: 20 },
    });
    const order = model.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_id",
    });

    const ft = model.addFactType({
      name: "Order has Status",
      roles: [
        { name: "has", playerId: order.id, id: "r1" },
        { name: "is of", playerId: status.id, id: "r2" },
      ],
      readings: ["{0} has {1}"],
      constraints: [
        {
          type: "value_constraint",
          roleId: "r2",
          values: ["pending", "shipped", "delivered"],
        },
      ],
    });

    // Add population with invalid value
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({ roleValues: { r1: "O001", r2: "pending" } }); // Valid
    pop.addInstance({ roleValues: { r1: "O002", r2: "invalid" } }); // Invalid!

    const diagnostics = engine.validate(model);

    // Should have value constraint violation
    const valueViolation = diagnostics.find(
      (d) => d.ruleId === "population/value-constraint-violation",
    );
    expect(valueViolation).toBeDefined();
    expect(valueViolation?.severity).toBe("error");
    expect(valueViolation?.message).toContain("invalid");
    expect(valueViolation?.message).toContain("allowed set");
  });

  it("includes frequency constraint violations", () => {
    const engine = new ValidationEngine();
    const model = new OrmModel({ name: "Test" });

    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const order = model.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
    });

    const ft = model.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: customer.id, id: "r1" },
        { name: "is placed by", playerId: order.id, id: "r2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        {
          type: "frequency",
          roleIds: ["r1"], // Each customer must place 2-5 orders
          min: 2,
          max: 5,
        },
      ],
    });

    // Add population with frequency violation
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({ roleValues: { r1: "C001", r2: "O001" } }); // Only 1 order!

    const diagnostics = engine.validate(model);

    // Should have frequency violation
    const freqViolation = diagnostics.find(
      (d) => d.ruleId === "population/frequency-violation",
    );
    expect(freqViolation).toBeDefined();
    expect(freqViolation?.severity).toBe("error");
    expect(freqViolation?.message).toContain("minimum");
  });

  it("produces no population diagnostics when no populations exist", () => {
    const engine = new ValidationEngine();
    const model = new OrmModel({ name: "Test" });

    // Create model without populations
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const order = model.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
    });

    model.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: customer.id, id: "r1" },
        { name: "is placed by", playerId: order.id, id: "r2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r2"] },
      ],
    });

    // Run validation
    const diagnostics = engine.validate(model);

    // Should have no population diagnostics
    const populationDiags = diagnostics.filter((d) => d.ruleId.startsWith("population/"));
    expect(populationDiags).toHaveLength(0);
  });

  it("produces no diagnostics for valid populations", () => {
    const engine = new ValidationEngine();
    const model = new OrmModel({ name: "Test" });

    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const order = model.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
    });

    const ft = model.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: customer.id, id: "r1" },
        { name: "is placed by", playerId: order.id, id: "r2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r2"] },
      ],
    });

    // Add valid population (no violations)
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
    pop.addInstance({ roleValues: { r1: "C002", r2: "O124" } }); // Different orders

    const diagnostics = engine.validate(model);

    // Should have no population violations
    const populationDiags = diagnostics.filter((d) => d.ruleId.startsWith("population/"));
    expect(populationDiags).toHaveLength(0);
  });

  it("distinguishes population diagnostics from structural diagnostics", () => {
    const engine = new ValidationEngine();
    const model = new OrmModel({ name: "Test" });

    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const order = model.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
    });

    const ft = model.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: customer.id, id: "r1" },
        { name: "is placed by", playerId: order.id, id: "r2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r2"] },
        { type: "mandatory", roleId: "r-bad" }, // Structural error!
      ],
    });

    // Add population with violation
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
    pop.addInstance({ roleValues: { r1: "C002", r2: "O123" } }); // Duplicate!

    const diagnostics = engine.validate(model);

    // Should have both structural and population diagnostics
    const structuralDiags = diagnostics.filter(
      (d) => !d.ruleId.startsWith("population/"),
    );
    const populationDiags = diagnostics.filter((d) => d.ruleId.startsWith("population/"));

    expect(structuralDiags.length).toBeGreaterThan(0);
    expect(populationDiags.length).toBeGreaterThan(0);

    // Population diagnostics should use distinct rule ID prefix
    expect(
      populationDiags.every((d) => d.ruleId.startsWith("population/")),
    ).toBe(true);
  });
});
