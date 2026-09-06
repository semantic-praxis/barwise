/**
 * Tests for splitConfig: parsing and scaffolding the YAML config that
 * drives splitModel.
 */
import { describe, expect, it } from "vitest";
import { parseSplitConfig, scaffoldSplitConfig } from "../../src/project/splitConfig.js";
import { ModelSplitError } from "../../src/project/splitModel.js";

describe("parseSplitConfig", () => {
  it("parses a well-formed config", () => {
    const config = parseSplitConfig(`
projectName: Shop
domains:
  crm: [Customer, Email]
  billing: [Invoice]
`);
    expect(config).toEqual({
      projectName: "Shop",
      domains: { crm: ["Customer", "Email"], billing: ["Invoice"] },
    });
  });

  it("rejects unparseable YAML", () => {
    expect(() => parseSplitConfig("projectName: [unterminated")).toThrow(
      ModelSplitError,
    );
  });

  it("rejects a document that is not a mapping", () => {
    expect(() => parseSplitConfig("just a scalar string")).toThrow(
      ModelSplitError,
    );
  });

  it("rejects an empty document", () => {
    expect(() => parseSplitConfig("")).toThrow(ModelSplitError);
  });

  it("rejects a mapping missing projectName", () => {
    expect(() => parseSplitConfig("domains:\n  a: []\n  b: []\n")).toThrow(
      'Split config must have a non-empty string "projectName".',
    );
  });

  it("rejects a non-string projectName", () => {
    expect(() => parseSplitConfig("projectName: 42\ndomains:\n  a: []\n  b: []\n")).toThrow(
      ModelSplitError,
    );
  });

  it("rejects a blank projectName", () => {
    expect(() => parseSplitConfig('projectName: "   "\ndomains:\n  a: []\n  b: []\n')).toThrow(
      ModelSplitError,
    );
  });

  it("rejects a mapping missing domains", () => {
    expect(() => parseSplitConfig("projectName: Shop\n")).toThrow(
      'Split config must have a "domains" mapping of context to object types.',
    );
  });

  it("rejects a domains value that is not a mapping", () => {
    expect(() => parseSplitConfig("projectName: Shop\ndomains: not-a-map\n")).toThrow(
      ModelSplitError,
    );
  });

  it("treats a null domain entry as an empty list", () => {
    const config = parseSplitConfig(`
projectName: Shop
domains:
  crm:
  billing: [Invoice]
`);
    expect(config.domains["crm"]).toEqual([]);
  });

  it("rejects a domain entry that is not a list", () => {
    expect(() => parseSplitConfig("projectName: Shop\ndomains:\n  crm: Customer\n")).toThrow(
      'Domain "crm" must be a list of object type names.',
    );
  });

  it("rejects a domain list containing a non-string entry", () => {
    expect(() => parseSplitConfig("projectName: Shop\ndomains:\n  crm: [Customer, 7]\n")).toThrow(
      'Domain "crm" must be a list of object type names.',
    );
  });
});

describe("scaffoldSplitConfig", () => {
  const MODEL_YAML = `
orm_version: "1.0"
model:
  name: Shop
  object_types:
    - { id: ot-1, name: Customer, kind: entity }
    - { id: ot-2, name: Invoice, kind: entity }
    - { id: ot-3, name: Email, kind: value }
`;

  it("rejects fewer than two contexts", () => {
    expect(() => scaffoldSplitConfig(MODEL_YAML, ["crm"])).toThrow(
      "A split needs at least two domains; pass --domains a,b,...",
    );
  });

  it("rejects unparseable source model YAML", () => {
    expect(() => scaffoldSplitConfig("not: [valid", ["crm", "billing"])).toThrow(ModelSplitError);
  });

  it("lists entity object types under the first context and leaves the rest empty", () => {
    const yaml = scaffoldSplitConfig(MODEL_YAML, ["crm", "billing"]);
    expect(yaml).toContain('projectName: "Shop project"');
    expect(yaml).toContain("  crm:\n    - Customer\n    - Invoice");
    expect(yaml).toContain("  billing: []");
    // Value types are omitted from the scaffold.
    expect(yaml).not.toContain("Email");
  });

  it("falls back to a generic project name when the model has none", () => {
    const yaml = scaffoldSplitConfig(
      "model:\n  object_types: []\n",
      ["a", "b"],
    );
    expect(yaml).toContain('projectName: "project project"');
  });

  it("emits an empty first domain when the model has no entity object types", () => {
    const yaml = scaffoldSplitConfig(
      "model:\n  name: Empty\n  object_types:\n    - { name: OnlyValue, kind: value }\n",
      ["a", "b"],
    );
    expect(yaml).toContain("  a: []");
    expect(yaml).toContain("  b: []");
  });

  it("handles a model with no object_types field at all", () => {
    const yaml = scaffoldSplitConfig("model:\n  name: Bare\n", ["a", "b"]);
    expect(yaml).toContain("  a: []");
  });
});
