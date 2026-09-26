/**
 * Tests for the dbt export annotator.
 *
 * Verifies that TODO/NOTE comments are injected into rendered schema.yml
 * based on analysis of the ORM model and relational schema.
 */
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { renderDbt } from "../../src/mapping/renderers/dbt.js";
import { annotateDbtExport } from "../../src/mapping/renderers/DbtExportAnnotator.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

describe("DbtExportAnnotator", () => {
  describe("missing descriptions", () => {
    it("adds a TODO for models without a definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      // Model-level TODO for missing description.
      const modelTodo = result.annotations.find(
        (a) =>
          a.tableName === "customer"
          && !a.columnName
          && a.severity === "todo"
          && a.category === "description",
      );
      expect(modelTodo).toBeDefined();
      expect(result.schemaYaml).toContain(
        "# TODO(barwise): No model description",
      );
    });

    it("adds a NOTE when entity has a definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A person or organization that purchases goods.",
        })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      const modelNote = result.annotations.find(
        (a) =>
          a.tableName === "customer"
          && !a.columnName
          && a.severity === "note"
          && a.category === "description",
      );
      expect(modelNote).toBeDefined();
      expect(modelNote!.message).toContain("Definition available from ORM model");
      expect(result.schemaYaml).toContain("# NOTE(barwise):");
    });

    it("adds a TODO for every column (no descriptions in relational schema)", () => {
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
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      const colDescTodos = result.annotations.filter(
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
    it("adds a TODO when a column defaults to TEXT", () => {
      // Value type without an explicit dataType -> mapper defaults to TEXT.
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
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      const textTodo = result.annotations.find(
        (a) =>
          a.tableName === "customer"
          && a.columnName === "status"
          && a.category === "data_type",
      );
      expect(textTodo).toBeDefined();
      expect(textTodo!.severity).toBe("todo");
      expect(result.schemaYaml).toContain(
        "# TODO(barwise): Data type was not declared; exported as TEXT. Add a data type to the value type. Or set it in the dbt YAML.",
      );
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
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      const nameTodo = result.annotations.find(
        (a) =>
          a.columnName === "name"
          && a.category === "data_type",
      );
      expect(nameTodo).toBeUndefined();
    });
  });

  describe("value constraints", () => {
    it("adds a NOTE for columns with value constraints", () => {
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
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      const valNote = result.annotations.find(
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
    it("adds a NOTE for tables with composite PKs", () => {
      // A many-to-many relationship produces an associative table with composite PK.
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
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      const pkNote = result.annotations.find(
        (a) =>
          a.category === "constraint"
          && a.severity === "note"
          && a.message.includes("Composite primary key"),
      );
      expect(pkNote).toBeDefined();
    });
  });

  describe("idempotency", () => {
    it("produces the same result when run twice", () => {
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
      const dbt = renderDbt(schema);

      const first = annotateDbtExport(dbt.schemaYaml, model, schema);
      const second = annotateDbtExport(first.schemaYaml, model, schema);

      expect(second.schemaYaml).toBe(first.schemaYaml);
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
      const dbt = renderDbt(schema);
      const result = annotateDbtExport(dbt.schemaYaml, model, schema);

      // Customer has a definition -> NOTE.
      const custNote = result.annotations.find(
        (a) =>
          a.tableName === "customer"
          && !a.columnName
          && a.category === "description"
          && a.severity === "note",
      );
      expect(custNote).toBeDefined();

      // Order has no definition -> TODO.
      const orderTodo = result.annotations.find(
        (a) =>
          a.tableName === "order"
          && !a.columnName
          && a.category === "description"
          && a.severity === "todo",
      );
      expect(orderTodo).toBeDefined();
    });
  });
});
