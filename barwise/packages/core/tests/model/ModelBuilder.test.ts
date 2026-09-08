/**
 * Tests for the ModelBuilder test helper.
 *
 * ModelBuilder provides a fluent DSL for constructing ORM models in tests.
 * It eliminates boilerplate by auto-generating role IDs, default readings,
 * and constraint wiring. These tests verify that the builder produces
 * structurally correct models -- they serve as regression tests for the
 * builder itself, so that bugs in the helper do not silently corrupt
 * downstream test fixtures.
 */
import { describe, expect, it } from "vitest";
import { isInternalUniqueness, isMandatoryRole } from "../../src/model/Constraint.js";
import { isEntityType, isValueType } from "../../src/model/ObjectType.js";
import { expandReading } from "../../src/model/ReadingOrder.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("ModelBuilder", () => {
  it("builds the order management example from the architecture doc", () => {
    const model = new ModelBuilder("Order Management", "ecommerce")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "A person or organization that has placed at least one order.",
        sourceContext: "crm",
      })
      .withEntityType("Order", {
        referenceMode: "order_number",
        definition: "A confirmed request by a customer for one or more products.",
      })
      .withEntityType("Product", {
        referenceMode: "product_id",
        definition: "An item available for purchase.",
      })
      .withValueType("Rating", {
        valueConstraint: { values: ["A", "B", "C", "D", "F"] },
        definition: "A letter grade assigned to a customer.",
      })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2", // each Order placed by at most one Customer
        mandatory: "role2", // every Order placed by some Customer
      })
      .withBinaryFactType("Order contains Product", {
        role1: { player: "Order", name: "contains" },
        role2: { player: "Product", name: "is contained in" },
        uniqueness: "spanning", // each Order-Product combination is unique
      })
      .withBinaryFactType("Customer has Rating", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Rating", name: "is of" },
        uniqueness: "role1", // each Customer has at most one Rating
      })
      .withDefinition(
        "Backorder",
        "An order that cannot be fulfilled from current inventory.",
        "fulfillment",
      )
      .build();

    // -- Verify model structure --
    expect(model.name).toBe("Order Management");
    expect(model.domainContext).toBe("ecommerce");

    // Object types
    expect(model.objectTypes).toHaveLength(4);
    const customer = model.getObjectTypeByName("Customer");
    expect(customer).toBeDefined();
    expect(isEntityType(customer!)).toBe(true);
    expect(customer!.referenceMode).toBe("customer_id");
    expect(customer!.definition).toContain("placed at least one order");
    expect(customer!.sourceContext).toBe("crm");

    const rating = model.getObjectTypeByName("Rating");
    expect(rating).toBeDefined();
    expect(isValueType(rating!)).toBe(true);
    expect(rating!.valueConstraint?.values).toEqual([
      "A",
      "B",
      "C",
      "D",
      "F",
    ]);

    // Fact types
    expect(model.factTypes).toHaveLength(3);
    const placesOrder = model.getFactTypeByName("Customer places Order");
    expect(placesOrder).toBeDefined();
    expect(placesOrder!.arity).toBe(2);
    expect(placesOrder!.readings).toHaveLength(2);

    // Verify the readings expand correctly.
    const forwardReading = placesOrder!.readings[0]!;
    expect(
      expandReading(forwardReading.template, ["Customer", "Order"]),
    ).toBe("Customer places Order");

    const inverseReading = placesOrder!.readings[1]!;
    expect(
      expandReading(inverseReading.template, ["Customer", "Order"]),
    ).toBe("Order is placed by Customer");

    // Verify constraints on Customer places Order.
    expect(placesOrder!.constraints).toHaveLength(2);
    const uniquenessConstraint = placesOrder!.constraints.find(
      isInternalUniqueness,
    );
    expect(uniquenessConstraint).toBeDefined();

    const mandatoryConstraint = placesOrder!.constraints.find(isMandatoryRole);
    expect(mandatoryConstraint).toBeDefined();

    // Verify spanning uniqueness on Order contains Product.
    const containsProduct = model.getFactTypeByName(
      "Order contains Product",
    );
    expect(containsProduct).toBeDefined();
    const spanningUniqueness = containsProduct!.constraints.find(isInternalUniqueness);
    expect(spanningUniqueness).toBeDefined();
    expect(spanningUniqueness!.roleIds).toHaveLength(2);

    // Queries: Customer participates in 2 fact types.
    expect(
      model.factTypesForObjectType(customer!.id),
    ).toHaveLength(2);

    // Definitions
    expect(model.definitions).toHaveLength(1);
    expect(model.definitions[0]?.term).toBe("Backorder");
  });

  it("throws if a fact type references an undeclared object type", () => {
    expect(() =>
      new ModelBuilder("Bad Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" }, // Order not declared
        })
        .build()
    ).toThrow('object type "Order" not found');
  });

  it("builds a minimal model with just one entity type", () => {
    const model = new ModelBuilder("Minimal")
      .withEntityType("Thing", { referenceMode: "thing_id" })
      .build();

    expect(model.objectTypes).toHaveLength(1);
    expect(model.factTypes).toHaveLength(0);
  });

  it("generates default reference modes from the type name", () => {
    const model = new ModelBuilder("Defaults")
      .withEntityType("Customer")
      .build();

    expect(
      model.getObjectTypeByName("Customer")?.referenceMode,
    ).toBe("customer_id");
  });
});
