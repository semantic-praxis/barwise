/**
 * Tests for the validate_model tool.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeValidate } from "../../src/tools/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("validate_model tool", () => {
  it("returns valid for a correct model file", () => {
    const result = executeValidate(`${fixtures}/simple.orm.yaml`);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.valid).toBe(true);
    expect(parsed.errorCount).toBe(0);
  });

  it("validates inline YAML content", () => {
    const yaml = readFileSync(`${fixtures}/simple.orm.yaml`, "utf-8");
    const result = executeValidate(yaml);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.valid).toBe(true);
  });

  it("returns errors for an invalid model", () => {
    // The invalid fixture has a dangling player reference, which
    // triggers a deserialization error. executeValidate should throw.
    expect(() => executeValidate(`${fixtures}/invalid.orm.yaml`)).toThrow();
  });

  it("returns diagnostics with ruleId and message", () => {
    const result = executeValidate(`${fixtures}/simple.orm.yaml`);
    const parsed = JSON.parse(result.content[0]!.text);
    // Even valid models may have warnings.
    for (const w of parsed.warnings) {
      expect(w).toHaveProperty("ruleId");
      expect(w).toHaveProperty("message");
      expect(w).toHaveProperty("severity");
    }
  });

  it("returns content in MCP format", () => {
    const result = executeValidate(`${fixtures}/simple.orm.yaml`);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(typeof result.content[0]!.text).toBe("string");
  });

  describe("project source", () => {
    const project = `${fixtures}/project/project.orm-project.yaml`;

    it("validates every domain when no domain is given", () => {
      const result = executeValidate(project);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.domains).toHaveLength(2);
      expect(parsed.domains.map((d: { domain: string; }) => d.domain)).toEqual([
        "crm",
        "billing",
      ]);
      expect(parsed.valid).toBe(true);
    });

    it("validates a single domain when domain is given", () => {
      const result = executeValidate(project, "crm");
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.domain).toBe("crm");
      expect(parsed.valid).toBe(true);
      expect(parsed.domains).toBeUndefined();
    });

    it("throws for an unknown domain, listing the available ones", () => {
      expect(() => executeValidate(project, "ghost")).toThrow(/crm, billing/);
    });
  });
});
