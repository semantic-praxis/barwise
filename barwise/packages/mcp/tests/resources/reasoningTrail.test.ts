/**
 * Tests for the reasoning-trail resource helper: serves a persisted
 * <model>.trail.json sidecar when present, else an anchors-only trail.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadReasoningTrail, trailSidecarPath } from "../../src/resources/reasoningTrail.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("trailSidecarPath", () => {
  it("derives the sidecar path from a model path", () => {
    expect(trailSidecarPath("/a/b/model.orm.yaml")).toBe("/a/b/model.trail.json");
    expect(trailSidecarPath("/a/b/model")).toBe("/a/b/model.trail.json");
  });
});

describe("loadReasoningTrail", () => {
  it("returns the persisted sidecar when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "trail-"));
    try {
      writeFileSync(
        join(dir, "m.trail.json"),
        JSON.stringify({ modelName: "Persisted", anchors: [] }),
        "utf-8",
      );
      const trail = JSON.parse(loadReasoningTrail(join(dir, "m.orm.yaml")));
      expect(trail.modelName).toBe("Persisted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("computes an anchors-only trail when no sidecar exists", () => {
    const trail = JSON.parse(loadReasoningTrail(`${fixtures}/simple.orm.yaml`));
    expect(Array.isArray(trail.anchors)).toBe(true);
    expect(trail.ambiguities).toEqual([]);
    expect(trail.discardedFramings).toEqual([]);
    expect(trail.assumptions).toEqual([]);
  });
});
