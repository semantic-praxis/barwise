/**
 * Ossie's `iri` under format 4.0 (iri-identity 6f, decision 1): the export
 * writes each element's identity IRI, the importer reads the model's
 * namespace back from the concepts' IRIs, and the namespace leaves the loss
 * block where it does come back.
 */
import { OrmModel } from "@barwise/core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OssieExportFormat } from "../src/ossie/OssieExportFormat.js";
import { OssieImportFormat } from "../src/ossie/OssieImportFormat.js";
import { namespaceOfIris } from "../src/ossie/ossieNamespace.js";
import { compileOssieSchema } from "../src/ossie/ossieSchema.js";
import type { OssieDocument } from "../src/ossie/OssieTypes.js";

const NS = "https://data.acme.com/sales/";

/** Customer places Order, with local-name ids, under `namespace` if given. */
function shop(namespace?: string, imports?: Record<string, string>): OrmModel {
  const m = new OrmModel({
    name: "Shop",
    ...(namespace ? { namespace } : {}),
    ...(imports ? { imports } : {}),
  });
  m.addObjectType({ name: "Customer", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ name: "Order", kind: "entity", referenceMode: "nr" });
  m.addFactType({
    name: "Customer places Order",
    roles: [{ name: "places", playerId: "Customer" }, { name: "is placed by", playerId: "Order" }],
    readings: ["{0} places {1}"],
  });
  return m;
}

const exportOf = (m: OrmModel) => {
  const { text } = new OssieExportFormat().export(m);
  const losses = text.split("\n").filter((l) => l.startsWith("# barwise: "));
  return { text, losses, document: parse(text) as OssieDocument };
};

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addFormat("iri", /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/u);
  return compileOssieSchema(ajv);
}

describe("an Ossie export's iri", () => {
  it("is each element's identity IRI, the namespace and its id", () => {
    const { document } = exportOf(shop(NS));
    const customer = document.ontology.find((c) => c.concept === "Customer")!;
    expect(customer.iri).toBe(`${NS}Customer`);
    expect(customer.relationships!.map((r) => r.iri)).toEqual([`${NS}Customer_places_Order`]);
    expect(validator()(document)).toBe(true);
  });

  it("carries the namespace, which reads back and leaves the loss block", () => {
    const { text, losses } = exportOf(shop(NS));
    expect(losses.filter((l) => l.includes("namespace"))).toEqual([]);
    const { model, warnings } = new OssieImportFormat().parse(text);
    expect(model.namespace).toBe(NS);
    // The concepts' IRIs are kept; a relationship's is not, since the
    // importer names its fact type from the Ossie name (/code-review, 6f).
    expect(warnings.filter((w) => w.includes("iri"))).toEqual([
      "Customer.customer_places_order: iri https://data.acme.com/sales/Customer_places_Order "
      + "dropped; barwise keeps an IRI only as the model's namespace followed by the element's id.",
    ]);
  });

  it("sits beside the name it identifies, before a concept's relationships", () => {
    const { text } = exportOf(shop(NS));
    expect(text).toContain(`  - concept: Customer\n    iri: ${NS}Customer\n`);
  });

  it("carries the namespace though one concept's old id ends in another's name", () => {
    // Item's id LineItem ends in "Item" with no boundary (/code-review, 6f).
    const m = new OrmModel({ name: "Shop", namespace: NS });
    m.addObjectType({ name: "Order", kind: "entity", referenceMode: "nr" });
    m.addObjectType({ id: "LineItem", name: "Item", kind: "entity", referenceMode: "nr" });
    const { text, losses } = exportOf(m);
    expect(losses.filter((l) => l.includes("namespace"))).toEqual([]);
    expect(new OssieImportFormat().parse(text).model.namespace).toBe(NS);
  });

  it("is not written, and nothing is lost, for a model with no namespace", () => {
    const { document, losses } = exportOf(shop());
    expect(document.ontology.some((c) => c.iri !== undefined)).toBe(false);
    expect(losses.filter((l) => l.includes("namespace"))).toEqual([]);
  });

  it("is not written for a shadow, whose namespace is its owner's and only the project knows", () => {
    const m = shop(NS, { crm: "crm" });
    m.addObjectType({ id: "crm:Party", name: "Party", kind: "entity", referenceMode: "nr" });
    m.addFactType({
      name: "Party owns Order",
      roles: [{ name: "owns", playerId: "crm:Party" }, { name: "is owned by", playerId: "Order" }],
      readings: ["{0} owns {1}"],
    });
    const { document } = exportOf(m);
    expect(document.ontology.find((c) => c.concept === "Party")!.iri).toBeUndefined();
  });

  it("keeps the namespace a loss where no concept's id is its name's, so it cannot come back", () => {
    // An id an edited name left behind (id-not-from-name): the IRI is the
    // element's identity, but the importer gives the concept another id.
    const m = new OrmModel({ name: "Shop", namespace: NS });
    m.addObjectType({ id: "Bill", name: "Invoice", kind: "entity", referenceMode: "nr" });
    const { document, losses } = exportOf(m);
    expect(document.ontology[0]!.iri).toBe(`${NS}Bill`);
    expect(losses).toContain(`# barwise: model: namespace ${NS} not written`);
  });
});

