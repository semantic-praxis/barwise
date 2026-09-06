/**
 * Tests for the OpenAPI 3.0 renderer.
 *
 * renderOpenApi converts a RelationalSchema into an OpenAPI 3.0.0
 * specification. These tests verify:
 *   - Top-level structure (openapi version, info, paths, components)
 *   - One component schema per table with PascalCase name
 *   - SQL-to-JSON-Schema type mapping
 *   - Nullable columns get nullable: true
 *   - Non-nullable columns listed in required array
 *   - FK columns rendered as $ref
 *   - CRUD paths generated per resource
 *   - Options (title, version, basePath)
 *   - openApiToJson produces valid formatted JSON
 */
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import type { RelationalSchema } from "../../src/mapping/RelationalSchema.js";
import { openApiToJson, renderOpenApi } from "../../src/mapping/renderers/openapi.js";
import type { OpenApiSpec } from "../../src/mapping/renderers/openapi.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

/** Helper: get a component schema by name from the spec. */
function getSchema(
  spec: OpenApiSpec,
  name: string,
): Record<string, unknown> | undefined {
  return (
    spec.components.schemas as Record<string, Record<string, unknown>>
  )[name];
}

/** Helper: get properties from a component schema. */
function getProperties(
  schema: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  return schema["properties"] as Record<string, Record<string, unknown>>;
}

