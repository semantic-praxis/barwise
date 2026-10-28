/**
 * `namespaceOf` (iri-identity WS4): where a model's element IRIs start.
 */
import { describe, expect, it } from "vitest";
import { namespaceOf } from "../../src/model/namespace.js";
import { OrmModel } from "../../src/model/OrmModel.js";

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