describe("an Ossie import's iri", () => {
  const doc = (customerIri: string, orderIri: string) =>
    `version: 0.2.0.dev0
name: Shop
ontology:
  - concept: Customer
    type: EntityType
    iri: ${customerIri}
  - concept: Order
    type: EntityType
    iri: ${orderIri}
`;

  it("gives the model the namespace every concept IRI agrees on, with no warning", () => {
    const { model, warnings } = new OssieImportFormat().parse(
      doc("https://ex.org/shop#Customer", "https://ex.org/shop#Order"),
    );
    expect(model.namespace).toBe("https://ex.org/shop#");
    expect(warnings.filter((w) => w.includes("iri"))).toEqual([]);
  });

  it("takes no namespace where the concept IRIs disagree, and names each one dropped", () => {
    const { model, warnings } = new OssieImportFormat().parse(
      doc("https://ex.org/a/Customer", "https://ex.org/b/Order"),
    );
    expect(model.namespace).toBeUndefined();
    expect(warnings.filter((w) => w.includes("iri"))).toHaveLength(2);
  });

  it("keeps the namespace most concepts agree on, naming an outside IRI dropped", () => {
    const { model, warnings } = new OssieImportFormat().parse(`version: 0.2.0.dev0
name: Shop
ontology:
  - { concept: Customer, type: EntityType, iri: "http://schema.org/Customer" }
  - { concept: Order, type: EntityType, iri: "https://ex.org/shop#Order" }
  - { concept: Item, type: EntityType, iri: "https://ex.org/shop#Item" }
`);
    expect(model.namespace).toBe("https://ex.org/shop#");
    expect(warnings.filter((w) => w.includes("iri"))).toEqual([
      "Customer: iri http://schema.org/Customer dropped; barwise keeps an IRI only as the model's "
      + "namespace followed by the element's id.",
    ]);
  });

  it("names an IRI outside the namespace it takes", () => {
    const { model, warnings } = new OssieImportFormat().parse(
      doc("https://ex.org/shop#Customer", "https://ex.org/shop#Purchase"),
    );
    expect(model.namespace).toBe("https://ex.org/shop#");
    expect(warnings.filter((w) => w.includes("iri"))).toEqual([
      "Order: iri https://ex.org/shop#Purchase dropped; barwise keeps an IRI only as the model's "
      + "namespace followed by the element's id.",
    ]);
  });
});

describe("the namespace a set of concept IRIs states", () => {
  it("is the one most agree on, at a / or # boundary, and none on a tie", () => {
    const ns = (...pairs: [string, string][]) =>
      namespaceOfIris(pairs.map(([iri, id]) => ({ iri, id })));
    expect(ns(["https://e/a/X", "X"], ["https://e/a/Y", "Y"], ["https://f/Z", "Z"])).toBe(
      "https://e/a/",
    );
    expect(ns(["https://e/a/X", "X"], ["https://f/Y", "Y"])).toBeUndefined();
    expect(ns(["https://e/LineItem", "Item"])).toBeUndefined();
    expect(ns(["https://e/a/X", "Y"])).toBeUndefined();
    expect(ns()).toBeUndefined();
  });

  it("is refused, with the reason named, when it is not one barwise can hold", () => {
    const { model, warnings } = new OssieImportFormat().parse(`version: 0.2.0.dev0
name: Shop
ontology:
  - { concept: Customer, type: EntityType, iri: "https://ex ample/Customer" }
`);
    expect(model.namespace).toBeUndefined();
    expect(
      warnings.some((w) =>
        w.startsWith("namespace https://ex ample/, which the concept IRIs state,")
      ),
    )
      .toBe(true);
  });
});
