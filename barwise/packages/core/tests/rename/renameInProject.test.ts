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
import { assembleProject, type ProjectFiles } from "../../src/serialization/projectAssembly.js";
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
    sales.addDefinition({ term: "Order", definition: "A shipment request." });
    const shipping = new OrmModel({ name: "shipping" });
    shipping.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_nr" });
    project.addDomain({ path: "sales.orm.yaml", context: "sales" }).setModel(sales);
    project.addDomain({ path: "shipping.orm.yaml", context: "shipping" }).setModel(shipping);

    const { project: renamed, changes } = renameInProject(project, "sales", {
      kind: "objectType",
      name: "Order",
    }, "SalesOrder");
    expect(renamed.getDomain("sales")!.model!.definitions.map((d) => d.term)).toEqual(["Order"]);
    expect(changes.some((c) => c.startsWith('Left the definition of "Order"'))).toBe(true);
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
