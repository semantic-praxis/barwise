/**
 * Split writes each shadow under its owner's id behind an alias the domain
 * imports (iri-identity 6d): `<owner>:<the owner's id>`, which can differ
 * from the local name of the shadow's name. Every reference to the shadow
 * follows, `source_context` goes, and an element kept with its id keeps
 * its `minted_from`.
 */
import { describe, expect, it } from "vitest";
import { splitModel } from "../../src/project/splitModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

// Invoice holds the id `Bill`: a name edited without a rename, which 4.0
// keeps (id-not-from-name warns), so the shadow must take the id, not the
// name. Customer is a Party, and Party lives in billing.
const SOURCE = `orm_version: "4.0"
model:
  name: shop
  object_types:
    - { id: Customer, name: Customer, kind: entity, reference_mode: nr }
    - { id: Bill, name: Invoice, kind: entity, reference_mode: nr }
    - { id: Party, name: Party, kind: entity, reference_mode: nr }
  fact_types:
    - id: Customer_pays_Invoice
      name: Customer pays Invoice
      roles:
        - { id: Customer_pays_Invoice.pays, player: Customer, role_name: pays }
        - { id: Customer_pays_Invoice.paid_by, player: Bill, role_name: paid by }
      readings: ["{0} pays {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [Customer_pays_Invoice.paid_by] }
  subtype_facts:
    - { subtype: Customer, supertype: Party }
`;

const split = () =>
  splitModel(SOURCE, {
    projectName: "Shop",
    domains: { crm: ["Customer"], billing: ["Invoice", "Party"] },
  });
const crmYaml = () => split().domains.find((d) => d.context === "crm")!.yaml;

describe("a split domain's shadows", () => {
  it("take the owner's id behind the owner's alias, which the domain imports", () => {
    const crm = new OrmYamlSerializer().deserialize(crmYaml());
    const shadows = crm.objectTypes.filter((ot) => ot.id.includes(":")).map((ot) => ot.id);
    expect(shadows.sort()).toEqual(["billing:Bill", "billing:Party"]);
    expect([...crm.imports]).toEqual([["billing", "billing"]]);
    expect(crmYaml()).not.toContain("source_context");
  });

  it("are what every reference names: a role's player and a subtype fact's end", () => {
    const crm = new OrmYamlSerializer().deserialize(crmYaml());
    expect(crm.getFactType("Customer_pays_Invoice")!.roles.map((r) => r.playerId)).toEqual([
      "Customer",
      "billing:Bill",
    ]);
    expect(crm.subtypeFacts.map((sf) => [sf.subtypeId, sf.supertypeId])).toEqual([
      ["Customer", "billing:Party"],
    ]);
  });

  it("leave each element kept with its id its minted_from (6b-2b-2b-1's review)", () => {
    const source = new OrmYamlSerializer().deserialize(SOURCE);
    const [uc] = source.getFactType("Customer_pays_Invoice")!.internalConstraints;
    const crm = new OrmYamlSerializer().deserialize(crmYaml());
    expect(crm.getConstraint(uc!.id!)).toBeDefined();
    expect(crm.mintedFromOf(uc!.id!)).toBe(source.mintedFromOf(uc!.id!));
    // The subtype fact's sentence names Party, now a shadow of the same
    // name, so its key reads the same.
    const sfId = source.subtypeFacts[0]!.id!;
    expect(crm.mintedFromOf(sfId)).toBe(source.mintedFromOf(sfId));
  });
});

describe("a split domain's aliases", () => {
  it("never give two owners one alias: the second takes the 3.x reader's _2", () => {
    // "Sales Ops" and "Sales_Ops" have one local name.
    const source = `orm_version: "4.0"
model:
  name: m
  object_types:
    - { id: A, name: A, kind: entity, reference_mode: nr }
    - { id: B, name: B, kind: entity, reference_mode: nr }
    - { id: C, name: C, kind: entity, reference_mode: nr }
  fact_types:
    - id: C_knows_A_and_B
      name: C knows A and B
      roles:
        - { id: C_knows_A_and_B.c, player: C, role_name: c }
        - { id: C_knows_A_and_B.a, player: A, role_name: a }
        - { id: C_knows_A_and_B.b, player: B, role_name: b }
      readings: ["{0} knows {1} and {2}"]
`;
    const result = splitModel(source, {
      projectName: "P",
      domains: { core: ["C"], "Sales Ops": ["A"], Sales_Ops: ["B"] },
    });
    const core = new OrmYamlSerializer().deserialize(
      result.domains.find((d) => d.context === "core")!.yaml,
    );
    expect(Object.fromEntries(core.imports)).toEqual({
      Sales_Ops: "Sales Ops",
      Sales_Ops_2: "Sales_Ops",
    });
    expect(core.objectTypes.map((o) => o.id).sort()).toEqual([
      "C",
      "Sales_Ops:A",
      "Sales_Ops_2:B",
    ]);
  });

  it("keep a shadow the source already holds behind an alias, with its import", () => {
    const source = `orm_version: "4.0"
model:
  name: m
  imports: { ext: "https://example.org/ext/" }
  object_types:
    - { id: "ext:Party", name: Party, kind: entity, reference_mode: nr }
    - { id: Order, name: Order, kind: entity, reference_mode: nr }
    - { id: Item, name: Item, kind: entity, reference_mode: nr }
  fact_types:
    - id: Party_places_Order
      name: Party places Order
      roles:
        - { id: Party_places_Order.party, player: "ext:Party", role_name: party }
        - { id: Party_places_Order.order, player: Order, role_name: order }
      readings: ["{0} places {1}"]
    - id: Item_is_wanted_by_Party
      name: Item is wanted by Party
      roles:
        - { id: Item_is_wanted_by_Party.item, player: Item, role_name: item }
        - { id: Item_is_wanted_by_Party.party, player: "ext:Party", role_name: party }
      readings: ["{0} is wanted by {1}"]
`;
    const result = splitModel(source, {
      projectName: "P",
      domains: { orders: ["Order", "Party"], items: ["Item"] },
    });
    for (const d of result.domains) {
      const model = new OrmYamlSerializer().deserialize(d.yaml);
      expect(model.getObjectType("ext:Party"), d.context).toBeDefined();
      expect(model.imports.get("ext"), d.context).toBe("https://example.org/ext/");
    }
  });
});
