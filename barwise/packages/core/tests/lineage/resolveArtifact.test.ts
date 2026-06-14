/**
 * Tests for the pure artifact-to-manifest match. The directory walk that
 * locates the manifest and the model-file lookup live in the tool layer
 * (mcp), and are tested there.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveArtifactInManifest } from "../../src/lineage/resolveArtifact.js";
import type { LineageManifest } from "../../src/lineage/types.js";

const manifestDir = "/project";
const artifactPath = "/project/output/schema.sql";

function manifestWith(artifact: string): LineageManifest {
  return {
    version: 1,
    sourceModel: "model.orm.yaml",
    sourceModelHash: "abc123",
    exports: [
      {
        artifact,
        format: "ddl",
        exportedAt: "2026-01-01T00:00:00.000Z",
        modelHash: "abc123",
        sources: [
          { elementId: "e1", elementType: "EntityType", elementName: "Customer" },
        ],
      },
    ],
  };
}

describe("resolveArtifactInManifest", () => {
  it("matches an artifact path against a manifest export", () => {
    const result = resolveArtifactInManifest(
      manifestWith(resolve(artifactPath)),
      artifactPath,
      manifestDir,
    );

    expect(result).toBeDefined();
    expect(result!.manifestDir).toBe(manifestDir);
    expect(result!.sourceModel).toBe("model.orm.yaml");
    expect(result!.exportEntry.format).toBe("ddl");
    expect(result!.sources).toHaveLength(1);
    expect(result!.sources[0]!.elementName).toBe("Customer");
  });

  it("normalizes paths before comparing", () => {
    const result = resolveArtifactInManifest(
      manifestWith("/project/output/schema.sql"),
      "/project/output/../output/schema.sql",
      manifestDir,
    );

    expect(result).toBeDefined();
  });

  it("returns undefined when no export matches the artifact", () => {
    const result = resolveArtifactInManifest(
      manifestWith("/some/other/path.sql"),
      artifactPath,
      manifestDir,
    );

    expect(result).toBeUndefined();
  });
});
