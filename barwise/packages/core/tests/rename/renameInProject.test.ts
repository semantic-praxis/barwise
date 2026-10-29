/**
 * `renameInProject` (iri-identity WS5): the rename follows the element into
 * the shadows, reference modes, definitions and mapping files that name it,
 * across the project's domains.
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmProject } from "../../src/model/OrmProject.js";
import { splitModel } from "../../src/project/splitModel.js";
import { RenameError } from "../../src/rename/renameInModel.js";
import { renameInProject } from "../../src/rename/renameInProject.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { assembleProject, type ProjectFiles } from "../../src/serialization/projectAssembly.js";
import { ProjectSerializer } from "../../src/serialization/ProjectSerializer.js";
import { projectRules } from "../../src/validation/rules/projectRules.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

/**
 * A shop split into `catalog` (first, so it receives every definition),
 * `crm`, which owns Customer and its key value type CustomerId, and
 * `billing`, which owns Invoice and holds a shadow of Customer through
 * "Invoice is billed to Customer" (split homes a fact type with its first
 * player) but no shadow of CustomerId.
 */
const SHOP = `orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-product, name: Product, kind: entity, reference_mode: sku }
    - { id: ot-customer, name: Customer, kind: entity, reference_mode: customer_id }
    - { id: ot-cid, name: CustomerId, kind: value }
    - { id: ot-invoice, name: Invoice, kind: entity, reference_mode: invoice_nr }
  fact_types:
    - id: ft-cid
      name: Customer has CustomerId
      roles:
        - { id: r1, player: ot-customer, role_name: has }
        - { id: r2, player: ot-cid, role_name: of }
      readings: ["{0} has {1}"]
    - id: ft-billed
      name: Invoice is billed to Customer
      roles:
        - { id: r3, player: ot-invoice, role_name: billed to }
        - { id: r4, player: ot-customer, role_name: billed for }
      readings: ["{0} is billed to {1}"]
  definitions:
    - { term: Customer, definition: "A person who buys." }
    - { term: Product, definition: "A thing for sale." }
`;

function splitShop() {
  const result = splitModel(SHOP, {
    projectName: "Shop",
    domains: { catalog: ["Product"], crm: ["Customer", "CustomerId"], billing: ["Invoice"] },
  });
  const files: ProjectFiles = {
    domains: new Map(result.domains.map((d) => [d.fileName, { content: d.yaml }])),
    mappings: new Map(result.mappings.map((m) => [m.fileName, { content: m.yaml }])),
  };
  const { project, problems } = assembleProject(result.manifestYaml, files, { lenient: true });
  expect(problems).toEqual([]);
  return project;
}

/** Every diagnostic, project and domain, as comparable strings. */
function diagnostics(project: OrmProject): string[] {
  const engine = new ValidationEngine();
  return [
    ...projectRules(project).map((d) => `${d.ruleId}`),
    ...project.domains.flatMap((d) =>
      engine.validate(d.model!).map((x) => `${d.context}:${x.ruleId}`)
    ),
  ].sort();
}