describe("OpenAPI renderer", () => {
  describe("top-level structure", () => {
    it("produces a valid OpenAPI 3.0.0 document", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);

      expect(spec.openapi).toBe("3.0.0");
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe("ORM API");
      expect(spec.info.version).toBe("1.0.0");
      expect(spec.paths).toBeDefined();
      expect(spec.components.schemas).toBeDefined();
    });

    it("generates one component schema per table", () => {
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

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schemaNames = Object.keys(spec.components.schemas);

      expect(schemaNames.length).toBe(relSchema.tables.length);
    });

    it("uses PascalCase for schema names", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Student", { referenceMode: "student_id" })
        .withEntityType("Course", { referenceMode: "course_id" })
        .withBinaryFactType("Student enrolls in Course", {
          role1: { player: "Student", name: "enrolls in" },
          role2: { player: "Course", name: "has enrolled" },
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schemaNames = Object.keys(spec.components.schemas);

      expect(schemaNames).toContain("Student");
      expect(schemaNames).toContain("Course");
      expect(schemaNames).toContain("StudentEnrollsInCourse");
    });
  });

  describe("options", () => {
    it("applies custom title and version", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema, {
        title: "My Domain API",
        version: "2.0.0",
      });

      expect(spec.info.title).toBe("My Domain API");
      expect(spec.info.version).toBe("2.0.0");
    });

    it("applies custom basePath to paths", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema, { basePath: "/api/v1" });
      const pathKeys = Object.keys(spec.paths);

      expect(pathKeys.some((p) => p.startsWith("/api/v1/"))).toBe(true);
    });

    it("normalizes a basePath with no leading or trailing slash", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema, { basePath: "api/v1" });
      const pathKeys = Object.keys(spec.paths);

      expect(pathKeys).toContain("/api/v1/customer");
    });
  });

  describe("model overload (population examples)", () => {
    function customerModel() {
      return new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();
    }

    it("accepts a model as the second parameter and includes its population examples", () => {
      // renderPopulationAsOpenApiExamples keys the example object by role
      // *name*; renderComponentSchema looks examples up by column name --
      // naming the identifying role after its (reference-mode-derived)
      // column is what makes a per-property example attach here.
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      const email = model.addObjectType({ name: "Email", kind: "value" });
      const idFt = model.addFactType({
        name: "Customer has Email",
        roles: [
          { id: "r1", name: "customer_id", playerId: customer.id },
          { id: "r2", name: "is of", playerId: email.id },
        ],
        readings: ["{0} has {1}", "{1} is of {0}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"], isPreferred: true }],
      });
      const pop = model.addPopulation({ factTypeId: idFt.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "c001@example.com" } });

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema, model);
      const schema = getSchema(spec, "Customer")!;

      expect(schema["example"]).toBeDefined();
      const props = getProperties(schema);
      expect(props["customer_id"]!["example"]).toBe("C001");
    });

    it("accepts a model with options as a third parameter", () => {
      const model = customerModel();
      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema, model, { title: "Model + Options API" });

      expect(spec.info.title).toBe("Model + Options API");
    });

    it("omits examples when includeExamples is false, even with a model", () => {
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      const email = model.addObjectType({ name: "Email", kind: "value" });
      const idFt = model.addFactType({
        name: "Customer has Email",
        roles: [
          { id: "r1", name: "customer_id", playerId: customer.id },
          { id: "r2", name: "is of", playerId: email.id },
        ],
        readings: ["{0} has {1}", "{1} is of {0}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"], isPreferred: true }],
      });
      const pop = model.addPopulation({ factTypeId: idFt.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "c001@example.com" } });

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema, model, { includeExamples: false });
      const schema = getSchema(spec, "Customer")!;

      expect(schema["example"]).toBeUndefined();
    });
  });

  describe("component schemas", () => {
    it("marks non-nullable columns as required", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Customer")!;

      const required = schema["required"] as string[];
      expect(required).toContain("customer_id");
    });

    it("does not include nullable columns in required", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Email", { dataType: { name: "text" } })
        .withBinaryFactType("Customer has Email", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Email", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Customer")!;

      const required = schema["required"] as string[];
      expect(required).toContain("customer_id");
      expect(required).not.toContain("email");
    });

    it("omits the required array entirely when every column is nullable", () => {
      const relSchema: RelationalSchema = {
        sourceModelId: "test",
        tables: [
          {
            name: "note",
            columns: [{ name: "body", dataType: "TEXT", nullable: true }],
            primaryKey: { columnNames: ["body"] },
            foreignKeys: [],
            sourceElementId: "ot-note",
          },
        ],
      };
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Note")!;

      expect(schema["required"]).toBeUndefined();
    });

    it("renders FK columns as $ref", () => {
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

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const orderSchema = getSchema(spec, "Order")!;
      const props = getProperties(orderSchema);

      // The FK column should reference the Customer schema.
      const fkProp = Object.values(props).find((p) => p["$ref"]);
      expect(fkProp).toBeDefined();
      expect(fkProp!["$ref"]).toBe("#/components/schemas/Customer");
    });
  });

  describe("type mapping", () => {
    it("maps TEXT to string", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Customer")!;
      const props = getProperties(schema);

      expect(props["customer_id"]!["type"]).toBe("string");
    });

    it("maps INTEGER to integer", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Item", { referenceMode: "item_id" })
        .withValueType("Quantity", { dataType: { name: "integer" } })
        .withBinaryFactType("Item has Quantity", {
          role1: { player: "Item", name: "has" },
          role2: { player: "Quantity", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Item")!;
      const props = getProperties(schema);

      expect(props["quantity"]!["type"]).toBe("integer");
      expect(props["quantity"]!["nullable"]).toBe(true);
    });

    it("maps BOOLEAN to boolean", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Task", { referenceMode: "task_id" })
        .withValueType("IsComplete", { dataType: { name: "boolean" } })
        .withBinaryFactType("Task has IsComplete", {
          role1: { player: "Task", name: "has" },
          role2: { player: "IsComplete", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Task")!;
      const props = getProperties(schema);

      expect(props["is_complete"]!["type"]).toBe("boolean");
    });

    it("maps DATE to string with format date", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Event", { referenceMode: "event_id" })
        .withValueType("EventDate", { dataType: { name: "date" } })
        .withBinaryFactType("Event has EventDate", {
          role1: { player: "Event", name: "has" },
          role2: { player: "EventDate", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Event")!;
      const props = getProperties(schema);

      expect(props["event_date"]!["type"]).toBe("string");
      expect(props["event_date"]!["format"]).toBe("date");
    });

    it("maps TIMESTAMP to string with format date-time", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Log", { referenceMode: "log_id" })
        .withValueType("CreatedAt", { dataType: { name: "timestamp" } })
        .withBinaryFactType("Log has CreatedAt", {
          role1: { player: "Log", name: "has" },
          role2: { player: "CreatedAt", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Log")!;
      const props = getProperties(schema);

      expect(props["created_at"]!["type"]).toBe("string");
      expect(props["created_at"]!["format"]).toBe("date-time");
    });

    it("maps DECIMAL to number", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Product", { referenceMode: "product_id" })
        .withValueType("Price", {
          dataType: { name: "decimal", length: 10, scale: 2 },
        })
        .withBinaryFactType("Product has Price", {
          role1: { player: "Product", name: "has" },
          role2: { player: "Price", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Product")!;
      const props = getProperties(schema);

      expect(props["price"]!["type"]).toBe("number");
    });

    it("maps TIME to string with format time", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Shift", { referenceMode: "shift_id" })
        .withValueType("StartTime", { dataType: { name: "time" } })
        .withBinaryFactType("Shift has StartTime", {
          role1: { player: "Shift", name: "has" },
          role2: { player: "StartTime", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Shift")!;
      const props = getProperties(schema);

      expect(props["start_time"]!["type"]).toBe("string");
      expect(props["start_time"]!["format"]).toBe("time");
    });

    it("maps BLOB (unbounded binary) to string with format binary", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Document", { referenceMode: "document_id" })
        .withValueType("Content", { dataType: { name: "binary" } })
        .withBinaryFactType("Document has Content", {
          role1: { player: "Document", name: "has" },
          role2: { player: "Content", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Document")!;
      const props = getProperties(schema);

      expect(props["content"]!["type"]).toBe("string");
      expect(props["content"]!["format"]).toBe("binary");
    });

    it("maps a fixed-length BINARY(n) to string with format binary", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Device", { referenceMode: "device_id" })
        .withValueType("MacAddress", { dataType: { name: "binary", length: 6 } })
        .withBinaryFactType("Device has MacAddress", {
          role1: { player: "Device", name: "has" },
          role2: { player: "MacAddress", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Device")!;
      const props = getProperties(schema);

      expect(props["mac_address"]!["type"]).toBe("string");
      expect(props["mac_address"]!["format"]).toBe("binary");
    });

    it("maps DATETIME to string with format date-time", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Log", { referenceMode: "log_id" })
        .withValueType("UpdatedAt", { dataType: { name: "datetime" } })
        .withBinaryFactType("Log has UpdatedAt", {
          role1: { player: "Log", name: "has" },
          role2: { player: "UpdatedAt", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Log")!;
      const props = getProperties(schema);

      expect(props["updated_at"]!["type"]).toBe("string");
      expect(props["updated_at"]!["format"]).toBe("date-time");
    });

    it("falls back to string for an unrecognized SQL type", () => {
      const relSchema: RelationalSchema = {
        sourceModelId: "test",
        tables: [
          {
            name: "widget",
            columns: [{ name: "payload", dataType: "JSONB", nullable: false }],
            primaryKey: { columnNames: ["payload"] },
            foreignKeys: [],
            sourceElementId: "ot-widget",
          },
        ],
      };
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Widget")!;
      const props = getProperties(schema);

      expect(props["payload"]!["type"]).toBe("string");
      expect(props["payload"]!["format"]).toBeUndefined();
    });

    it("maps UUID to string with format uuid", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Session", { referenceMode: "session_id" })
        .withValueType("Token", { dataType: { name: "uuid" } })
        .withBinaryFactType("Session has Token", {
          role1: { player: "Session", name: "has" },
          role2: { player: "Token", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const schema = getSchema(spec, "Session")!;
      const props = getProperties(schema);

      expect(props["token"]!["type"]).toBe("string");
      expect(props["token"]!["format"]).toBe("uuid");
    });
  });

  describe("CRUD paths", () => {
    it("generates collection and item paths per table", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const pathKeys = Object.keys(spec.paths);

      expect(pathKeys).toContain("/customer");
      expect(pathKeys).toContain("/customer/{customer_id}");
    });

    it("generates GET and POST on collection path", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const collectionPath = spec.paths["/customer"] as Record<string, unknown>;

      expect(collectionPath["get"]).toBeDefined();
      expect(collectionPath["post"]).toBeDefined();
    });

    it("generates GET, PUT, DELETE on item path", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const itemPath = spec.paths["/customer/{customer_id}"] as Record<
        string,
        unknown
      >;

      expect(itemPath["get"]).toBeDefined();
      expect(itemPath["put"]).toBeDefined();
      expect(itemPath["delete"]).toBeDefined();
    });

    it("uses kebab-case for path segments", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Student", { referenceMode: "student_id" })
        .withEntityType("Course", { referenceMode: "course_id" })
        .withBinaryFactType("Student enrolls in Course", {
          role1: { player: "Student", name: "enrolls in" },
          role2: { player: "Course", name: "has enrolled" },
        })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const pathKeys = Object.keys(spec.paths);

      expect(pathKeys.some((p) => p.includes("student-enrolls-in-course"))).toBe(
        true,
      );
    });

    it("references component schemas in responses", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const collectionPath = spec.paths["/customer"] as Record<string, Record<string, unknown>>;
      const getOp = collectionPath["get"] as Record<string, unknown>;
      const responses = getOp["responses"] as Record<string, Record<string, unknown>>;
      const ok = responses["200"] as Record<string, unknown>;
      const content = ok["content"] as Record<string, Record<string, unknown>>;
      const jsonContent = content["application/json"] as Record<string, unknown>;
      const schema = jsonContent["schema"] as Record<string, unknown>;

      expect(schema["type"]).toBe("array");
      const items = schema["items"] as Record<string, string>;
      expect(items["$ref"]).toBe("#/components/schemas/Customer");
    });

    it("falls back to 'id' as the path parameter when the table declares no primary key columns", () => {
      const relSchema: RelationalSchema = {
        sourceModelId: "test",
        tables: [
          {
            name: "log_entry",
            columns: [{ name: "message", dataType: "TEXT", nullable: false }],
            primaryKey: { columnNames: [] },
            foreignKeys: [],
            sourceElementId: "ft-log-entry",
          },
        ],
      };
      const spec = renderOpenApi(relSchema);
      const pathKeys = Object.keys(spec.paths);

      expect(pathKeys).toContain("/log-entry/{id}");
    });
  });

  describe("openApiToJson", () => {
    it("produces valid formatted JSON", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const json = openApiToJson(spec);

      const parsed = JSON.parse(json);
      expect(parsed.openapi).toBe("3.0.0");
      expect(parsed.components.schemas.Customer).toBeDefined();
    });

    it("formats with 2-space indentation", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const spec = renderOpenApi(relSchema);
      const json = openApiToJson(spec);

      expect(json).toContain("\n");
      expect(json).toContain("  ");
    });
  });
});
