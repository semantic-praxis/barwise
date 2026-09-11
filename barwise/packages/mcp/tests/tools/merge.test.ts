/**
 * Tests for the merge_models tool.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeMerge } from "../../src/tools/merge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("merge_models tool", () => {
  // The merge tool writes the merged YAML back to the base file when the
  // base is a file path. Tests must use a temp copy as the base so repeated
  // runs don't mutate the committed fixture.
  let tempDir: string;
  let baseCopy: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "barwise-mcp-merge-test-"));
    baseCopy = join(tempDir, "simple.orm.yaml");
    copyFileSync(`${fixtures}/simple.orm.yaml`, baseCopy);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns unchanged for identical models", () => {
    const result = executeMerge(baseCopy, baseCopy);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.hasChanges).toBe(false);
    expect(parsed.valid).toBe(true);
  });

  it("merges additions from incoming model", () => {
    const result = executeMerge(
      baseCopy,
      `${fixtures}/simple-modified.orm.yaml`,
    );
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.hasChanges).toBe(true);
    expect(parsed.yaml).toBeDefined();
    // The modified fixture adds Email, so it should appear in merged output.
    expect(parsed.yaml).toContain("Email");
  });

  it("reports a fragment whose population names a fact type nothing defines", () => {
    // barwise-997, the MCP half. This tool WRITES the merged model back
    // to the base file, so a silent drop here does not just report
    // success -- it persists the loss. The population is carried into
    // the merged model now, the rule that already existed reports it,
    // and the tool's valid/errorCount say so.
    const result = executeMerge(
      baseCopy,
      `${fixtures}/fragment-typo-population.orm.yaml`,
    );
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.valid).toBe(false);
    expect(parsed.errorCount).toBeGreaterThan(0);
    expect(JSON.stringify(parsed.diagnostics)).toContain("population/dangling-fact-type");

    // And the base file is not overwritten with the broken result.
    expect(readFileSync(baseCopy, "utf8")).toBe(
      readFileSync(`${fixtures}/simple.orm.yaml`, "utf8"),
    );
  });

  it("includes structural diagnostics array", () => {
    const result = executeMerge(
      baseCopy,
      `${fixtures}/simple-modified.orm.yaml`,
    );
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("diagnostics");
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    expect(parsed).toHaveProperty("errorCount");
  });

  it("returns content in MCP format", () => {
    const result = executeMerge(baseCopy, baseCopy);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
  });
});