describe("renameInProject", () => {
  it("renames an owned object type, its shadows and both mapping sides, and names the files", () => {
    const before = splitShop();
    const { project, files, changes } = renameInProject(before, "crm", {
      kind: "objectType",
      name: "Customer",
    }, "Client");

    const crm = project.getDomain("crm")!.model!;
    const billing = project.getDomain("billing")!.model!;
    expect(crm.getObjectTypeByName("Client")).toBeDefined();
    expect(billing.getObjectTypeByName("Client")).toMatchObject({ sourceContext: "crm" });
    expect(billing.getObjectTypeByName("Customer")).toBeUndefined();

    const mapping = project.mappings.find((m) =>
      m.sourceContext === "crm" && m.targetContext === "billing"
    )!;
    expect(mapping.entityMappings.map((em) => [em.sourceObjectType, em.targetObjectType])).toEqual([
      ["Client", "Client"],
    ]);

    // The definition sits in the first domain, which split gave every definition.
    expect(project.getDomain("catalog")!.model!.definitions.map((d) => d.term)).toContain("Client");

    expect([...files].sort()).toEqual(
      ["domains/billing.orm.yaml", "domains/catalog.orm.yaml", "domains/crm.orm.yaml", mapping.path]
        .sort(),
    );
    expect(changes.length).toBeGreaterThan(0);
    // The input project is unchanged, and nothing new is wrong with the result.
    expect(before.getDomain("billing")!.model!.getObjectTypeByName("Customer")).toBeDefined();
    expect(diagnostics(project)).toEqual(diagnostics(before));
  });

  it("follows a renamed key value type into the reference mode of the entity's shadow", () => {
    const { project } = renameInProject(splitShop(), "crm", {
      kind: "objectType",
      name: "CustomerId",
    }, "ClientKey");
    expect(project.getDomain("crm")!.model!.getObjectTypeByName("Customer")).toMatchObject({
      referenceMode: "client_key",
    });
    // billing holds no shadow of CustomerId, only of Customer, and its key
    // columns must still agree with the owner's.
    expect(project.getDomain("billing")!.model!.getObjectTypeByName("Customer")).toMatchObject({
      referenceMode: "client_key",
    });
  });

  it("refuses when a shadow's domain already holds the new name, naming the domain", () => {
    const project = splitShop();
    project.getDomain("billing")!.model!.addObjectType({
      name: "Client",
      kind: "entity",
      referenceMode: "client_nr",
    });
    expect(() =>
      renameInProject(project, "crm", { kind: "objectType", name: "Customer" }, "Client")
    ).toThrow(
      /In domain "billing": There is already an object type named "Client"/,
    );
  });

  it("refuses to rename a shadow directly", () => {
    expect(() =>
      renameInProject(splitShop(), "billing", { kind: "objectType", name: "Customer" }, "Client")
    )
      .toThrow(/shadow of an object type owned by "crm"/);
  });

  it("leaves a definition when an unrelated element elsewhere has the name", () => {
    const project = new OrmProject({ name: "P" });
    const sales = new OrmModel({ name: "sales" });
    sales.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_nr" });
    // The definition sits apart, as split puts definitions in one domain,
    // and describes shipping's Order, not sales'.
    const glossary = new OrmModel({ name: "glossary" });
    glossary.addDefinition({ term: "Order", definition: "A shipment request." });
    const shipping = new OrmModel({ name: "shipping" });
    shipping.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_nr" });
    project.addDomain({ path: "glossary.orm.yaml", context: "glossary" }).setModel(glossary);
    project.addDomain({ path: "sales.orm.yaml", context: "sales" }).setModel(sales);
    project.addDomain({ path: "shipping.orm.yaml", context: "shipping" }).setModel(shipping);

    const { project: renamed, changes, files } = renameInProject(project, "sales", {
      kind: "objectType",
      name: "Order",
    }, "SalesOrder");
    expect(renamed.getDomain("glossary")!.model!.definitions.map((d) => d.term)).toEqual(["Order"]);
    expect(changes.some((c) => c.startsWith('Left the definition of "Order"'))).toBe(true);
    expect(files).toEqual(["sales.orm.yaml"]);
  });

  it("renames a fact type and a role, naming only the files that changed", () => {
    const ft = renameInProject(splitShop(), "crm", {
      kind: "factType",
      name: "Customer has CustomerId",
    }, "Customer is keyed by CustomerId");
    expect(ft.project.getDomain("crm")!.model!.getFactTypeByName("Customer is keyed by CustomerId"))
      .toBeDefined();
    expect(ft.files).toEqual(["domains/crm.orm.yaml"]);

    const role = renameInProject(splitShop(), "billing", {
      kind: "role",
      factType: "Invoice is billed to Customer",
      role: 0,
    }, "sent to");
    expect(
      role.project.getDomain("billing")!.model!.getFactTypeByName("Invoice is billed to Customer")!
        .roles[0]!.name,
    )
      .toBe("sent to");
    expect(role.files).toEqual(["domains/billing.orm.yaml"]);
  });

  it("renames a fact type's definition wherever split put it", () => {
    const project = splitShop();
    project.getDomain("catalog")!.model!.addDefinition({
      term: "Customer has CustomerId",
      definition: "The key.",
    });
    const { project: renamed, files } = renameInProject(project, "crm", {
      kind: "factType",
      name: "Customer has CustomerId",
    }, "Customer is keyed by CustomerId");
    expect(renamed.getDomain("catalog")!.model!.definitions.map((d) => d.term)).toContain(
      "Customer is keyed by CustomerId",
    );
    expect([...files].sort()).toEqual(["domains/catalog.orm.yaml", "domains/crm.orm.yaml"]);
  });

  it("follows a reference mode changed at a shadow back to its owner", () => {
    const project = new OrmProject({ name: "P" });
    const a = new OrmModel({ name: "a" });
    a.addObjectType({ id: "c", name: "Customer", kind: "entity", referenceMode: "customer_id" });
    a.addObjectType({ id: "v", name: "CustomerId", kind: "value" });
    const b = new OrmModel({ name: "b" });
    b.addObjectType({
      id: "c",
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      sourceContext: "a",
    });
    b.addObjectType({ id: "v", name: "CustomerId", kind: "value", sourceContext: "a" });
    b.addFactType({
      name: "Customer has CustomerId",
      roles: [{ name: "has", playerId: "c" }, { name: "of", playerId: "v" }],
      readings: ["{0} has {1}"],
    });
    project.addDomain({ path: "a.orm.yaml", context: "a" }).setModel(a);
    project.addDomain({ path: "b.orm.yaml", context: "b" }).setModel(b);

    const { project: renamed, changes } = renameInProject(project, "a", {
      kind: "objectType",
      name: "CustomerId",
    }, "ClientKey");
    expect(renamed.getDomain("b")!.model!.getObjectType("c")).toMatchObject({
      referenceMode: "client_key",
    });
    expect(renamed.getDomain("a")!.model!.getObjectType("c")).toMatchObject({
      referenceMode: "client_key",
    });
    expect(changes.filter((c) => c.includes("reference mode"))).toHaveLength(2);
  });

  it("leaves a shadow whose reference mode is not the old one", () => {
    const project = splitShop();
    const billing = project.getDomain("billing")!.model!;
    const shadow = billing.getObjectTypeByName("Customer")!;
    // Rebuild billing with the shadow's mode set by hand.
    const yaml = new OrmYamlSerializer().serialize(billing).replace(
      `name: Customer\n      kind: entity\n      reference_mode: customer_id`,
      `name: Customer\n      kind: entity\n      reference_mode: cust_no`,
    );
    project.getDomain("billing")!.setModel(
      new OrmYamlSerializer().deserialize(yaml, { lenient: true }),
    );
    expect(project.getDomain("billing")!.model!.getObjectType(shadow.id)).toMatchObject({
      referenceMode: "cust_no",
    });

    const { project: renamed } = renameInProject(project, "crm", {
      kind: "objectType",
      name: "CustomerId",
    }, "ClientKey");
    expect(renamed.getDomain("billing")!.model!.getObjectType(shadow.id)).toMatchObject({
      referenceMode: "cust_no",
    });
  });

  it("refuses a key shift raised in another domain, naming it", () => {
    // In billing, Invoice plays a value type the owner's rename turns into
    // a second match for Invoice's reference mode.
    const project = splitShop();
    const billing = project.getDomain("billing")!.model!;
    const id = billing.addObjectType({ name: "CustomerId", kind: "value", sourceContext: "crm" });
    const invoice = billing.getObjectTypeByName("Invoice")!;
    const nr = billing.addObjectType({ name: "Invoice_Nr", kind: "value" });
    billing.addFactType({
      name: "Invoice has Invoice_Nr",
      roles: [{ name: "has", playerId: invoice.id }, { name: "of", playerId: nr.id }],
      readings: ["{0} has {1}"],
    });
    billing.addFactType({
      name: "Invoice has CustomerId",
      roles: [{ name: "has", playerId: invoice.id }, { name: "of", playerId: id.id }],
      readings: ["{0} has {1}"],
    });
    expect(() =>
      renameInProject(project, "crm", { kind: "objectType", name: "CustomerId" }, "InvoiceNr")
    )
      .toThrow(/^In domain "billing": The rename would give entity "Invoice" 2 value types/);
  });

  it("says that data products were not checked", () => {
    const project = splitShop();
    project.addProduct({
      path: "products/report.orm.yaml",
      context: "report",
      dependsOnDomains: ["crm"],
      dependsOnMappings: [],
    });
    const { changes } = renameInProject(
      project,
      "crm",
      { kind: "objectType", name: "Customer" },
      "Client",
    );
    expect(changes).toContain(
      "Data products are not loaded as models, so any reference to the old name in a product file was not checked.",
    );
  });

  it("keeps every manifest field: the rebuilt project serializes as the input did", () => {
    const project = splitShop();
    project.iriBase = "https://data.acme.com/shop/";
    project.addProduct({
      path: "products/report.orm.yaml",
      context: "report",
      dependsOnDomains: ["crm"],
      dependsOnMappings: [],
    });
    const { project: renamed } = renameInProject(project, "crm", {
      kind: "objectType",
      name: "Customer",
    }, "Client");
    const manifest = new ProjectSerializer();
    expect(manifest.serialize(renamed)).toBe(manifest.serialize(project));
  });

  it("refuses a project with a domain that is not loaded", () => {
    const project = new OrmProject({ name: "P" });
    project.addDomain({ path: "a.orm.yaml", context: "a" });
    expect(() => renameInProject(project, "a", { kind: "objectType", name: "X" }, "Y")).toThrow(
      RenameError,
    );
    expect(() => renameInProject(project, "a", { kind: "objectType", name: "X" }, "Y")).toThrow(
      /is not loaded/,
    );
  });
});
