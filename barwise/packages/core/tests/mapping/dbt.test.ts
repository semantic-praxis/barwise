/**
 * Tests for the dbt renderer.
 *
 * renderDbt converts a RelationalSchema into a dbt project structure:
 * model SQL files and a schema.yml. These tests verify:
 *   - Model SQL generation with source references and CAST expressions
 *   - schema.yml structure with column data types
 *   - not_null / unique tests on appropriate columns
 *   - relationship tests for foreign keys
 *   - Multiple tables and FK relationships
 *   - Custom source name option
 *   - Disabling relationship test generation
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { renderDbt } from "../../src/mapping/renderers/dbt.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

describe("dbt renderer", () => {
  describe("model SQL files", () => {
    it("generates one model file per table", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
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

      expect(dbt.models.length).toBe(schema.tables.length);
      const modelNames = dbt.models.map((m) => m.name);
      expect(modelNames).toContain("customer");
      expect(modelNames).toContain("order");
    });

    it("generates SELECT with source reference", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const customerModel = dbt.models.find((m) => m.name === "customer")!;

      expect(customerModel.sql).toContain("SELECT");
      expect(customerModel.sql).toContain(
        "FROM {{ source('raw', 'customer') }}",
      );
    });

    it("uses custom source name", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema, { sourceName: "landing" });
      const customerModel = dbt.models.find((m) => m.name === "customer")!;

      expect(customerModel.sql).toContain(
        "FROM {{ source('landing', 'customer') }}",
      );
    });

    it("generates CAST expressions for each column", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Name", { dataType: { name: "text", length: 100 } })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const customerModel = dbt.models.find((m) => m.name === "customer")!;

      // Name is an attribute, not the value type the reference mode names,
      // so the key takes the fallback rather than Name's type. This line
      // used to assert VARCHAR(100): it pinned the borrowed-type defect as
      // correct (dbt-key-type-fidelity.spec.md, WS2).
      expect(customerModel.sql).toContain("CAST(customer_id AS TEXT)");
      expect(customerModel.sql).toContain("CAST(name AS VARCHAR(100))");
    });
  });

  describe("schema.yml", () => {
    it("generates valid YAML with version 2", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const parsed = parse(dbt.schemaYaml) as Record<string, unknown>;

      expect(parsed.version).toBe(2);
      expect(parsed.models).toBeDefined();
    });

    it("includes column data types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Age", { dataType: { name: "integer" } })
        .withBinaryFactType("Customer has Age", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Age", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const parsed = parse(dbt.schemaYaml) as {
        models: Array<{
          name: string;
          columns: Array<{ name: string; data_type: string; }>;
        }>;
      };

      const customerModel = parsed.models.find(
        (m) => m.name === "customer",
      )!;
      const ageCol = customerModel.columns.find((c) => c.name === "age")!;
      expect(ageCol.data_type).toBe("INTEGER");
    });

    it("generates not_null tests for non-nullable columns", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const parsed = parse(dbt.schemaYaml) as {
        models: Array<{
          name: string;
          columns: Array<{ name: string; tests?: unknown[]; }>;
        }>;
      };

      const customerModel = parsed.models.find(
        (m) => m.name === "customer",
      )!;
      const pkCol = customerModel.columns.find(
        (c) => c.name === "customer_id",
      )!;
      expect(pkCol.tests).toContain("not_null");
    });

    it("generates unique tests for single-column PKs", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);
      const parsed = parse(dbt.schemaYaml) as {
        models: Array<{
          name: string;
          columns: Array<{ name: string; tests?: unknown[]; }>;
        }>;
      };

      const customerModel = parsed.models.find(
        (m) => m.name === "customer",
      )!;
      const pkCol = customerModel.columns.find(
        (c) => c.name === "customer_id",
      )!;
      expect(pkCol.tests).toContain("unique");
    });

    it("generates relationship tests for FK columns", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
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
      const parsed = parse(dbt.schemaYaml) as {
        models: Array<{
          name: string;
          columns: Array<{ name: string; tests?: unknown[]; }>;
        }>;
      };

      const orderModel = parsed.models.find((m) => m.name === "order")!;
      const fkCol = orderModel.columns.find(
        (c) => c.name === "customer_id",
      )!;
      const relTest = fkCol.tests?.find(
        (t) => typeof t === "object" && t !== null && "relationships" in t,
      ) as { relationships: { to: string; field: string; }; } | undefined;

      expect(relTest).toBeDefined();
      expect(relTest!.relationships.to).toBe("ref('customer')");
      expect(relTest!.relationships.field).toBe("customer_id");
    });

    it("omits relationship tests when disabled", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema, { generateRelationshipTests: false });
      const parsed = parse(dbt.schemaYaml) as {
        models: Array<{
          name: string;
          columns: Array<{ name: string; tests?: unknown[]; }>;
        }>;
      };

      const orderModel = parsed.models.find((m) => m.name === "order")!;
      const fkCol = orderModel.columns.find(
        (c) => c.name === "customer_id",
      )!;
      const relTest = fkCol.tests?.find(
        (t) => typeof t === "object" && t !== null && "relationships" in t,
      );

      expect(relTest).toBeUndefined();
    });

    it("does not add tests to nullable non-key columns", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Nickname", { dataType: { name: "text" } })
        .withBinaryFactType("Customer has Nickname", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Nickname", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema, { generateRelationshipTests: false });
      const parsed = parse(dbt.schemaYaml) as {
        models: Array<{
          name: string;
          columns: Array<{ name: string; tests?: unknown[]; }>;
        }>;
      };

      const customerModel = parsed.models.find(
        (m) => m.name === "customer",
      )!;
      const nickCol = customerModel.columns.find(
        (c) => c.name === "nickname",
      )!;
      // Nullable column with no special role -- should have no tests key.
      expect(nickCol.tests).toBeUndefined();
    });
  });

  describe("associative tables", () => {
    it("generates model and schema for many-to-many associative table", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Student", { referenceMode: "student_id" })
        .withEntityType("Course", { referenceMode: "course_id" })
        .withBinaryFactType("Student enrolls in Course", {
          role1: { player: "Student", name: "enrolls in" },
          role2: { player: "Course", name: "has enrolled" },
        })
        .build();

      const schema = mapper.map(model);
      const dbt = renderDbt(schema);

      const assocModel = dbt.models.find(
        (m) => m.name === "student_enrolls_in_course",
      );
      expect(assocModel).toBeDefined();
      expect(assocModel!.sql).toContain("student_enrolls_in_course");
    });
  });
});
