/**
 * Tests for the CLI lineage manifest filesystem I/O.
 */
import type { LineageManifest } from "@barwise/core/lineage";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readManifest, writeManifest } from "../../src/workspace/lineageIo.js";

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
        { elementId: "e1", elementType: "EntityType", elementName: "Customer" },
      ],
    },
  ],
};

describe("cli lineage manifest I/O", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "barwise-cli-lineage-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("writes the manifest to .barwise/lineage.yaml", () => {
    writeManifest(tempDir, manifest);
    expect(existsSync(join(tempDir, ".barwise", "lineage.yaml"))).toBe(true);
  });

  it("reads back what was written (round-trip)", () => {
    writeManifest(tempDir, manifest);
    expect(readManifest(tempDir)).toEqual(manifest);
  });

  it("returns undefined when no manifest exists", () => {
    expect(readManifest(tempDir)).toBeUndefined();
  });
});
