/**
 * Tests for the Avro schema renderer.
 *
 * renderAvro converts a RelationalSchema into Avro record schemas.
 * These tests verify:
 *   - One Avro record per table with PascalCase name
 *   - Field generation from columns
 *   - SQL-to-Avro type mapping (string, long, double, boolean, logical types)
 *   - Nullable columns become ["null", type] unions
 *   - PK fields annotated with doc
 *   - Optional namespace
 *   - avroSchemaToJson produces valid formatted JSON
 */
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { avroSchemaToJson, renderAvro } from "../../src/mapping/renderers/avro.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

describe("Avro renderer", () => {
  describe("basic structure", () => {
    it("generates one schema per table", () => {
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
      const avro = renderAvro(relSchema);

      expect(avro.schemas.length).toBe(relSchema.tables.length);
    });

    it("uses PascalCase for record names", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Student", { referenceMode: "student_id" })
        .withEntityType("Course", { referenceMode: "course_id" })
        .withBinaryFactType("Student enrolls in Course", {
          role1: { player: "Student", name: "enrolls in" },
          role2: { player: "Course", name: "has enrolled" },
        })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);

      const names = avro.schemas.map((s) => s.name);
      expect(names).toContain("Student");
      expect(names).toContain("Course");
      expect(names).toContain("StudentEnrollsInCourse");
    });

    it("sets type to record", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);

      expect(avro.schemas[0]!.type).toBe("record");
    });

    it("includes namespace when provided", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema, {
        namespace: "com.example.model",
      });

      expect(avro.schemas[0]!.namespace).toBe("com.example.model");
    });

    it("omits namespace when not provided", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);

      expect(avro.schemas[0]!.namespace).toBeUndefined();
    });
  });

  describe("type mapping", () => {
    it("maps TEXT to string", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);
      const customerSchema = avro.schemas.find(
        (s) => s.name === "Customer",
      )!;
      const pkField = customerSchema.fields.find(
        (f) => f.name === "customer_id",
      )!;

      // PK is non-nullable TEXT -> "string"
      expect(pkField.type).toBe("string");
    });

    it("maps INTEGER to long", () => {
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
      const avro = renderAvro(relSchema);
      const itemSchema = avro.schemas.find((s) => s.name === "Item")!;
      const qtyField = itemSchema.fields.find(
        (f) => f.name === "quantity",
      )!;

      // Nullable INTEGER -> ["null", "long"]
      expect(qtyField.type).toEqual(["null", "long"]);
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
      const avro = renderAvro(relSchema);
      const taskSchema = avro.schemas.find((s) => s.name === "Task")!;
      const boolField = taskSchema.fields.find(
        (f) => f.name === "is_complete",
      )!;

      expect(boolField.type).toEqual(["null", "boolean"]);
    });

    it("maps DATE to logical type date", () => {
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
      const avro = renderAvro(relSchema);
      const eventSchema = avro.schemas.find((s) => s.name === "Event")!;
      const dateField = eventSchema.fields.find(
        (f) => f.name === "event_date",
      )!;

      // Nullable DATE -> ["null", { type: "int", logicalType: "date" }]
      expect(dateField.type).toEqual([
        "null",
        { type: "int", logicalType: "date" },
      ]);
    });

    it("maps TIMESTAMP to logical type timestamp-millis", () => {
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
      const avro = renderAvro(relSchema);
      const logSchema = avro.schemas.find((s) => s.name === "Log")!;
      const tsField = logSchema.fields.find(
        (f) => f.name === "created_at",
      )!;

      expect(tsField.type).toEqual([
        "null",
        { type: "long", logicalType: "timestamp-millis" },
      ]);
    });

    it("maps DECIMAL to double", () => {
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
      const avro = renderAvro(relSchema);
      const productSchema = avro.schemas.find(
        (s) => s.name === "Product",
      )!;
      const priceField = productSchema.fields.find(
        (f) => f.name === "price",
      )!;

      expect(priceField.type).toEqual(["null", "double"]);
    });

    it("maps UUID to logical type uuid", () => {
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
      const avro = renderAvro(relSchema);
      const sessionSchema = avro.schemas.find(
        (s) => s.name === "Session",
      )!;
      const tokenField = sessionSchema.fields.find(
        (f) => f.name === "token",
      )!;

      expect(tokenField.type).toEqual([
        "null",
        { type: "string", logicalType: "uuid" },
      ]);
    });

    it("maps TIME to logical type time-millis", () => {
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
      const avro = renderAvro(relSchema);
      const shiftSchema = avro.schemas.find((s) => s.name === "Shift")!;
      const field = shiftSchema.fields.find((f) => f.name === "start_time")!;

      expect(field.type).toEqual(["null", { type: "int", logicalType: "time-millis" }]);
    });

    it("maps DATETIME to logical type timestamp-millis", () => {
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
      const avro = renderAvro(relSchema);
      const logSchema = avro.schemas.find((s) => s.name === "Log")!;
      const field = logSchema.fields.find((f) => f.name === "updated_at")!;

      expect(field.type).toEqual(["null", { type: "long", logicalType: "timestamp-millis" }]);
    });

    it("maps BINARY and BLOB to bytes", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Device", { referenceMode: "device_id" })
        .withValueType("MacAddress", { dataType: { name: "binary", length: 6 } })
        .withValueType("Firmware", { dataType: { name: "binary" } })
        .withBinaryFactType("Device has MacAddress", {
          role1: { player: "Device", name: "has" },
          role2: { player: "MacAddress", name: "is of" },
          uniqueness: "role1",
        })
        .withBinaryFactType("Device has Firmware", {
          role1: { player: "Device", name: "has" },
          role2: { player: "Firmware", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);
      const deviceSchema = avro.schemas.find((s) => s.name === "Device")!;

      expect(deviceSchema.fields.find((f) => f.name === "mac_address")!.type).toEqual([
        "null",
        "bytes",
      ]);
      expect(deviceSchema.fields.find((f) => f.name === "firmware")!.type).toEqual([
        "null",
        "bytes",
      ]);
    });

    it("falls back to string for an unrecognized SQL type", () => {
      const relSchema = {
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
      const avro = renderAvro(relSchema);
      const schema = avro.schemas.find((s) => s.name === "Widget")!;
      expect(schema.fields.find((f) => f.name === "payload")!.type).toBe("string");
    });
  });

  describe("nullability", () => {
    it("non-nullable columns have plain type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);
      const customerSchema = avro.schemas.find(
        (s) => s.name === "Customer",
      )!;
      const pkField = customerSchema.fields.find(
        (f) => f.name === "customer_id",
      )!;

      // PK is NOT NULL -> plain type, no union
      expect(pkField.type).toBe("string");
    });

    it("nullable columns become union with null", () => {
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
      const avro = renderAvro(relSchema);
      const customerSchema = avro.schemas.find(
        (s) => s.name === "Customer",
      )!;
      const emailField = customerSchema.fields.find(
        (f) => f.name === "email",
      )!;

      expect(emailField.type).toEqual(["null", "string"]);
    });
  });

  describe("PK annotation", () => {
    it("annotates PK fields with doc", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);
      const customerSchema = avro.schemas.find(
        (s) => s.name === "Customer",
      )!;
      const pkField = customerSchema.fields.find(
        (f) => f.name === "customer_id",
      )!;

      expect(pkField.doc).toBe("Primary key");
    });

    it("does not annotate non-PK fields", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Name", { dataType: { name: "text" } })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);
      const customerSchema = avro.schemas.find(
        (s) => s.name === "Customer",
      )!;
      const nameField = customerSchema.fields.find(
        (f) => f.name === "name",
      )!;

      expect(nameField.doc).toBeUndefined();
    });
  });

  describe("avroSchemaToJson", () => {
    it("produces valid formatted JSON", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);
      const json = avroSchemaToJson(avro.schemas[0]!);

      const parsed = JSON.parse(json);
      expect(parsed.type).toBe("record");
      expect(parsed.name).toBe("Customer");
      expect(parsed.fields).toBeInstanceOf(Array);
    });

    it("formats with 2-space indentation", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const relSchema = mapper.map(model);
      const avro = renderAvro(relSchema);
      const json = avroSchemaToJson(avro.schemas[0]!);

      // Should be multi-line with indentation.
      expect(json).toContain("\n");
      expect(json).toContain("  ");
    });
  });
});
