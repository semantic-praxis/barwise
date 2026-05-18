/**
 * Tests for the verbalize_model tool.
 */
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { executeVerbalize } from "../../src/tools/verbalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

afterEach(() => {
  rmSync(resolve(fixtures, ".barwise"), { recursive: true, force: true });
  delete process.env.BARWISE_MCP_INLINE_LIMIT;
});

describe("verbalize_model tool", () => {
  it("returns verbalizations for a model file", () => {
    const result = executeVerbalize(`${fixtures}/simple.orm.yaml`);
    expect(result.content[0]!.text).toContain("Customer");
    expect(result.content[0]!.text).toContain("Name");
  });

  it("filters by fact type name", () => {
    const result = executeVerbalize(
      `${fixtures}/simple.orm.yaml`,
      "Customer has Name",
    );
    expect(result.content[0]!.text).toContain("Customer");
  });

  it("returns message for nonexistent fact type", () => {
    const result = executeVerbalize(
      `${fixtures}/simple.orm.yaml`,
      "Nonexistent Fact Type",
    );
    expect(result.content[0]!.text).toContain("No fact type found");
  });

  it("returns content in MCP format", () => {
    const result = executeVerbalize(`${fixtures}/simple.orm.yaml`);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
  });

  it("returns category counts in summary mode", () => {
    const result = executeVerbalize(
      `${fixtures}/simple.orm.yaml`,
      undefined,
      "summary",
    );
    const text = result.content[0]!.text;
    expect(text).toContain("Verbalization summary");
    expect(text).toContain("reading(s)");
    // Summary mode never spills.
    expect(text).not.toContain("Full content written to:");
  });

  it("spills full output to a file when large", () => {
    process.env.BARWISE_MCP_INLINE_LIMIT = "50";
    const result = executeVerbalize(`${fixtures}/simple.orm.yaml`);
    const text = result.content[0]!.text;
    expect(text).toContain("Full content written to:");

    const spill = text.match(/Full content written to: (.+)/)![1]!.trim();
    expect(existsSync(spill)).toBe(true);
  });
});
