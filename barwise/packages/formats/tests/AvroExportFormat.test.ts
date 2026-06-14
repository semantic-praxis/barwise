/**
 * Tests for Avro export format adapter.
 *
 * Verifies that AvroExportFormat correctly wraps the existing renderAvro()
 * function as an ExportFormatAdapter, with validation, multi-file output,
 * and proper ExportResult structure.
 */
import { describe, expect, it } from "vitest";
import { AvroExportFormat } from "../src/AvroExportFormat.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const avroFormat = new AvroExportFormat();

describe("AvroExportFormat", () => {
  describe("basic export", () => {
    it("exports a simple model to Avro schemas", () => {
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

      const result = avroFormat.export(model);

      // Should produce text output with Avro schema content.
      expect(result.text).toContain('"type": "record"');
      expect(result.text).toContain(".avsc");
    });

    it("produces multi-file output with .avsc files", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Patient", { referenceMode: "patient_id" })
        .build();

      const result = avroFormat.export(model);

      // Should have files array for multi-file format.
      expect(result.files).toBeDefined();
      expect(result.files!.length).toBeGreaterThanOrEqual(1);

      // Each file should be an .avsc file with valid JSON.
      for (const file of result.files!) {
        expect(file.name).toMatch(/\.avsc$/);
        const parsed = JSON.parse(file.content);
        expect(parsed.type).toBe("record");
        expect(parsed.fields).toBeDefined();
      }
    });
  });

  describe("avro-specific options", () => {
    it("passes namespace through to renderAvro", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = avroFormat.export(model, { namespace: "com.example.model" });

      // The schema files should include the namespace.
      const file = result.files![0]!;
      const parsed = JSON.parse(file.content);
      expect(parsed.namespace).toBe("com.example.model");
    });
  });

  describe("validation and strict mode", () => {
    it("exports with validation warnings when strict is false (default)", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = avroFormat.export(model, { strict: false });

      // Should succeed and produce output.
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.files).toBeDefined();
    });

    it("does not throw in strict mode for a valid model", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      expect(() => avroFormat.export(model, { strict: true })).not.toThrow();
    });
  });

  describe("format metadata", () => {
    it("has correct name and description", () => {
      expect(avroFormat.name).toBe("avro");
      expect(avroFormat.description).toBe("Apache Avro schema definitions (.avsc)");
    });
  });

  describe("annotation support", () => {
    it("injects TODO in record doc for missing definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = avroFormat.export(model, { annotate: true });

      // Parse the first .avsc file.
      const file = result.files![0]!;
      const parsed = JSON.parse(file.content);

      // Record doc should contain a TODO annotation.
      expect(parsed.doc).toBeDefined();
      expect(parsed.doc).toContain("[TODO(barwise):");
      expect(parsed.doc).toContain("No model description");
    });

    it("injects NOTE in record doc when entity has a definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A buyer of goods.",
        })
        .build();

      const result = avroFormat.export(model, { annotate: true });

      const file = result.files![0]!;
      const parsed = JSON.parse(file.content);

      expect(parsed.doc).toBeDefined();
      expect(parsed.doc).toContain("[NOTE(barwise):");
      expect(parsed.doc).toContain("Definition available");
    });

    it("injects field-level TODO for default TEXT data type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Status")
        .withBinaryFactType("Customer has Status", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Status", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const result = avroFormat.export(model, { annotate: true });

      const file = result.files![0]!;
      const parsed = JSON.parse(file.content);

      // Find the status field.
      const statusField = parsed.fields.find(
        (f: { name: string; }) => f.name === "status",
      );
      expect(statusField).toBeDefined();
      expect(statusField.doc).toContain("[TODO(barwise):");
      expect(statusField.doc).toContain("Data type defaulted to TEXT");
    });

    it("returns annotations array in the result", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = avroFormat.export(model, { annotate: true });

      expect(result.annotations).toBeDefined();
      expect(result.annotations!.length).toBeGreaterThan(0);
      const descTodo = result.annotations!.find(
        (a) => a.tableName === "customer" && a.category === "description",
      );
      expect(descTodo).toBeDefined();
    });

    it("omits annotations when annotate is false", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = avroFormat.export(model, { annotate: false });

      const file = result.files![0]!;
      const parsed = JSON.parse(file.content);

      // Record doc should NOT contain barwise annotations.
      // (It may have "Primary key" doc on the PK field, but no barwise annotations.)
      if (parsed.doc) {
        expect(parsed.doc).not.toContain("barwise");
      }

      // annotations array should be undefined.
      expect(result.annotations).toBeUndefined();
    });
  });

  describe("result structure", () => {
    it("returns ExportResult with text and files", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = avroFormat.export(model);

      expect(result.text).toBeDefined();
      expect(typeof result.text).toBe("string");
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
    });

    it("uses PascalCase for Avro record names in file names", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = avroFormat.export(model);

      // Avro schema names should be PascalCase.
      const file = result.files![0]!;
      expect(file.name).toMatch(/^[A-Z]/);
    });
  });
});
