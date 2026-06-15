/**
 * Tests for the canonical guidance constants, including the sensemaking
 * block surfaced through the MCP prompts and re-exported for other
 * channels (the VS Code chat participant, the barwise-modeling skill).
 */
import { describe, expect, it } from "vitest";
import { SENSEMAKING_GUIDANCE } from "../../src/prompts/guidance/guidance.js";
import { SENSEMAKING_GUIDANCE as ReExported } from "../../src/server.js";

describe("SENSEMAKING_GUIDANCE", () => {
  it("covers the four data-frame moves", () => {
    for (const beat of ["Anchors", "Expectancies", "Rival framings", "Premortem"]) {
      expect(SENSEMAKING_GUIDANCE).toContain(beat);
    }
  });

  it("is re-exported from the package entry point as a single source of truth", () => {
    expect(ReExported).toBe(SENSEMAKING_GUIDANCE);
  });
});
