/**
 * `iriOf` (iri-identity WS6, 6b-3c), held to the spec's own example
 * (Target architecture) and to what it must leave unanswered: no
 * namespace (decision 11), an alias with no project, an alias the model
 * does not import or whose context the project does not hold.
 */
import { describe, expect, it } from "vitest";
import { iriOf } from "../../src/model/namespace.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmProject } from "../../src/model/OrmProject.js";

const domain = (name: string, config: Partial<ConstructorParameters<typeof OrmModel>[0]> = {}) =>
  new OrmModel({ name, domainContext: name, idsAcrossKinds: true, ...config });

/** The spec's acme project: `iri_base` https://data.acme.com/acme/. */
function acme(iriBase: string | null = "https://data.acme.com/acme/") {
  const project = new OrmProject({ name: "acme", ...(iriBase ? { iriBase } : {}) });
  const ordering = domain("ordering", {
    imports: { billing: "billing", ext: "https://ext.example/ns#" },
  });
  const billing = domain("billing", { namespace: "https://billing.example/" });
  project.addDomain({ path: "ordering.orm.yaml", context: "ordering" }).setModel(ordering);
  project.addDomain({ path: "billing.orm.yaml", context: "billing" }).setModel(billing);
  return { project, ordering, at: { project, context: "ordering" } };
}

describe("iriOf", () => {
  it("gives the spec's IRIs for a local id and an alias id through the project", () => {
    const { ordering, at } = acme();
    expect(iriOf(ordering, "Customer", at)).toBe("https://data.acme.com/acme/ordering/Customer");
    expect(iriOf(ordering, "billing:Invoice", at)).toBe(
      "https://data.acme.com/acme/billing/Invoice",
    );
    expect(iriOf(ordering, "Customer_places_Order.places", at)).toBe(
      "https://data.acme.com/acme/ordering/Customer_places_Order.places",
    );
  });

  it("expands an alias bound to an absolute namespace IRI", () => {
    const { ordering, at } = acme();
    expect(iriOf(ordering, "ext:Thing", at)).toBe("https://ext.example/ns#Thing");
  });

  it("uses each domain's own namespace in a project without iri_base", () => {
    const { ordering, at } = acme(null);
    // ordering declares none (decision 11); billing does.
    expect(iriOf(ordering, "Customer", at)).toBeUndefined();
    expect(iriOf(ordering, "billing:Invoice", at)).toBe("https://billing.example/Invoice");
  });

  it("without a project, expands a local id from the model's namespace and nothing else", () => {
    const model = domain("m", { namespace: "https://m.example/", imports: { billing: "billing" } });
    expect(iriOf(model, "Customer")).toBe("https://m.example/Customer");
    // It does not search for a project, so an alias means nothing here.
    expect(iriOf(model, "billing:Invoice")).toBeUndefined();
    expect(iriOf(domain("bare"), "Customer")).toBeUndefined();
  });

  it("gives nothing for an alias the model does not import or a context the project lacks", () => {
    const { ordering, at, project } = acme();
    expect(iriOf(ordering, "crm:Lead", at)).toBeUndefined();
    ordering.setImport("hr", "hr");
    expect(project.getDomain("hr")).toBeUndefined();
    expect(iriOf(ordering, "hr:Person", at)).toBeUndefined();
  });
});
