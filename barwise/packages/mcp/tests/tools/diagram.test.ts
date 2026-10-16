/**
 * Tests for the generate_diagram tool.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { executeDiagram } from "../../src/tools/diagram.js";
import { usePrivateCwd } from "../workspace/privateCwd.js";

// Diagrams of a file-based model spill into a cache dir next to it, so each
// test works on its own copy of the fixture.
const ws = usePrivateCwd();

afterEach(() => {
  delete process.env.BARWISE_MCP_INLINE_LIMIT;
});

describe("generate_diagram tool", () => {
  it("returns SVG content for a small model inline", async () => {
    const result = await executeDiagram(ws.fixture("simple.orm.yaml"));
    expect(result.content[0]!.text).toContain("<svg");
  });

  it("includes model elements in SVG", async () => {
    const result = await executeDiagram(ws.fixture("simple.orm.yaml"));
    expect(result.content[0]!.text).toContain("Customer");
  });

  it("returns content in MCP format", async () => {
    const result = await executeDiagram(ws.fixture("simple.orm.yaml"));
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
  });

  it("spills a large diagram to a file", async () => {
    process.env.BARWISE_MCP_INLINE_LIMIT = "200";
    const result = await executeDiagram(ws.fixture("simple.orm.yaml"));

    const text = result.content[0]!.text;
    expect(text).toContain("Full content written to:");

    const spill = text.match(/Full content written to: (.+)/)![1]!.trim();
    expect(existsSync(spill)).toBe(true);
    expect(readFileSync(spill, "utf8")).toContain("<svg");
  });
});
