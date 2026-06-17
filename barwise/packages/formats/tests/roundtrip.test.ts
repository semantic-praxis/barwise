/**
 * Round-trip tests for import/export functionality.
 *
 * These tests verify that exporting a model then importing it back
 * preserves structural equivalence. Perfect round-tripping is not
 * expected (DDL and OpenAPI lose ORM-specific semantics), but the
 * core structure should be preserved.
 */

import { openApiToJson, RelationalMapper, renderDdl, renderOpenApi } from "@barwise/core/mapping";
import { describe, expect, it } from "vitest";
import { DdlImportFormat } from "../src/DdlImportFormat.js";
import { OpenApiImportFormat } from "../src/OpenApiImportFormat.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

describe("Round-trip tests", () => {
  describe("DDL round-trip", () => {
    it("should preserve entity types and basic structure", () => {
      // Build a model with entities and relationships
      const originalModel = new ModelBuilder("Clinic")
        .withEntityType("Patient", { referenceMode: "patient_id" })
        .withEntityType("Doctor", { referenceMode: "doctor_id" })
        .withValueType("PatientName", { dataType: { name: "text" } })
        .withBinaryFactType("Patient has PatientName", {
          role1: { player: "Patient", name: "has" },
          role2: { player: "PatientName", name: "is name of" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .withBinaryFactType("Patient is treated by Doctor", {
          role1: { player: "Patient", name: "is treated by" },
          role2: { player: "Doctor", name: "treats" },
          uniqueness: "role1",
        })
        .build();

      // Export to DDL
      const mapper = new RelationalMapper();
      const schema = mapper.map(originalModel);
      const ddl = renderDdl(schema);

      // Import back
      const importer = new DdlImportFormat();
      const importResult = importer.parse(ddl);
      const importedModel = importResult.model;

      // Verify entity types exist
      const originalEntities = originalModel.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      const importedEntities = importedModel.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );

      expect(importedEntities.length).toBeGreaterThanOrEqual(
        originalEntities.length,
      );

      // Verify entity names are preserved (case-insensitive)
      const originalNames = originalEntities.map((e) => e.name.toLowerCase());
      const importedNames = importedEntities.map((e) => e.name.toLowerCase());

      for (const name of originalNames) {
        expect(importedNames).toContain(name);
      }

      // Verify relationships exist (at least one fact type per entity)
      expect(importedModel.factTypes.length).toBeGreaterThan(0);

      // Verify confidence is at least medium
      expect(importResult.confidence).not.toBe("low");
    });

    it("should preserve foreign key relationships", () => {
      const originalModel = new ModelBuilder("Library")
        .withEntityType("Author", { referenceMode: "author_id" })
        .withEntityType("Book", { referenceMode: "book_id" })
        .withBinaryFactType("Book is written by Author", {
          role1: { player: "Book", name: "is written by" },
          role2: { player: "Author", name: "wrote" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .build();

      // Export to DDL
      const mapper = new RelationalMapper();
      const schema = mapper.map(originalModel);
      const ddl = renderDdl(schema);

      // Import back
      const importer = new DdlImportFormat();
      const importResult = importer.parse(ddl);
      const importedModel = importResult.model;

      // Should have both entities
      const entities = importedModel.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities.length).toBeGreaterThanOrEqual(2);

      // Should have a fact type connecting them
      const connectingFacts = importedModel.factTypes.filter(
        (ft) =>
          ft.roles.length === 2
          && ft.roles.every((r) => {
            const player = importedModel.getObjectType(r.playerId);
            return player?.kind === "entity";
          }),
      );

      expect(connectingFacts.length).toBeGreaterThan(0);
    });

    it("should preserve mandatory constraints", () => {
      const originalModel = new ModelBuilder("Employee")
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withValueType("EmployeeName", { dataType: { name: "text" } })
        .withBinaryFactType("Employee has EmployeeName", {
          role1: { player: "Employee", name: "has" },
          role2: { player: "EmployeeName", name: "is name of" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .build();

      // Export to DDL
      const mapper = new RelationalMapper();
      const schema = mapper.map(originalModel);
      const ddl = renderDdl(schema);

      // Verify DDL has NOT NULL
      expect(ddl).toContain("NOT NULL");

      // Import back
      const importer = new DdlImportFormat();
      const importResult = importer.parse(ddl);
      const importedModel = importResult.model;

      // Should have mandatory constraint
      const allConstraints = importedModel.factTypes.flatMap(
        (ft) => ft.constraints,
      );
      const mandatoryConstraints = allConstraints.filter(
        (c) => c.type === "mandatory",
      );

      expect(mandatoryConstraints.length).toBeGreaterThan(0);
    });
  });

  describe("OpenAPI round-trip", () => {
    it("should preserve entity types and basic structure", () => {
      // Build a model with entities
      const originalModel = new ModelBuilder("Store")
        .withEntityType("Product", { referenceMode: "product_id" })
        .withEntityType("Category", { referenceMode: "category_id" })
        .withValueType("ProductName", { dataType: { name: "text" } })
        .withBinaryFactType("Product has ProductName", {
          role1: { player: "Product", name: "has" },
          role2: { player: "ProductName", name: "is name of" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .withBinaryFactType("Product belongs to Category", {
          role1: { player: "Product", name: "belongs to" },
          role2: { player: "Category", name: "contains" },
          uniqueness: "role1",
        })
        .build();

      // Export to OpenAPI
      const mapper = new RelationalMapper();
      const schema = mapper.map(originalModel);
      const spec = renderOpenApi(schema, {
        title: "Store API",
        version: "1.0.0",
        basePath: "/",
      });
      const json = openApiToJson(spec);

      // Import back
      const importer = new OpenApiImportFormat();
      const importResult = importer.parse(json);
      const importedModel = importResult.model;

      // Verify entity types exist
      const originalEntities = originalModel.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      const importedEntities = importedModel.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );

      expect(importedEntities.length).toBeGreaterThanOrEqual(
        originalEntities.length,
      );

      // Verify entity names are preserved
      const originalNames = originalEntities.map((e) => e.name.toLowerCase());
      const importedNames = importedEntities.map((e) => e.name.toLowerCase());

      for (const name of originalNames) {
        expect(importedNames).toContain(name);
      }

      // Verify relationships exist
      expect(importedModel.factTypes.length).toBeGreaterThan(0);
    });

    it("should preserve relationships via $ref", () => {
      const originalModel = new ModelBuilder("Order System")
        .withEntityType("Order", { referenceMode: "order_id" })
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withBinaryFactType("Order is placed by Customer", {
          role1: { player: "Order", name: "is placed by" },
          role2: { player: "Customer", name: "placed" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .build();

      // Export to OpenAPI
      const mapper = new RelationalMapper();
      const schema = mapper.map(originalModel);
      const spec = renderOpenApi(schema, {
        title: "Order API",
        version: "1.0.0",
        basePath: "/",
      });
      const json = openApiToJson(spec);

      // Verify JSON has $ref
      expect(json).toContain("$ref");

      // Import back
      const importer = new OpenApiImportFormat();
      const importResult = importer.parse(json);
      const importedModel = importResult.model;

      // Should have both entities
      const entities = importedModel.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities.length).toBeGreaterThanOrEqual(2);

      // Should have connecting fact types
      const connectingFacts = importedModel.factTypes.filter(
        (ft) =>
          ft.roles.length === 2
          && ft.roles.every((r) => {
            const player = importedModel.getObjectType(r.playerId);
            return player?.kind === "entity";
          }),
      );

      expect(connectingFacts.length).toBeGreaterThan(0);
    });
  });

  describe("DDL import -> re-export", () => {
    it("should produce structurally similar DDL on re-export", () => {
      const ddl = `
        CREATE TABLE customers (
          id INT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255)
        );

        CREATE TABLE orders (
          id INT PRIMARY KEY,
          customer_id INT NOT NULL,
          total DECIMAL(10, 2),
          FOREIGN KEY (customer_id) REFERENCES customers (id)
        );
      `;

      // Import
      const importer = new DdlImportFormat();
      const importResult = importer.parse(ddl);
      const model = importResult.model;

      // Re-export
      const mapper = new RelationalMapper();
      const schema = mapper.map(model);
      const reExportedDdl = renderDdl(schema);

      // Verify structure is preserved
      expect(reExportedDdl).toContain("customers");
      expect(reExportedDdl).toContain("orders");
      expect(reExportedDdl).toContain("PRIMARY KEY");
      expect(reExportedDdl).toContain("FOREIGN KEY");
      expect(reExportedDdl).toContain("NOT NULL");

      // Should reference customer_id relationship
      expect(reExportedDdl.toLowerCase()).toContain("customer");
    });

    it("should preserve multiple foreign keys", () => {
      const ddl = `
        CREATE TABLE users (
          id INT PRIMARY KEY,
          name VARCHAR(100)
        );

        CREATE TABLE posts (
          id INT PRIMARY KEY,
          author_id INT,
          reviewer_id INT,
          content TEXT,
          FOREIGN KEY (author_id) REFERENCES users (id),
          FOREIGN KEY (reviewer_id) REFERENCES users (id)
        );
      `;

      // Import
      const importer = new DdlImportFormat();
      const importResult = importer.parse(ddl);
      const model = importResult.model;

      // Should have multiple relationships to User
      const userEntity = model.objectTypes.find(
        (ot) => ot.kind === "entity" && ot.name.toLowerCase().includes("user"),
      );
      expect(userEntity).toBeDefined();

      const factsInvolvingUser = model.factTypes.filter((ft) =>
        ft.roles.some((r) => r.playerId === userEntity?.id)
      );

      expect(factsInvolvingUser.length).toBeGreaterThanOrEqual(2);

      // Re-export
      const mapper = new RelationalMapper();
      const schema = mapper.map(model);
      const reExportedDdl = renderDdl(schema);

      // Should have both foreign keys
      const fkMatches = reExportedDdl.match(/FOREIGN KEY/gi);
      expect(fkMatches).toBeTruthy();
      expect(fkMatches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("OpenAPI import -> re-export", () => {
    it("should produce structurally similar OpenAPI on re-export", () => {
      const openapi = `{
        "openapi": "3.0.0",
        "info": {
          "title": "Pet Store API",
          "version": "1.0.0"
        },
        "paths": {},
        "components": {
          "schemas": {
            "Pet": {
              "type": "object",
              "required": ["id", "name"],
              "properties": {
                "id": {
                  "type": "integer"
                },
                "name": {
                  "type": "string"
                },
                "species": {
                  "type": "string"
                }
              }
            },
            "Owner": {
              "type": "object",
              "required": ["id"],
              "properties": {
                "id": {
                  "type": "integer"
                },
                "name": {
                  "type": "string"
                },
                "pet": {
                  "$ref": "#/components/schemas/Pet"
                }
              }
            }
          }
        }
      }`;

      // Import
      const importer = new OpenApiImportFormat();
      const importResult = importer.parse(openapi);
      const model = importResult.model;

      // Should have Pet and Owner entities
      const entities = model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities.length).toBeGreaterThanOrEqual(2);

      // Re-export
      const mapper = new RelationalMapper();
      const schema = mapper.map(model);
      const spec = renderOpenApi(schema, {
        title: "Pet Store API",
        version: "1.0.0",
        basePath: "/",
      });
      const reExportedJson = openApiToJson(spec);

      // Verify structure is preserved
      expect(reExportedJson).toContain("Pet");
      expect(reExportedJson).toContain("Owner");
      expect(reExportedJson).toContain("properties");
      expect(reExportedJson).toContain("type");

      // Should have schema definitions
      const parsed = JSON.parse(reExportedJson);
      expect(parsed.components?.schemas).toBeDefined();
      expect(Object.keys(parsed.components.schemas).length).toBeGreaterThan(1);
    });
  });
});
