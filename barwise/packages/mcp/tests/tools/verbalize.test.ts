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

  it("appends counterexamples when requested", () => {
    const result = executeVerbalize(
      `${fixtures}/simple.orm.yaml`,
      undefined,
      "full",
      true,
    );
    const text = result.content[0]!.text;
    expect(text).toContain("Counterexamples (what the constraints rule out):");
    expect(text).toContain("Rules out:");
  });

  it("omits counterexamples by default", () => {
    const result = executeVerbalize(`${fixtures}/simple.orm.yaml`);
    expect(result.content[0]!.text).not.toContain("Counterexamples (");
  });

  it("spills full output to a file when large", () => {
    process.env.BARWISE_MCP_INLINE_LIMIT = "50";
    const result = executeVerbalize(`${fixtures}/simple.orm.yaml`);
    const text = result.content[0]!.text;
    expect(text).toContain("Full content written to:");

    const spill = text.match(/Full content written to: (.+)/)![1]!.trim();
    expect(existsSync(spill)).toBe(true);
  });

  it("spills a { path } object beside the file, like the string form", () => {
    process.env.BARWISE_MCP_INLINE_LIMIT = "50";
    const dirOf = (r: { content: Array<{ text: string; }>; }) =>
      dirname(r.content[0]!.text.match(/Full content written to: (.+)/)![1]!.trim());

    const asString = dirOf(executeVerbalize(`${fixtures}/simple.orm.yaml`));
    const asObject = dirOf(executeVerbalize({ path: `${fixtures}/simple.orm.yaml` }));

    // The object form spills into the same cache dir next to the model file.
    expect(asObject).toBe(asString);
    expect(asObject).toContain(resolve(fixtures, ".barwise"));
  });

  it("omits an empty counterexamples section for a fact type with no constraints", () => {
    const yaml = `
orm_version: "1.0"
model:
  name: Unconstrained Model
  object_types:
    - id: ot-a
      name: A
      kind: entity
      reference_mode: a_id
    - id: ot-b
      name: B
      kind: entity
      reference_mode: b_id
  fact_types:
    - id: ft-a-b
      name: A relates B
      roles:
        - id: r-a
          player: ot-a
          role_name: relates
        - id: r-b
          player: ot-b
          role_name: is related to
      readings:
        - "{0} relates {1}"
`;
    const result = executeVerbalize(yaml, "A relates B", "full", true);
    expect(result.content[0]!.text).not.toContain("Counterexamples (");
  });

  it("elides readings past the summary preview and says how many more", () => {
    const facts = Array.from({ length: 25 }, (_, i) =>
      [
        `    - id: "ft-${i}"`,
        `      name: "A relates${i} B"`,
        "      roles:",
        `        - id: "r-a-${i}"`,
        "          player: ot-a",
        `          role_name: "relates${i}"`,
        `        - id: "r-b-${i}"`,
        "          player: ot-b",
        `          role_name: "is related${i} to"`,
        "      readings:",
        `        - "{0} relates${i} {1}"`,
        "      constraints:",
        "        - type: internal_uniqueness",
        `          roles: ["r-a-${i}"]`,
        "        - type: mandatory",
        `          role: "r-a-${i}"`,
      ].join("\n")).join("\n");
    const yaml = `orm_version: "1.0"\nmodel:\n  name: Big Verbalize Model\n`
      + "  object_types:\n"
      + "    - id: ot-a\n      name: A\n      kind: entity\n      reference_mode: a_id\n"
      + "    - id: ot-b\n      name: B\n      kind: entity\n      reference_mode: b_id\n"
      + `  fact_types:\n${facts}\n`;

    const result = executeVerbalize(yaml, undefined, "summary");
    const text = result.content[0]!.text;
    expect(text).toContain("more -- call again with mode='full'");
  });

  describe("project source", () => {
    const project = `${fixtures}/project/project.orm-project.yaml`;

    afterEach(() => {
      rmSync(resolve(fixtures, "project", ".barwise"), { recursive: true, force: true });
    });

    it("verbalizes every domain under a header when no domain is given", () => {
      const result = executeVerbalize(project);
      const text = result.content[0]!.text;
      expect(text).toContain("== crm ==");
      expect(text).toContain("== billing ==");
      expect(text).toContain("Customer");
      expect(text).toContain("Account");
    });

    it("verbalizes only the chosen domain", () => {
      const result = executeVerbalize(project, undefined, "full", false, "crm");
      const text = result.content[0]!.text;
      expect(text).toContain("Customer");
      expect(text).not.toContain("Account");
      expect(text).not.toContain("== crm ==");
    });

    it("filters by a fact type that exists in only one domain", () => {
      // crm has "Customer has Email"; billing does not -- the multi-model
      // path formats a not-found message for the domain lacking it.
      const result = executeVerbalize(project, "Customer has Email");
      const text = result.content[0]!.text;
      expect(text).toContain("has Email");
      expect(text).toContain('No fact type found matching "Customer has Email"');
    });

    it("summarizes each domain when mode is summary", () => {
      const result = executeVerbalize(project, undefined, "summary");
      const text = result.content[0]!.text;
      expect(text).toContain("Verbalization summary");
    });

    it("carries assembly warnings alongside the resolved domain's output", () => {
      const broken = `${fixtures}/project/broken.orm-project.yaml`;
      const result = executeVerbalize(broken);
      const text = result.content[0]!.text;
      expect(text).toContain("Warning:");
      expect(text).toContain("ghost");
    });
  });
});
