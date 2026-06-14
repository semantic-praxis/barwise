import { describe, expect, it } from "vitest";
import { hashModel } from "../../src/lineage/manifest.js";
import { checkStaleness } from "../../src/lineage/staleness.js";
import type { LineageManifest } from "../../src/lineage/types.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("Staleness Detection", () => {
  it("should report no stale artifacts when model has not changed", () => {
    const model = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const modelHash = hashModel(model);

    // Write a manifest with this model hash
    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: modelHash,
      exports: [
        {
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash,
          sources: [],
        },
        {
          artifact: "models/customer.sql",
          format: "dbt",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash,
          sources: [],
        },
      ],
    };

    const report = checkStaleness(manifest, model);

    expect(report.manifestFound).toBe(true);
    expect(report.staleArtifacts).toHaveLength(0);
    expect(report.freshArtifacts).toHaveLength(2);
    expect(report.freshArtifacts).toContain("schema.sql");
    expect(report.freshArtifacts).toContain("models/customer.sql");
  });

  it("should report all artifacts as stale when model has changed", () => {
    const originalModel = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const originalHash = hashModel(originalModel);

    // Write a manifest with the original hash
    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: originalHash,
      exports: [
        {
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: originalHash,
          sources: [],
        },
        {
          artifact: "models/customer.sql",
          format: "dbt",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: originalHash,
          sources: [],
        },
      ],
    };

    // Create a modified model
    const modifiedModel = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_id" })
      .build();

    const report = checkStaleness(manifest, modifiedModel);

    expect(report.manifestFound).toBe(true);
    expect(report.staleArtifacts).toHaveLength(2);
    expect(report.freshArtifacts).toHaveLength(0);

    // Check that stale artifacts have proper information
    const schemaSql = report.staleArtifacts.find(a => a.artifact === "schema.sql");
    expect(schemaSql).toBeDefined();
    expect(schemaSql!.format).toBe("ddl");
    expect(schemaSql!.exportedAt).toBe("2026-03-06T12:00:00Z");
    expect(schemaSql!.reason).toContain("model hash changed");

    const customerSql = report.staleArtifacts.find(a => a.artifact === "models/customer.sql");
    expect(customerSql).toBeDefined();
    expect(customerSql!.format).toBe("dbt");
  });

  it("should report manifestFound=false when no manifest exists", () => {
    const model = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const report = checkStaleness(undefined, model);

    expect(report.manifestFound).toBe(false);
    expect(report.staleArtifacts).toHaveLength(0);
    expect(report.freshArtifacts).toHaveLength(0);
  });

  it("should correctly identify mixed stale and fresh artifacts", () => {
    const originalModel = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const originalHash = hashModel(originalModel);

    // Create a modified model
    const modifiedModel = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_id" })
      .build();

    const newHash = hashModel(modifiedModel);

    // Write a manifest with one artifact using old hash, one using new hash
    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: newHash,
      exports: [
        {
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: originalHash, // old hash - stale
          sources: [],
        },
        {
          artifact: "models/customer.sql",
          format: "dbt",
          exportedAt: "2026-03-06T13:00:00Z",
          modelHash: newHash, // new hash - fresh
          sources: [],
        },
      ],
    };

    const report = checkStaleness(manifest, modifiedModel);

    expect(report.manifestFound).toBe(true);
    expect(report.staleArtifacts).toHaveLength(1);
    expect(report.freshArtifacts).toHaveLength(1);

    expect(report.staleArtifacts[0].artifact).toBe("schema.sql");
    expect(report.freshArtifacts[0]).toBe("models/customer.sql");
  });

  it("should include truncated hash in staleness reason", () => {
    const originalModel = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const originalHash = hashModel(originalModel);

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: originalHash,
      exports: [
        {
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash: originalHash,
          sources: [],
        },
      ],
    };

    const modifiedModel = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_id" })
      .build();

    const newHash = hashModel(modifiedModel);

    const report = checkStaleness(manifest, modifiedModel);

    expect(report.staleArtifacts).toHaveLength(1);

    const reason = report.staleArtifacts[0].reason;
    expect(reason).toContain("model hash changed");
    expect(reason).toContain(originalHash.substring(0, 8));
    expect(reason).toContain(newHash.substring(0, 8));
  });

  it("should handle empty exports array", () => {
    const model = new ModelBuilder("Test Model")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const modelHash = hashModel(model);

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: modelHash,
      exports: [],
    };

    const report = checkStaleness(manifest, model);

    expect(report.manifestFound).toBe(true);
    expect(report.staleArtifacts).toHaveLength(0);
    expect(report.freshArtifacts).toHaveLength(0);
  });
});
