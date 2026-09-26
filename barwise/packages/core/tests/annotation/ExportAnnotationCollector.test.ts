/**
 * Tests for ExportAnnotationCollector.
 *
 * Verifies that the extracted collectExportAnnotations() function
 * produces identical annotation output to the original inline
 * collectAnnotations() in DbtExportAnnotator for the same inputs.
 */
import { describe, expect, it } from "vitest";
import { collectExportAnnotations } from "../../src/annotation/ExportAnnotationCollector.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

describe("ExportAnnotationCollector", () => {
  describe("missing descriptions", () => {
    it("produces a TODO for entities without a definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      const todo = annotations.find(
        (a) =>
          a.tableName === "customer"
          && !a.columnName
          && a.severity === "todo"
          && a.category === "description",
      );
      expect(todo).toBeDefined();
      expect(todo!.message).toContain("No model description");
    });

    it("produces a NOTE when entity has a definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A person or organization that purchases goods.",
        })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      const note = annotations.find(
        (a) =>
          a.tableName === "customer"
          && !a.columnName
          && a.severity === "note"
          && a.category === "description",
      );
      expect(note).toBeDefined();
      expect(note!.message).toContain("Definition available from ORM model");
    });

    it("produces a TODO for every column (no descriptions)", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Name", { dataType: { name: "text", length: 100 } })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      const colDescTodos = annotations.filter(
        (a) =>
          a.tableName === "customer"
          && a.columnName !== undefined
          && a.severity === "todo"
          && a.category === "description",
      );
      // customer_id and name columns should both have description TODOs.
      expect(colDescTodos.length).toBe(2);
    });
  });

  describe("default data types", () => {
    it("flags columns that default to TEXT", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Status")
        .withBinaryFactType("Customer has Status", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Status", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      const textTodo = annotations.find(
        (a) =>
          a.tableName === "customer"
          && a.columnName === "status"
          && a.category === "data_type",
      );
      expect(textTodo).toBeDefined();
      expect(textTodo!.severity).toBe("todo");
    });

    it("does not flag columns with explicit data types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Name", { dataType: { name: "text", length: 100 } })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      const nameTodo = annotations.find(
        (a) =>
          a.columnName === "name"
          && a.category === "data_type",
      );
      expect(nameTodo).toBeUndefined();
    });
  });

  describe("value constraints", () => {
    it("produces a NOTE for columns with value constraints", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Status", {
          valueConstraint: { values: ["active", "inactive", "suspended"] },
        })
        .withBinaryFactType("Customer has Status", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Status", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      const valNote = annotations.find(
        (a) =>
          a.columnName === "status"
          && a.category === "accepted_values",
      );
      expect(valNote).toBeDefined();
      expect(valNote!.severity).toBe("note");
      expect(valNote!.message).toContain("'active'");
      expect(valNote!.message).toContain("'inactive'");
      expect(valNote!.message).toContain("'suspended'");
    });
  });

  describe("composite primary keys", () => {
    it("produces a NOTE for tables with composite PKs", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Student", { referenceMode: "student_id" })
        .withEntityType("Course", { referenceMode: "course_id" })
        .withBinaryFactType("Student enrolls in Course", {
          role1: { player: "Student", name: "enrolls in" },
          role2: { player: "Course", name: "has enrolled" },
          uniqueness: "spanning",
          mandatory: "both",
        })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      const pkNote = annotations.find(
        (a) =>
          a.category === "constraint"
          && a.severity === "note"
          && a.message.includes("Composite primary key"),
      );
      expect(pkNote).toBeDefined();
    });
  });

  describe("multi-table model", () => {
    it("annotates each table independently", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A buyer.",
        })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .build();

      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);

      // Customer has a definition -> NOTE.
      const custNote = annotations.find(
        (a) =>
          a.tableName === "customer"
          && !a.columnName
          && a.category === "description"
          && a.severity === "note",
      );
      expect(custNote).toBeDefined();

      // Order has no definition -> TODO.
      const orderTodo = annotations.find(
        (a) =>
          a.tableName === "order"
          && !a.columnName
          && a.category === "description"
          && a.severity === "todo",
      );
      expect(orderTodo).toBeDefined();
    });
  });

  // dbt-key-type-fidelity.spec.md, WS3: each TODO fires only on the gap
  // it names, and no message names an export format.
  describe("only real gaps (WS3)", () => {
    /** Customer identified by a typed, defined CustomerId; Order references it. */
    function identifiedModel() {
      return new ModelBuilder("Identified")
        .withEntityType("Customer", { referenceMode: "customer_id", definition: "A buyer." })
        .withEntityType("Order", { referenceMode: "order_id", definition: "A purchase." })
        .withValueType("CustomerId", { dataType: { name: "integer" }, definition: "Customer key." })
        .withValueType("OrderId", { dataType: { name: "integer" }, definition: "Order key." })
        .withValueType("CustomerName", { dataType: { name: "text" }, definition: "Full name." })
        .withBinaryFactType("Customer has CustomerId", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerId", name: "is of" },
          uniqueness: "role2",
          isPreferred: true,
        })
        .withBinaryFactType("Order has OrderId", {
          role1: { player: "Order", name: "has" },
          role2: { player: "OrderId", name: "is of" },
          uniqueness: "role2",
          isPreferred: true,
        })
        .withBinaryFactType("Customer has CustomerName", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerName", name: "is of" },
          uniqueness: "role1",
        })
        .withBinaryFactType("Order is placed by Customer", {
          role1: { player: "Order", name: "is placed by" },
          role2: { player: "Customer", name: "places" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .build();
    }

    it("emits no TODO on a column whose type and definition are declared", () => {
      // Includes a declared `text` with no length, which renders as TEXT and
      // used to be reported as defaulted, and the FK order.customer_id,
      // which is described by the identifier it copies.
      const model = identifiedModel();
      const todos = collectExportAnnotations(model, mapper.map(model))
        .filter((a) => a.severity === "todo" && a.columnName);
      expect(todos).toEqual([]);
    });

    it("reports a defaulted key typed by the identifier strategy, with the type used", () => {
      const model = new ModelBuilder("Strategy")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();
      const schema = mapper.map(model, { preferredIdentifierStrategy: "integer" });
      const todo = collectExportAnnotations(model, schema).find(
        (a) => a.columnName === "customer_id" && a.category === "data_type",
      );
      expect(todo?.message).toBe(
        "Data type was not declared; exported as INTEGER. Add a data type to the value type.",
      );
    });

    it("reports a foreign key as defaulted exactly when the key it copies was", () => {
      const model = new ModelBuilder("DefaultedKey")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_id" })
        .withBinaryFactType("Order is placed by Customer", {
          role1: { player: "Order", name: "is placed by" },
          role2: { player: "Customer", name: "places" },
          uniqueness: "role1",
        })
        .build();
      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      const fk = orderTable.foreignKeys[0]!.columnNames[0]!;
      expect(orderTable.columns.find((c) => c.name === fk)?.dataTypeDefaulted).toBe(true);

      const typed = identifiedModel();
      const typedOrder = mapper.map(typed).tables.find((t) => t.name === "order")!;
      const typedFk = typedOrder.foreignKeys[0]!.columnNames[0]!;
      expect(typedOrder.columns.find((c) => c.name === typedFk)?.dataTypeDefaulted).toBe(false);
    });

    it("names no export format in any message", () => {
      const model = new ModelBuilder("Gaps")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Status")
        .withBinaryFactType("Customer has Status", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Status", name: "is of" },
          uniqueness: "role1",
        })
        .build();
      const messages = collectExportAnnotations(model, mapper.map(model)).map((a) => a.message);
      expect(messages.length).toBeGreaterThan(0);
      for (const m of messages) expect(m).not.toMatch(/dbt|yaml|ddl|openapi|avro/i);
    });
  });

  describe("empty model", () => {
    it("returns no annotations for a model with no entity types", () => {
      const model = new ModelBuilder("Test").build();
      const schema = mapper.map(model);
      const annotations = collectExportAnnotations(model, schema);
      expect(annotations).toEqual([]);
    });
  });
});
