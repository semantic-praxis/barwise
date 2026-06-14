/**
 * Tests for dbt export format adapter.
 *
 * Verifies that DbtExportFormat correctly wraps the existing renderDbt()
 * function as an ExportFormatAdapter, with validation, annotation support,
 * multi-file output, and proper ExportResult structure.
 */
import { describe, expect, it } from "vitest";
import { DbtExportFormat } from "../src/DbtExportFormat.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const dbtFormat = new DbtExportFormat();

describe("DbtExportFormat", () => {
  describe("basic export", () => {
    it("exports a simple model to dbt files", () => {
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

      const result = dbtFormat.export(model);

      // Should produce text output.
      expect(result.text).toContain("schema.yml");
      expect(result.text).toContain("customer");
    });

    it("produces multi-file output", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Patient", { referenceMode: "patient_id" })
        .build();

      const result = dbtFormat.export(model);

      // Should have files array for multi-file format.
      expect(result.files).toBeDefined();
      expect(result.files!.length).toBeGreaterThanOrEqual(2);

      // Should have model SQL file.
      const sqlFile = result.files!.find((f) => f.name.endsWith(".sql"));
      expect(sqlFile).toBeDefined();
      expect(sqlFile!.content).toContain("SELECT");
      expect(sqlFile!.content).toContain("source(");

      // Should have schema.yml file.
      const schemaFile = result.files!.find((f) => f.name === "models/schema.yml");
      expect(schemaFile).toBeDefined();
      expect(schemaFile!.content).toContain("version: 2");
      expect(schemaFile!.content).toContain("models:");
    });
  });

  describe("annotation support", () => {
    it("includes annotations when annotate is true (default)", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A person or organization that purchases goods.",
        })
        .build();

      const result = dbtFormat.export(model, { annotate: true });

      // Should have annotations in the result.
      expect(result.annotations).toBeDefined();
      expect(result.annotations!.length).toBeGreaterThan(0);
    });

    it("omits annotations when annotate is false", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = dbtFormat.export(model, { annotate: false });

      // Should not have annotations.
      expect(result.annotations).toBeUndefined();
    });
  });

  describe("dbt-specific options", () => {
    it("passes sourceName through to renderDbt", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = dbtFormat.export(model, { sourceName: "staging" });

      // The SQL model files should reference the custom source name.
      const sqlFile = result.files!.find((f) => f.name.endsWith(".sql"));
      expect(sqlFile).toBeDefined();
      expect(sqlFile!.content).toContain("staging");
    });
  });

  describe("validation and strict mode", () => {
    it("exports with validation warnings when strict is false (default)", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = dbtFormat.export(model, { strict: false });

      // Should succeed and produce output.
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.files).toBeDefined();
    });

    it("does not throw in strict mode for a valid model", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      expect(() => dbtFormat.export(model, { strict: true })).not.toThrow();
    });
  });

  describe("format metadata", () => {
    it("has correct name and description", () => {
      expect(dbtFormat.name).toBe("dbt");
      expect(dbtFormat.description).toBe("dbt model files and schema.yml");
    });
  });

  describe("result structure", () => {
    it("returns ExportResult with text and files", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = dbtFormat.export(model);

      expect(result.text).toBeDefined();
      expect(typeof result.text).toBe("string");
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
    });

    it("file paths follow models/ convention", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const result = dbtFormat.export(model);

      for (const file of result.files!) {
        expect(file.name).toMatch(/^models\//);
      }
    });
  });
});
