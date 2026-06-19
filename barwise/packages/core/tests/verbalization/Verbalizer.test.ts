/**
 * Tests for the top-level Verbalizer facade.
 *
 * Verbalizer composes FactTypeVerbalizer and ConstraintVerbalizer to
 * produce a complete set of natural-language verbalizations for a model.
 * These tests verify:
 *   - verbalizeModel returns readings + constraint sentences for all fact types
 *   - verbalizeFactType returns sentences for a single fact type by ID
 *   - Sub-verbalizer access (factTypes, constraints)
 */
import { describe, expect, it } from "vitest";
import type { ExportAnnotation } from "../../src/annotation/ExportAnnotationCollector.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("Verbalizer", () => {
  const verbalizer = new Verbalizer();

  describe("verbalizeModel", () => {
    it("returns empty array for a model with no fact types", () => {
      const model = new OrmModel({ name: "Empty" });
      expect(verbalizer.verbalizeModel(model)).toHaveLength(0);
    });

    it("returns fact type readings and constraint verbalizations", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role1",
        })
        .build();

      const vs = verbalizer.verbalizeModel(model);

      // 2 readings + 1 uniqueness + 1 mandatory = 4
      expect(vs).toHaveLength(4);

      const factTypeVs = vs.filter((v) => v.category === "fact_type");
      const constraintVs = vs.filter((v) => v.category === "constraint");

      expect(factTypeVs).toHaveLength(2);
      expect(constraintVs).toHaveLength(2);
    });

    it("handles multiple fact types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withEntityType("Product", { referenceMode: "product_id" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
        })
        .withBinaryFactType("Order contains Product", {
          role1: { player: "Order", name: "contains" },
          role2: { player: "Product", name: "is in" },
        })
        .build();

      const vs = verbalizer.verbalizeModel(model);

      // 2 readings per fact type * 2 fact types = 4
      expect(vs).toHaveLength(4);
      expect(vs.map((v) => v.text)).toContain("Customer places Order");
      expect(vs.map((v) => v.text)).toContain(
        "Order is placed by Customer",
      );
      expect(vs.map((v) => v.text)).toContain("Order contains Product");
      expect(vs.map((v) => v.text)).toContain("Product is in Order");
    });
  });

  describe("verbalizeFactType", () => {
    it("returns empty array for nonexistent fact type", () => {
      const model = new OrmModel({ name: "Test" });
      expect(verbalizer.verbalizeFactType("bogus", model)).toHaveLength(
        0,
      );
    });

    it("returns readings and constraints for a specific fact type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const ft = model.factTypes[0]!;
      const vs = verbalizer.verbalizeFactType(ft.id, model);

      // 2 readings + 1 uniqueness = 3
      expect(vs).toHaveLength(3);
      expect(vs[0]!.text).toBe("Customer places Order");
      expect(vs[1]!.text).toBe("Order is placed by Customer");
      expect(vs[2]!.text).toContain("at most one");
    });
  });

  describe("verbalizeModelWithAnnotations", () => {
    it("appends open questions section for TODO annotations", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const annotations: ExportAnnotation[] = [
        {
          tableName: "customer",
          severity: "todo",
          category: "description",
          message: "No model description. Add a definition.",
        },
        {
          tableName: "customer",
          columnName: "customer_id",
          severity: "todo",
          category: "description",
          message: "No column description.",
        },
      ];

      const vs = verbalizer.verbalizeModelWithAnnotations(model, annotations);

      const questions = vs.filter((v) => v.category === "open_question");
      // 1 header + 2 questions
      expect(questions).toHaveLength(3);
      expect(questions[0]!.text).toBe("== Open questions ==");
      expect(questions[1]!.text).toContain("[customer]");
      expect(questions[1]!.text).toContain("No model description");
      expect(questions[2]!.text).toContain("[customer.customer_id]");
    });

    it("does not append section when there are no TODO annotations", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const noteOnly: ExportAnnotation[] = [
        {
          tableName: "customer",
          severity: "note",
          category: "description",
          message: "Definition available.",
        },
      ];

      const vs = verbalizer.verbalizeModelWithAnnotations(model, noteOnly);

      const questions = vs.filter((v) => v.category === "open_question");
      expect(questions).toHaveLength(0);
    });

    it("filters out NOTE annotations from the questions section", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const mixed: ExportAnnotation[] = [
        {
          tableName: "customer",
          severity: "note",
          category: "description",
          message: "This is informational.",
        },
        {
          tableName: "customer",
          severity: "todo",
          category: "data_type",
          message: "Review data type.",
        },
      ];

      const vs = verbalizer.verbalizeModelWithAnnotations(model, mixed);

      const questions = vs.filter((v) => v.category === "open_question");
      // 1 header + 1 question (the NOTE is excluded).
      expect(questions).toHaveLength(2);
      expect(questions[1]!.text).toContain("Review data type");
      expect(questions[1]!.text).not.toContain("informational");
    });

    it("returns same result as verbalizeModel when annotations are empty", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
        })
        .build();

      const withAnnotations = verbalizer.verbalizeModelWithAnnotations(model, []);
      const without = verbalizer.verbalizeModel(model);

      expect(withAnnotations.length).toBe(without.length);
      for (let i = 0; i < without.length; i++) {
        expect(withAnnotations[i]!.text).toBe(without[i]!.text);
        expect(withAnnotations[i]!.category).toBe(without[i]!.category);
      }
    });
  });

  describe("sub-verbalizer access", () => {
    it("exposes factTypes verbalizer", () => {
      expect(verbalizer.factTypes).toBeDefined();
    });

    it("exposes constraints verbalizer", () => {
      expect(verbalizer.constraints).toBeDefined();
    });
  });

  describe("object-type cardinality", () => {
    it("verbalizes a population bound on an object type", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Department",
        kind: "entity",
        referenceMode: "dept_id",
        cardinality: { min: 0, max: 50 },
      });

      const texts = verbalizer.verbalizeModel(model).map((v) => v.text);
      expect(texts).toContain("The number of Department instances is at most 50.");
    });
  });

  describe("derivation", () => {
    it("verbalizes a derived-and-stored fact type", () => {
      const model = new OrmModel({ name: "Test" });
      const order = model.addObjectType({
        name: "Order",
        kind: "entity",
        referenceMode: "order_id",
      });
      const total = model.addObjectType({ name: "TotalPrice", kind: "value" });
      model.addFactType({
        name: "Order has TotalPrice",
        roles: [
          { name: "has", playerId: order.id, id: "r1" },
          { name: "of", playerId: total.id, id: "r2" },
        ],
        readings: ["{0} has {1}"],
        derivation: {
          kind: "derived",
          storage: "derived_and_stored",
          expression: "Quantity * UnitPrice",
        },
      });

      const texts = verbalizer.verbalizeModel(model).map((v) => v.text);
      expect(texts).toContain(
        "Fact type 'Order has TotalPrice' is derived and stored: Quantity * UnitPrice.",
      );
    });

    it("appends a subtype defining rule to the subtype verbalization", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const adult = model.addObjectType({
        name: "Adult",
        kind: "entity",
        referenceMode: "person_id",
      });
      const sf = model.addSubtypeFact({
        subtypeId: adult.id,
        supertypeId: person.id,
        definingRule: { kind: "derived", expression: "Person has Age >= 18" },
      });

      expect(verbalizer.verbalizeSubtypeFact(sf, model).text).toBe(
        "Adult is a subtype of Person, defined as: Person has Age >= 18.",
      );
    });
  });
});
