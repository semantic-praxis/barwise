import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hashModel,
  manifestPath,
  parseManifest,
  serializeManifest,
  updateManifest,
} from "../../src/lineage/manifest.js";
import type { LineageManifest, ManifestExport } from "../../src/lineage/types.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sampleManifest: LineageManifest = {
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
        { elementId: "entity-1", elementType: "EntityType", elementName: "Customer" },
      ],
    },
  ],
};

describe("Lineage Manifest", () => {
  describe("manifestPath", () => {
    it("builds the .barwise/lineage.yaml path under a directory", () => {
      expect(manifestPath("/project")).toBe(join("/project", ".barwise", "lineage.yaml"));
    });
  });

  describe("serializeManifest / parseManifest", () => {
    it("round-trips a manifest through YAML", () => {
      expect(parseManifest(serializeManifest(sampleManifest))).toEqual(sampleManifest);
    });

    it("serializes the expected fields", () => {
      const yaml = serializeManifest(sampleManifest);
      expect(yaml).toContain("version: 1");
      expect(yaml).toContain("sourceModel: test.orm.yaml");
      expect(yaml).toContain("sourceModelHash: abc123");
      expect(yaml).toContain("artifact: schema.sql");
    });
  });

  describe("updateManifest", () => {
    it("creates a new manifest when none exists", () => {
      const entry: ManifestExport = {
        artifact: "schema.sql",
        format: "ddl",
        exportedAt: "2026-03-06T12:00:00Z",
        modelHash: "abc123",
        sources: [
          { elementId: "entity-1", elementType: "EntityType", elementName: "Customer" },
        ],
      };

      const manifest = updateManifest(entry);

      expect(manifest.version).toBe(1);
      expect(manifest.exports).toHaveLength(1);
      expect(manifest.exports[0]).toEqual(entry);
      expect(manifest.sourceModelHash).toBe("abc123");
    });

    it("appends a new entry to an existing manifest", () => {
      const initial: LineageManifest = {
        version: 1,
        sourceModel: "test.orm.yaml",
        sourceModelHash: "abc123",
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: "abc123",
            sources: [],
          },
        ],
      };

      const newEntry: ManifestExport = {
        artifact: "models/customer.sql",
        format: "dbt",
        exportedAt: "2026-03-06T13:00:00Z",
        modelHash: "def456",
        sources: [],
      };

      const updated = updateManifest(newEntry, initial);

      expect(updated.exports).toHaveLength(2);
      expect(updated.exports[0].artifact).toBe("schema.sql");
      expect(updated.exports[1].artifact).toBe("models/customer.sql");
      expect(updated.sourceModelHash).toBe("def456");
    });

    it("replaces an existing entry when the artifact path matches", () => {
      const initial: LineageManifest = {
        version: 1,
        sourceModel: "test.orm.yaml",
        sourceModelHash: "abc123",
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: "abc123",
            sources: [],
          },
        ],
      };

      const updatedEntry: ManifestExport = {
        artifact: "schema.sql",
        format: "ddl",
        exportedAt: "2026-03-06T14:00:00Z",
        modelHash: "xyz789",
        sources: [
          { elementId: "entity-2", elementType: "EntityType", elementName: "Order" },
        ],
      };

      const updated = updateManifest(updatedEntry, initial);

      expect(updated.exports).toHaveLength(1);
      expect(updated.exports[0].exportedAt).toBe("2026-03-06T14:00:00Z");
      expect(updated.exports[0].modelHash).toBe("xyz789");
      expect(updated.exports[0].sources).toHaveLength(1);
    });
  });

  describe("hashModel", () => {
    // A hand-authored model: 76 explicit element ids, no constraint ids.
    const EXAMPLE = resolve(__dirname, "../../../../examples/models/learning-design.orm.yaml");

    it("hashes two independent loads of the same file identically (barwise-923)", () => {
      // Every id-less constraint is minted a fresh UUID on load, so two
      // loads serialize differently on every constraint `id:` line and
      // hashed differently -- which made `barwise lineage status` report
      // every export stale on every run for any model like this one.
      const text = readFileSync(EXAMPLE, "utf8");
      const serializer = new OrmYamlSerializer();
      const first = serializer.deserialize(text);
      const second = serializer.deserialize(text);
      expect(hashModel(first)).toBe(hashModel(second));
    });

    it("still changes when the content changes, ids aside", () => {
      const text = readFileSync(EXAMPLE, "utf8");
      const serializer = new OrmYamlSerializer();
      const original = serializer.deserialize(text);
      const renamed = serializer.deserialize(
        text.replace("name: LearningModule", "name: CourseModule"),
      );
      expect(text).toContain("name: LearningModule");
      expect(hashModel(original)).not.toBe(hashModel(renamed));
    });

    it("should produce a deterministic hash for the same model", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "id" })
        .build();

      const hash1 = hashModel(model);
      const hash2 = hashModel(model);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex digest is 64 characters
    });

    it("should produce different hashes for different models", () => {
      const model1 = new ModelBuilder("Test Model 1")
        .withEntityType("Customer", { referenceMode: "id" })
        .build();

      const model2 = new ModelBuilder("Test Model 2")
        .withEntityType("Order", { referenceMode: "id" })
        .build();

      expect(hashModel(model1)).not.toBe(hashModel(model2));
    });

    it("should produce different hashes when model is modified", () => {
      const model1 = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "id" })
        .build();

      const model2 = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "id" })
        .withEntityType("Order", { referenceMode: "id" })
        .build();

      expect(hashModel(model1)).not.toBe(hashModel(model2));
    });
  });
});
