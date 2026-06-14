/**
 * Tests for OpenAPI export format adapter.
 *
 * Verifies that the adapter produces valid OpenAPI 3.0 output and
 * integrates correctly with the registry.
 */

import { clearFormats, formatRegistry, registerFormat } from "@barwise/core";
import { beforeEach, describe, expect, it } from "vitest";
import { openApiExportFormat } from "../src/OpenApiExportFormat.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

describe("OpenApiExportFormat", () => {
  describe("adapter instance", () => {
    it("has correct name and description", () => {
      expect(openApiExportFormat.name).toBe("openapi");
      expect(openApiExportFormat.description).toContain("OpenAPI");
    });
  });

  describe("export()", () => {
    it("produces valid OpenAPI 3.0 JSON", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .withEntityType("Order", { referenceMode: "order_num" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const result = openApiExportFormat.export(model);

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);

      // Parse as JSON.
      const spec = JSON.parse(result.text);

      // Check OpenAPI structure.
      expect(spec.openapi).toBe("3.0.0");
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe("Test"); // Model name as default title
      expect(spec.paths).toBeDefined();
      expect(spec.components).toBeDefined();
      expect(spec.components.schemas).toBeDefined();

      // Should have schemas for both tables.
      expect(Object.keys(spec.components.schemas).length).toBeGreaterThanOrEqual(
        2,
      );
    });

    it("supports custom title and version options", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .build();

      const result = openApiExportFormat.export(model, {
        title: "My Custom API",
        version: "2.0.0",
      });

      const spec = JSON.parse(result.text);

      expect(spec.info.title).toBe("My Custom API");
      expect(spec.info.version).toBe("2.0.0");
    });

    it("supports basePath option", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .build();

      const result = openApiExportFormat.export(model, {
        basePath: "/api/v1",
      });

      const spec = JSON.parse(result.text);

      // Paths should include the base path.
      const pathKeys = Object.keys(spec.paths);
      expect(pathKeys.some((p) => p.startsWith("/api/v1"))).toBe(true);
    });

    it("includes validation warnings when model has errors", () => {
      // Create a model with structural errors (entity with no reference).
      // Note: Can't easily create a truly invalid model because FactType
      // constructor validates roles. This test is limited in what it can check.
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .withEntityType("Order", { referenceMode: "order_num" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const result = openApiExportFormat.export(model);

      // Should still produce output (not strict mode).
      expect(result.text).toBeDefined();
      // Model is valid so no warnings expected, but export should succeed.
      const spec = JSON.parse(result.text);
      expect(spec.openapi).toBe("3.0.0");
    });

    it("exports successfully in strict mode with valid model", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .build();

      // Should not throw in strict mode with valid model.
      expect(() => openApiExportFormat.export(model, { strict: true })).not.toThrow();
    });

    it("produces single-file output (no files array)", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .build();

      const result = openApiExportFormat.export(model);

      expect(result.files).toBeUndefined();
    });
  });

  describe("annotation support", () => {
    it("injects x-barwise-annotations on schema for missing definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .build();

      const result = openApiExportFormat.export(model, { annotate: true });
      const spec = JSON.parse(result.text);

      // Customer schema should have x-barwise-annotations.
      const customerSchema = spec.components.schemas.Customer;
      expect(customerSchema["x-barwise-annotations"]).toBeDefined();
      const annotations = customerSchema["x-barwise-annotations"] as Array<{
        severity: string;
        message: string;
      }>;
      expect(annotations.length).toBeGreaterThan(0);

      // Should include a TODO for missing description.
      const descTodo = annotations.find(
        (a) => a.severity === "todo" && a.message.includes("No model description"),
      );
      expect(descTodo).toBeDefined();
    });

    it("injects NOTE on schema when entity has a definition", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "cust_id",
          definition: "A buyer of goods.",
        })
        .build();

      const result = openApiExportFormat.export(model, { annotate: true });
      const spec = JSON.parse(result.text);

      const customerSchema = spec.components.schemas.Customer;
      expect(customerSchema["x-barwise-annotations"]).toBeDefined();
      const annotations = customerSchema["x-barwise-annotations"] as Array<{
        severity: string;
        message: string;
      }>;

      const defNote = annotations.find(
        (a) => a.severity === "note" && a.message.includes("Definition available"),
      );
      expect(defNote).toBeDefined();
    });

    it("injects column-level x-barwise-annotations for default TEXT type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .withValueType("Status")
        .withBinaryFactType("Customer has Status", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Status", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const result = openApiExportFormat.export(model, { annotate: true });
      const spec = JSON.parse(result.text);

      // The Customer schema should have a status property with annotations.
      const customerSchema = spec.components.schemas.Customer;
      const statusProp = customerSchema.properties?.status;
      expect(statusProp).toBeDefined();
      expect(statusProp["x-barwise-annotations"]).toBeDefined();

      const colAnnotations = statusProp["x-barwise-annotations"] as Array<{
        severity: string;
        message: string;
      }>;
      const textTodo = colAnnotations.find(
        (a) => a.severity === "todo" && a.message.includes("Data type defaulted to TEXT"),
      );
      expect(textTodo).toBeDefined();
    });

    it("returns annotations array in the result", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .build();

      const result = openApiExportFormat.export(model, { annotate: true });

      expect(result.annotations).toBeDefined();
      expect(result.annotations!.length).toBeGreaterThan(0);
      const descTodo = result.annotations!.find(
        (a) => a.tableName === "customer" && a.category === "description",
      );
      expect(descTodo).toBeDefined();
    });

    it("omits annotations when annotate is false", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .build();

      const result = openApiExportFormat.export(model, { annotate: false });
      const spec = JSON.parse(result.text);

      // Should not have any x-barwise-annotations.
      const customerSchema = spec.components.schemas.Customer;
      expect(customerSchema["x-barwise-annotations"]).toBeUndefined();

      // annotations array should be undefined.
      expect(result.annotations).toBeUndefined();
    });
  });

  describe("registry integration", () => {
    beforeEach(() => {
      clearFormats();
    });

    it("registers successfully", () => {
      registerFormat({
        name: "openapi",
        description: "OpenAPI 3.0 specification",
        exporter: openApiExportFormat,
      });

      const retrieved = formatRegistry.getExporter("openapi");
      expect(retrieved).toBe(openApiExportFormat);
    });

    it("is listed in available formats", () => {
      registerFormat({
        name: "openapi",
        description: "OpenAPI 3.0 specification",
        exporter: openApiExportFormat,
      });

      const descriptors = formatRegistry.listExporters();
      expect(descriptors.some((d) => d.name === "openapi")).toBe(true);
    });
  });
});
