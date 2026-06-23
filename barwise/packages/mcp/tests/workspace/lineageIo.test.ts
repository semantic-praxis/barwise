/**
 * Tests for the MCP lineage manifest filesystem I/O: the manifest read,
 * the parent-directory walk for artifact resolution, and locating the
 * source model file.
 */
import type { LineageManifest } from "@barwise/core/lineage";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findOrmModel, readManifest, resolveArtifact } from "../../src/workspace/lineageIo.js";
import { writeManifest } from "./manifestFixture.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "barwise-mcp-lineage-"));
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("readManifest", () => {
  it("round-trips, and returns undefined when absent", () => {
    expect(readManifest(tempDir)).toBeUndefined();

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "model.orm.yaml",
      sourceModelHash: "abc123",
      exports: [],
    };
    writeManifest(tempDir, manifest);
    expect(readManifest(tempDir)).toEqual(manifest);
  });
});

describe("resolveArtifact", () => {
  it("resolves an artifact by walking up to the manifest", () => {
    mkdirSync(join(tempDir, "output"), { recursive: true });
    const artifactPath = join(tempDir, "output", "schema.sql");
    writeFileSync(artifactPath, "CREATE TABLE test;", "utf-8");
    writeManifest(tempDir, {
      version: 1,
      sourceModel: "model.orm.yaml",
      sourceModelHash: "abc123",
      exports: [
        {
          artifact: resolve(artifactPath),
          format: "ddl",
          exportedAt: "2026-01-01T00:00:00.000Z",
          modelHash: "abc123",
          sources: [
            { elementId: "e1", elementType: "EntityType", elementName: "Customer" },
          ],
        },
      ],
    });

    const result = resolveArtifact(artifactPath);
    expect(result).toBeDefined();
    expect(result!.manifestDir).toBe(tempDir);
    expect(result!.sourceModel).toBe("model.orm.yaml");
    expect(result!.sources[0]!.elementName).toBe("Customer");
  });

  it("returns undefined when no manifest is found", () => {
    expect(resolveArtifact(join(tempDir, "output", "schema.sql"))).toBeUndefined();
  });

  it("returns undefined when the artifact is not in the manifest", () => {
    writeManifest(tempDir, {
      version: 1,
      sourceModel: "model.orm.yaml",
      sourceModelHash: "abc123",
      exports: [
        {
          artifact: "/some/other/path.sql",
          format: "ddl",
          exportedAt: "2026-01-01T00:00:00.000Z",
          modelHash: "abc123",
          sources: [],
        },
      ],
    });
    expect(resolveArtifact(join(tempDir, "schema.sql"))).toBeUndefined();
  });
});

describe("findOrmModel", () => {
  it("finds the model by the manifest source path", () => {
    writeFileSync(join(tempDir, "model.orm.yaml"), "name: Test", "utf-8");
    expect(findOrmModel(tempDir, "model.orm.yaml")).toBe(join(tempDir, "model.orm.yaml"));
  });

  it("falls back to scanning for a .orm.yaml file", () => {
    writeFileSync(join(tempDir, "example.orm.yaml"), "name: Test", "utf-8");
    expect(findOrmModel(tempDir)).toBe(join(tempDir, "example.orm.yaml"));
  });

  it("returns undefined when no model is found", () => {
    writeFileSync(join(tempDir, "readme.txt"), "Not a model", "utf-8");
    expect(findOrmModel(tempDir)).toBeUndefined();
  });
});
