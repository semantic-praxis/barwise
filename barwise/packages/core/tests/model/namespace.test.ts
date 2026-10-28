/**
 * `namespaceOf` (iri-identity WS4): where a model's element IRIs start.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IRI_BASE_PATTERN, NAMESPACE_PATTERN, namespaceOf } from "../../src/model/namespace.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmProject } from "../../src/model/OrmProject.js";

const schema = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../schemas/${file}`, import.meta.url), "utf8"));

describe("namespaceOf", () => {
  const own = new OrmModel({ name: "Ordering", namespace: "https://x.example/ordering#" });

  it("is the project's iri_base and the context when the project declares one", () => {
    const ref = { iriBase: "https://data.acme.com/acme/", context: "ordering" };
    expect(namespaceOf(undefined, ref)).toBe("https://data.acme.com/acme/ordering/");
  });

  it("prefers the project's over the model's own, which projectRules reports", () => {
    const ref = { iriBase: "https://data.acme.com/acme/", context: "ordering" };
    expect(namespaceOf(own, ref)).toBe("https://data.acme.com/acme/ordering/");
  });

  it("puts the context through localName, so it is one path segment", () => {
    const ref = { iriBase: "https://data.acme.com/acme/", context: "Order Mgmt" };
    expect(namespaceOf(undefined, ref)).toBe("https://data.acme.com/acme/Order_Mgmt/");
  });

  it("is the model's own namespace without an iri_base, in a project or not", () => {
    expect(namespaceOf(own)).toBe("https://x.example/ordering#");
    expect(namespaceOf(own, { context: "ordering" })).toBe("https://x.example/ordering#");
  });

  it("is undefined when nothing declares one", () => {
    expect(namespaceOf(new OrmModel({ name: "M" }))).toBeUndefined();
    expect(namespaceOf(undefined, { context: "ordering" })).toBeUndefined();
  });
});

describe("the IRI patterns", () => {
  it("are the patterns the schemas apply, so core accepts only what its files hold", () => {
    // Compared as compiled sources: RegExp escapes `/`, the schema string does not.
    const compiled = (pattern: string) => new RegExp(pattern, "u").source;
    expect(
      compiled(schema("orm-project.schema.json").properties.project.properties.iri_base.pattern),
    )
      .toBe(IRI_BASE_PATTERN.source);
    expect(compiled(schema("orm-model.schema.json").properties.model.properties.namespace.pattern))
      .toBe(NAMESPACE_PATTERN.source);
  });

  it("are enforced where the value is set, so a save can always be reopened", () => {
    expect(() => new OrmModel({ name: "M", namespace: "not an iri" })).toThrow(/namespace/);
    expect(() => new OrmProject({ name: "P", iriBase: "https://x.example/acme" })).toThrow(
      /iri_base/,
    );
    expect(() => new OrmProject({ name: "P", iriBase: "" })).toThrow(/iri_base/);
    const model = new OrmModel({ name: "M" });
    expect(() => {
      model.namespace = "https://x.example/a";
    }).toThrow(/namespace/);
    model.namespace = undefined;
    expect(model.namespace).toBeUndefined();
    const project = new OrmProject({ name: "P" });
    expect(() => {
      project.iriBase = "https://x.example/acme";
    }).toThrow(/iri_base/);
  });
});
