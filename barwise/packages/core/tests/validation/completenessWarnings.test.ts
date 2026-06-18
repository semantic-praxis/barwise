/**
 * Tests for completeness warning rules.
 *
 * Completeness warnings are non-blocking hints that help modelers
 * identify areas needing attention. They flag:
 *   - Object types with no natural-language definition (info)
 *   - Fact types with no constraints at all (warning -- likely
 *     indicates the modeler forgot to specify cardinality)
 *   - Object types that do not participate in any fact type (info --
 *     "orphan" types that serve no purpose in the model)
 *   - Value types without a declared data type (info)
 *   - Entity types with zero or multiple preferred identifiers (info/warning)
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { completenessWarnings } from "../../src/validation/rules/completenessWarnings.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("completenessWarnings", () => {
  it("produces no diagnostics for a well-defined model", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "A person who buys things.",
      })
      .withValueType("CustomerId", {
        definition: "Unique customer identifier.",
        dataType: { name: "integer" },
      })
      .withEntityType("Order", {
        referenceMode: "order_number",
        definition: "A confirmed purchase.",
      })
      .withValueType("OrderNumber", {
        definition: "Unique order number.",
        dataType: { name: "text", length: 20 },
      })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "is of" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Order has OrderNumber", {
        role1: { player: "Order", name: "has" },
        role2: { player: "OrderNumber", name: "is of" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .build();

    const diagnostics = completenessWarnings(model);
    expect(diagnostics).toHaveLength(0);
  });

  it("produces no diagnostics for an empty model", () => {
    const model = new OrmModel({ name: "Empty" });
    const diagnostics = completenessWarnings(model);
    expect(diagnostics).toHaveLength(0);
  });

  describe("missing object type definitions", () => {
    it("reports object types without definitions", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", {
          referenceMode: "order_number",
          definition: "A confirmed purchase.",
        })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-object-type-definition",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("info");
      expect(missing[0]!.message).toContain("Customer");
    });

    it("reports all object types missing definitions", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("A", { referenceMode: "a_id" })
        .withEntityType("B", { referenceMode: "b_id" })
        .withBinaryFactType("A relates B", {
          role1: { player: "A", name: "relates" },
          role2: { player: "B", name: "is related" },
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-object-type-definition",
      );
      expect(missing).toHaveLength(2);
    });
  });

  describe("fact types without constraints", () => {
    it("warns when a fact type has no constraints", () => {
      const model = new OrmModel({ name: "Test" });
      const ot = model.addObjectType({
        name: "Thing",
        kind: "entity",
        referenceMode: "thing_id",
        definition: "A thing.",
      });
      model.addFactType({
        name: "Thing exists",
        roles: [{ name: "exists", playerId: ot.id }],
        readings: ["{0} exists"],
        // no constraints
      });

      const diagnostics = completenessWarnings(model);
      const noConstraints = diagnostics.filter(
        (d) => d.ruleId === "completeness/fact-type-without-constraints",
      );
      expect(noConstraints).toHaveLength(1);
      expect(noConstraints[0]!.severity).toBe("warning");
      expect(noConstraints[0]!.message).toContain("Thing exists");
    });

    it("does not warn when fact type has constraints", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("X", {
          referenceMode: "x_id",
          definition: "An X.",
        })
        .withEntityType("Y", {
          referenceMode: "y_id",
          definition: "A Y.",
        })
        .withBinaryFactType("X has Y", {
          role1: { player: "X", name: "has" },
          role2: { player: "Y", name: "of" },
          uniqueness: "role2",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const noConstraints = diagnostics.filter(
        (d) => d.ruleId === "completeness/fact-type-without-constraints",
      );
      expect(noConstraints).toHaveLength(0);
    });
  });

  describe("isolated object types", () => {
    it("reports object types not participating in any fact type", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Orphan",
        kind: "entity",
        referenceMode: "orphan_id",
        definition: "An isolated type.",
      });

      const diagnostics = completenessWarnings(model);
      const isolated = diagnostics.filter(
        (d) => d.ruleId === "completeness/isolated-object-type",
      );
      expect(isolated).toHaveLength(1);
      expect(isolated[0]!.severity).toBe("info");
      expect(isolated[0]!.message).toContain("Orphan");
    });

    it("does not report an independent object type that is standalone", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Color",
        kind: "value",
        independent: true,
      });

      const isolated = completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/isolated-object-type",
      );
      expect(isolated).toHaveLength(0);
    });

    it("does not report object types that participate in fact types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("A", {
          referenceMode: "a_id",
          definition: "An A.",
        })
        .withEntityType("B", {
          referenceMode: "b_id",
          definition: "A B.",
        })
        .withBinaryFactType("A has B", {
          role1: { player: "A", name: "has" },
          role2: { player: "B", name: "of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const isolated = diagnostics.filter(
        (d) => d.ruleId === "completeness/isolated-object-type",
      );
      expect(isolated).toHaveLength(0);
    });
  });

  describe("missing value type data type", () => {
    it("reports value types without a data type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", { definition: "A name." })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-value-type-data-type",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("info");
      expect(missing[0]!.message).toContain("Name");
      expect(missing[0]!.message).toContain("TEXT");
    });

    it("does not report value types that have a data type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", {
          definition: "A name.",
          dataType: { name: "text", length: 100 },
        })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-value-type-data-type",
      );
      expect(missing).toHaveLength(0);
    });

    it("does not flag entity types without data type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withEntityType("Order", {
          referenceMode: "order_number",
          definition: "An order.",
        })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-value-type-data-type",
      );
      expect(missing).toHaveLength(0);
    });
  });

  describe("preferred identifiers", () => {
    it("reports entity types with no preferred identifier", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", {
          definition: "A name.",
          dataType: { name: "text" },
        })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-preferred-identifier",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("info");
      expect(missing[0]!.message).toContain("Customer");
      expect(missing[0]!.message).toContain("heuristic");
    });

    it("does not report entity types with a preferred identifier", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("CustomerId", {
          definition: "Customer identifier.",
          dataType: { name: "integer" },
        })
        .withBinaryFactType("Customer has CustomerId", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerId", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-preferred-identifier",
      );
      expect(missing).toHaveLength(0);
    });

    it("warns when entity type has multiple preferred identifiers", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("CustomerId", {
          definition: "Internal identifier.",
          dataType: { name: "integer" },
        })
        .withValueType("ExternalCode", {
          definition: "External code.",
          dataType: { name: "text", length: 10 },
        })
        .withBinaryFactType("Customer has CustomerId", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerId", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .withBinaryFactType("Customer has ExternalCode", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "ExternalCode", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const multiple = diagnostics.filter(
        (d) => d.ruleId === "completeness/multiple-preferred-identifiers",
      );
      expect(multiple).toHaveLength(1);
      expect(multiple[0]!.severity).toBe("warning");
      expect(multiple[0]!.message).toContain("Customer");
      expect(multiple[0]!.message).toContain("2");
    });

    it("does not check value types for preferred identifiers", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", { definition: "A name." })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .build();

      const diagnostics = completenessWarnings(model);
      // Value type "Name" should not be checked for preferred identifiers --
      // only entity types are checked.
      const valuePrefWarning = diagnostics.filter(
        (d) =>
          d.ruleId === "completeness/missing-preferred-identifier"
          && d.message.includes("Name"),
      );
      expect(valuePrefWarning).toHaveLength(0);
    });
  });
});
