import { describe, expect, it } from "vitest";
import { analyzeImpact } from "../../src/lineage/impact.js";
import type { LineageManifest } from "../../src/lineage/types.js";

describe("Impact Analysis", () => {
  it("should find all artifacts that depend on a changed element", () => {
    const customerEntityId = "entity-customer-123";

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: "abc123",
      exports: [
        {
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: customerEntityId,
              elementType: "EntityType",
              elementName: "Customer",
            },
            {
              elementId: "entity-order-456",
              elementType: "EntityType",
              elementName: "Order",
            },
          ],
        },
        {
          artifact: "models/customer.sql",
          format: "dbt",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: customerEntityId,
              elementType: "EntityType",
              elementName: "Customer",
            },
          ],
        },
        {
          artifact: "models/order.sql",
          format: "dbt",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: "entity-order-456",
              elementType: "EntityType",
              elementName: "Order",
            },
          ],
        },
      ],
    };

    const report = analyzeImpact(manifest, customerEntityId);

    expect(report.changedElement).toBe(customerEntityId);
    expect(report.affectedArtifacts).toHaveLength(2);

    // Should find schema.sql
    const schemaSql = report.affectedArtifacts.find(a => a.artifact === "schema.sql");
    expect(schemaSql).toBeDefined();
    expect(schemaSql!.format).toBe("ddl");
    expect(schemaSql!.relationship).toContain("entity type Customer");

    // Should find models/customer.sql
    const customerSql = report.affectedArtifacts.find(a => a.artifact === "models/customer.sql");
    expect(customerSql).toBeDefined();
    expect(customerSql!.format).toBe("dbt");

    // Should NOT find models/order.sql (doesn't reference Customer)
    const orderSql = report.affectedArtifacts.find(a => a.artifact === "models/order.sql");
    expect(orderSql).toBeUndefined();
  });

  it("should return empty list when element has no dependent artifacts", () => {
    const unusedElementId = "entity-unused-999";

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: "abc123",
      exports: [
        {
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: "entity-customer-123",
              elementType: "EntityType",
              elementName: "Customer",
            },
          ],
        },
      ],
    };

    const report = analyzeImpact(manifest, unusedElementId);

    expect(report.changedElement).toBe(unusedElementId);
    expect(report.affectedArtifacts).toHaveLength(0);
  });

  it("should return empty list when no manifest exists", () => {
    const report = analyzeImpact(undefined, "some-element-id");

    expect(report.changedElement).toBe("some-element-id");
    expect(report.affectedArtifacts).toHaveLength(0);
  });

  it("should generate appropriate relationship descriptions for different element types", () => {
    const entityId = "entity-1";
    const valueTypeId = "value-1";
    const factTypeId = "fact-1";
    const constraintId = "constraint-1";
    const roleId = "role-1";

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: "abc123",
      exports: [
        {
          artifact: "entity_artifact.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: entityId,
              elementType: "EntityType",
              elementName: "Customer",
            },
          ],
        },
        {
          artifact: "value_artifact.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: valueTypeId,
              elementType: "ValueType",
              elementName: "Email",
            },
          ],
        },
        {
          artifact: "fact_artifact.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: factTypeId,
              elementType: "FactType",
              elementName: "Customer places Order",
            },
          ],
        },
        {
          artifact: "constraint_artifact.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: constraintId,
              elementType: "Constraint",
              elementName: "UC: Customer",
            },
          ],
        },
        {
          artifact: "role_artifact.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId: roleId,
              elementType: "Role",
              elementName: "places",
            },
          ],
        },
      ],
    };

    // Test EntityType relationship
    const entityReport = analyzeImpact(manifest, entityId);
    expect(entityReport.affectedArtifacts[0].relationship).toContain("entity type Customer");

    // Test ValueType relationship
    const valueReport = analyzeImpact(manifest, valueTypeId);
    expect(valueReport.affectedArtifacts[0].relationship).toContain("value type Email");

    // Test FactType relationship
    const factReport = analyzeImpact(manifest, factTypeId);
    expect(factReport.affectedArtifacts[0].relationship).toContain(
      "fact type Customer places Order",
    );

    // Test Constraint relationship
    const constraintReport = analyzeImpact(manifest, constraintId);
    expect(constraintReport.affectedArtifacts[0].relationship).toContain("constraint UC: Customer");

    // Test Role relationship
    const roleReport = analyzeImpact(manifest, roleId);
    expect(roleReport.affectedArtifacts[0].relationship).toContain("role places");
  });

  it("should handle multiple artifacts with different formats", () => {
    const elementId = "entity-customer-123";

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: "abc123",
      exports: [
        {
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId,
              elementType: "EntityType",
              elementName: "Customer",
            },
          ],
        },
        {
          artifact: "models/customer.sql",
          format: "dbt",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId,
              elementType: "EntityType",
              elementName: "Customer",
            },
          ],
        },
        {
          artifact: "openapi.yaml",
          format: "openapi",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: "abc123",
          sources: [
            {
              elementId,
              elementType: "EntityType",
              elementName: "Customer",
            },
          ],
        },
      ],
    };

    const report = analyzeImpact(manifest, elementId);

    expect(report.affectedArtifacts).toHaveLength(3);

    const formats = report.affectedArtifacts.map(a => a.format);
    expect(formats).toContain("ddl");
    expect(formats).toContain("dbt");
    expect(formats).toContain("openapi");
  });
});
