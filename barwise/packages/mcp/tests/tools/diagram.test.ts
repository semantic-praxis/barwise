/**
 * Tests for the generate_diagram tool.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { executeDiagram } from "../../src/tools/diagram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

afterEach(() => {
  // Diagrams of a file-based model spill into a cache dir next to it.
  rmSync(resolve(fixtures, ".barwise"), { recursive: true, force: true });
  delete process.env.BARWISE_MCP_INLINE_LIMIT;
});

describe("generate_diagram tool", () => {
  it("returns SVG content for a small model inline", async () => {
    const result = await executeDiagram(`${fixtures}/simple.orm.yaml`);
    expect(result.content[0]!.text).toContain("<svg");
  });

  it("includes model elements in SVG", async () => {
    const result = await executeDiagram(`${fixtures}/simple.orm.yaml`);
    expect(result.content[0]!.text).toContain("Customer");
  });

  it("returns content in MCP format", async () => {
    const result = await executeDiagram(`${fixtures}/simple.orm.yaml`);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
  });

  it("spills a large diagram to a file", async () => {
    process.env.BARWISE_MCP_INLINE_LIMIT = "200";
    const result = await executeDiagram(`${fixtures}/simple.orm.yaml`);

    const text = result.content[0]!.text;
    expect(text).toContain("Full content written to:");

    const spill = text.match(/Full content written to: (.+)/)![1]!.trim();
    expect(existsSync(spill)).toBe(true);
    expect(readFileSync(spill, "utf8")).toContain("<svg");
  });
});
