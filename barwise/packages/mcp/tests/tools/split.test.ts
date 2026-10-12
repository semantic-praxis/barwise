/**
 * Tests for the split_model tool, over the worked example in
 * docs/ORM_PROJECT_GUIDE.md: docs/auction.orm.yaml cut by
 * examples/auction-split.yaml into four domains.
 */
import { parseSplitConfig } from "@barwise/core";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSplit } from "../../src/tools/split.js";
import { executeValidate } from "../../src/tools/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const config = parseSplitConfig(
  readFileSync(join(repoRoot, "examples/auction-split.yaml"), "utf-8"),
);
const domains = config.domains as Record<string, string[]>;

function body(result: { content: Array<{ text: string; }>; }) {
  return JSON.parse(result.content[0]!.text);
}

describe("split_model tool", () => {
  let tempDir: string;
  let source: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "barwise-mcp-split-test-"));
    source = join(tempDir, "auction.orm.yaml");
    copyFileSync(join(repoRoot, "docs/auction.orm.yaml"), source);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("previews without outDir and writes nothing", () => {
    const out = body(executeSplit(source, config.projectName, domains));

    expect(out.written).toBe(false);
    expect(out.manifest).toBe("project.orm-project.yaml");
    expect(out.domains.map((d: { context: string; }) => d.context))
      .toEqual(["catalog", "auctions", "payments", "parties"]);
    const parties = out.domains.find((d: { context: string; }) => d.context === "parties");
    expect(parties.file).toBe("domains/parties.orm.yaml");
    expect(parties.entityTypes).toContain("Customer");
    expect(out.mappings.length).toBeGreaterThan(0);
    // Nothing beside the source, not even a spill directory.
    expect(readdirSync(tempDir)).toEqual(["auction.orm.yaml"]);
  });

  it("reports object types a domain shares from another, with the owner", () => {
    const out = body(executeSplit(source, config.projectName, domains));
    const shared = out.domains.flatMap(
      (d: { context: string; sharedObjectTypes: Array<{ name: string; owner: string; }>; }) =>
        d.sharedObjectTypes.map((s) => ({ in: d.context, ...s })),
    );
    expect(shared.length).toBeGreaterThan(0);
    // A shared type is never owned by the domain that borrows it.
    for (const s of shared) expect(s.owner).not.toBe(s.in);
  });

  it("writes a project that validate_model accepts", () => {
    const outDir = join(tempDir, "project");
    const out = body(executeSplit(source, config.projectName, domains, outDir));

    expect(out.written).toBe(true);
    expect(out.manifestPath).toBe(join(outDir, "project.orm-project.yaml"));
    for (const d of out.domains) expect(existsSync(join(outDir, d.file))).toBe(true);
    for (const m of out.mappings) expect(existsSync(join(outDir, m))).toBe(true);

    const validation = body(executeValidate(out.manifestPath));
    expect(validation.domains).toHaveLength(4);
    expect(validation.valid).toBe(true);
  });

  it("refuses to overwrite any existing target, and changes nothing", () => {
    const outDir = join(tempDir, "project");
    // A hand-written domain file and no manifest: still the user's work.
    executeSplit(source, config.projectName, domains, outDir);
    const handWritten = join(outDir, "domains/parties.orm.yaml");
    writeFileSync(handWritten, "# hand-written\n", "utf-8");
    rmSync(join(outDir, "project.orm-project.yaml"));

    const out = body(executeSplit(source, config.projectName, domains, outDir));

    expect(out.error).toContain("already exist");
    expect(out.existing).toContain(handWritten);
    expect(readFileSync(handWritten, "utf-8")).toBe("# hand-written\n");
    expect(existsSync(join(outDir, "project.orm-project.yaml"))).toBe(false);
  });

  it("overwrites existing targets when force is true", () => {
    const outDir = join(tempDir, "project");
    executeSplit(source, config.projectName, domains, outDir);
    const handWritten = join(outDir, "domains/parties.orm.yaml");
    writeFileSync(handWritten, "# hand-written\n", "utf-8");

    const out = body(executeSplit(source, config.projectName, domains, outDir, true));

    expect(out.written).toBe(true);
    expect(readFileSync(handWritten, "utf-8")).toContain("domain_context: parties");
  });

  it("returns splitModel's refusal as an error rather than throwing", () => {
    const out = body(executeSplit(source, "P", { only: ["Customer"] }));
    expect(out.error).toContain("at least two domains");
  });

  it("returns a missing source file as an error", () => {
    const out = body(executeSplit(join(tempDir, "absent.orm.yaml"), "P", domains));
    expect(out.error).toMatch(/ENOENT|no such file/);
  });
});
