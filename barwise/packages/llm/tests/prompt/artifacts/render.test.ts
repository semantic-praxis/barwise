/**
 * Tests for inline demo rendering. Demos append a Worked Examples
 * section; no demos must render to the empty string so the default
 * prompt stays byte-stable.
 */
import { describe, expect, it } from "vitest";
import { renderDemos } from "../../../src/prompt/artifacts/render.js";

describe("renderDemos", () => {
  it("renders the empty string for no demos", () => {
    expect(renderDemos([])).toBe("");
  });

  it("renders numbered examples with transcript and extraction blocks", () => {
    const out = renderDemos([
      { transcriptExcerpt: "First excerpt", extraction: `{"a": 1}` },
      { transcriptExcerpt: "Second excerpt", extraction: `{"b": 2}` },
    ]);
    expect(out.startsWith("\n\n## Worked Examples")).toBe(true);
    expect(out).toContain("### Example 1");
    expect(out).toContain("### Example 2");
    expect(out).toContain("<transcript>\nFirst excerpt\n</transcript>");
    expect(out).toContain('```json\n{"b": 2}\n```');
    expect(out.indexOf("First excerpt")).toBeLessThan(out.indexOf("Second excerpt"));
  });
});
