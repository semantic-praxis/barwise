/**
 * Tests for the NORMA import format adapter.
 *
 * Verifies that NormaImportFormat correctly implements the ImportFormat
 * interface and integrates with the unified format registry.
 */
import { clearFormats, getExporter, getImporter } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { NormaImportFormat } from "../src/norma/NormaImportFormat.js";
import { NormaImportError } from "../src/norma/NormaXmlImporter.js";
import { normaFormat, registerStandardFormats } from "../src/registration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
}

describe("NormaImportFormat", () => {
  const format = new NormaImportFormat();

  describe("interface properties", () => {
    it("has correct name", () => {
      expect(format.name).toBe("norma");
    });

    it("has correct description", () => {
      expect(format.description).toContain("NORMA");
    });

    it("declares text input kind", () => {
      expect(format.inputKind).toBe("text");
    });

    it("implements parse but not parseAsync or enrich", () => {
      expect(format.parse).toBeDefined();
      expect(typeof format.parse).toBe("function");
      expect((format as Record<string, unknown>).parseAsync).toBeUndefined();
      expect((format as Record<string, unknown>).enrich).toBeUndefined();
    });
  });

  describe("parse()", () => {
    it("parses a NORMA XML file into an ORM model", () => {
      const xml = loadFixture("orderManagement.orm");
      const result = format.parse(xml);

      expect(result.model).toBeDefined();
      expect(result.model.objectTypes.length).toBeGreaterThan(0);
      expect(result.model.factTypes.length).toBeGreaterThan(0);
      expect(result.confidence).toBe("high");
      expect(result.warnings).toEqual([]);
    });

    it("applies modelName option", () => {
      const xml = loadFixture("orderManagement.orm");
      const result = format.parse(xml, { modelName: "Custom Name" });

      expect(result.model.name).toBe("Custom Name");
    });

    it("throws NormaImportError on invalid XML", () => {
      expect(() => format.parse("not xml at all")).toThrow(NormaImportError);
    });

    it("throws NormaImportError on empty input", () => {
      expect(() => format.parse("")).toThrow(NormaImportError);
    });

    it("parses multiple fixture files", () => {
      for (const fixture of ["personCountryDemo.orm", "universityEnrollment.orm"]) {
        const xml = loadFixture(fixture);
        const result = format.parse(xml);

        expect(result.model).toBeDefined();
        expect(result.model.objectTypes.length).toBeGreaterThan(0);
        expect(result.confidence).toBe("high");
      }
    });
  });

  describe("format descriptor", () => {
    it("normaFormat has correct shape", () => {
      expect(normaFormat.name).toBe("norma");
      expect(normaFormat.importer).toBeDefined();
      // NORMA is now bidirectional: it carries an exporter too.
      expect(normaFormat.exporter).toBeDefined();
    });
  });

  describe("registry integration", () => {
    beforeEach(() => {
      clearFormats();
    });

    it("is discoverable via registerStandardFormats", () => {
      registerStandardFormats();

      const importer = getImporter("norma");
      expect(importer).toBeDefined();
      expect(importer?.name).toBe("norma");
    });

    it("is listed as an exporter", () => {
      registerStandardFormats();

      // norma is now bidirectional; getExporter should find it
      const exporter = getExporter("norma");
      expect(exporter).toBeDefined();
      expect(exporter?.name).toBe("norma");
    });
  });
});
