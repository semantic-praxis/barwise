/**
 * Round-trip tests for the norma-export WS3 constructs (deontic
 * modality, object-type cardinality, fact-type derivation) and the WS2
 * diagram geometry: model -> writer -> serializer -> parser -> mapper
 * -> model, asserting each construct survives, plus spot checks that
 * the XML carries NORMA's documented encodings.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { mapNormaToOrm } from "../src/norma/NormaToOrmMapper.js";
import { parseNormaXml } from "../src/norma/NormaXmlParser.js";
import { serializeNormaDocument } from "../src/norma/NormaXmlSerializer.js";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";

function buildModel(): OrmModel {
  const model = new OrmModel({ name: "Constructs" });
  const customer = model.addObjectType({
    name: "Customer",
    id: "ot-customer",
    kind: "entity",
    referenceMode: "customer_id",
    cardinality: { min: 1, max: 100 },
  });
  const order = model.addObjectType({
    name: "Order",
    id: "ot-order",
    kind: "entity",
    referenceMode: "order_number",
    cardinality: { min: 0, max: "unbounded" },
  });
  model.addFactType({
    name: "Customer places Order",
    id: "ft-places",
    roles: [
      { id: "r-places", name: "places", playerId: customer.id },
      { id: "r-placed-by", name: "is placed by", playerId: order.id },
    ],
    readings: ["{0} places {1}"],
    constraints: [
      { type: "internal_uniqueness", roleIds: ["r-placed-by"], modality: "deontic" },
      { type: "mandatory", roleId: "r-placed-by" },
    ],
  });
  model.addFactType({
    name: "Customer is preferred",
    id: "ft-preferred",
    roles: [{ id: "r-preferred", name: "is preferred", playerId: customer.id }],
    readings: ["{0} is preferred"],
    constraints: [
      { type: "internal_uniqueness", roleIds: ["r-preferred"] },
      { type: "cardinality", id: "c-pref-card", roleId: "r-preferred", min: 0, max: 10 },
    ],
    derivation: {
      kind: "semiderived",
      storage: "derived_and_stored",
      expression: "Customer placed more than 10 Orders last year",
    },
  });
  model.addFactType({
    name: "Customer is active",
    id: "ft-active",
    roles: [{ id: "r-active", name: "is active", playerId: customer.id }],
    readings: ["{0} is active"],
    constraints: [
      { type: "internal_uniqueness", roleIds: ["r-active"] },
      {
        type: "cardinality",
        id: "c-active-card",
        roleId: "r-active",
        min: 2,
        max: "unbounded",
        modality: "deontic",
      },
    ],
  });
  model.addDiagramLayout({
    name: "Main",
    positions: {
      Customer: { x: 192, y: 96 },
      Order: { x: 480, y: 96 },
      "Customer places Order": { x: 336, y: 96 },
    },
    orientations: {},
  });
  return model;
}

function roundTrip(model: OrmModel): { xml: string; back: OrmModel; } {
  const xml = serializeNormaDocument(writeOrmToNorma(model));
  return { xml, back: mapNormaToOrm(parseNormaXml(xml)) };
}

describe("NORMA construct round-trip (WS3)", () => {
  const { xml, back } = roundTrip(buildModel());

  it("emits the documented encodings", () => {
    expect(xml).toContain('Modality="Deontic"');
    expect(xml).toContain("orm:CardinalityRange");
    expect(xml).toContain('From="1"');
    expect(xml).toContain('To="100"');
    expect(xml).toContain('DerivationCompleteness="PartiallyDerived"');
    expect(xml).toContain('DerivationStorage="Stored"');
    expect(xml).toContain("orm:DerivationNote");
    expect(xml).toContain("ormDiagram:ORMDiagram");
    expect(xml).toContain("AbsoluteBounds");
  });

  it("round-trips deontic modality; alethic stays implicit", () => {
    const ft = back.getFactTypeByName("Customer places Order")!;
    const uc = ft.constraints.find((c) => c.type === "internal_uniqueness")!;
    expect(uc.modality).toBe("deontic");
    const mand = ft.constraints.find((c) => c.type === "mandatory")!;
    expect(mand.modality).toBeUndefined();
  });

  it("round-trips object-type cardinality, bounded and unbounded", () => {
    expect(back.getObjectTypeByName("Customer")!.cardinality).toEqual({ min: 1, max: 100 });
    expect(back.getObjectTypeByName("Order")!.cardinality).toEqual({
      min: 0,
      max: "unbounded",
    });
  });

  it("emits unary-role cardinality on the Role element, not top-level", () => {
    expect(xml).toContain("orm:UnaryRoleCardinalityConstraint");
    // The restriction nests inside the fact's Role, so the constraint id
    // must not appear in the fact's InternalConstraints refs.
    expect(xml).not.toMatch(/InternalConstraints[^>]*>[^]*?ref="c-pref-card"/);
  });

  it("round-trips unary-role cardinality, bounded and deontic-unbounded", () => {
    const pref = back.getFactTypeByName("Customer is preferred")!;
    const prefCard = pref.constraints.find((c) => c.type === "cardinality")!;
    expect(prefCard).toMatchObject({
      roleId: pref.roles[0]!.id,
      min: 0,
      max: 10,
    });
    expect(prefCard.modality).toBeUndefined();

    const active = back.getFactTypeByName("Customer is active")!;
    const activeCard = active.constraints.find((c) => c.type === "cardinality")!;
    expect(activeCard).toMatchObject({
      roleId: active.roles[0]!.id,
      min: 2,
      max: "unbounded",
      modality: "deontic",
    });
  });

  it("round-trips the derivation rule", () => {
    const ft = back.getFactTypeByName("Customer is preferred")!;
    expect(ft.derivation).toBeDefined();
    expect(ft.derivation!.kind).toBe("semiderived");
    expect(ft.derivation!.storage).toBe("derived_and_stored");
    expect(ft.derivation!.expression).toBe(
      "Customer placed more than 10 Orders last year",
    );
  });

  it("a fully-derived, unstored rule omits the default attributes", () => {
    const model = new OrmModel({ name: "Defaults" });
    const a = model.addObjectType({
      name: "A",
      id: "ot-a",
      kind: "entity",
      referenceMode: "a_id",
    });
    model.addFactType({
      name: "A is active",
      id: "ft-active",
      roles: [{ id: "r-active", name: "is active", playerId: a.id }],
      readings: ["{0} is active"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["r-active"] }],
      derivation: { kind: "derived", expression: "A did something" },
    });
    const { xml: x, back: b } = roundTrip(model);
    expect(x).not.toContain("DerivationCompleteness");
    expect(x).not.toContain("DerivationStorage");
    const ft = b.getFactTypeByName("A is active")!;
    expect(ft.derivation!.kind).toBe("derived");
    expect(ft.derivation!.storage).toBeUndefined();
  });
});

describe("NORMA diagram geometry round-trip (WS2)", () => {
  const { back } = roundTrip(buildModel());

  it("round-trips saved layout positions through inch coordinates", () => {
    const layout = back.getDiagramLayout("Main");
    expect(layout).toBeDefined();
    expect(layout!.positions["Customer"]).toEqual({ x: 192, y: 96 });
    expect(layout!.positions["Order"]).toEqual({ x: 480, y: 96 });
    expect(layout!.positions["Customer places Order"]).toEqual({ x: 336, y: 96 });
  });

  it("emits no diagram section for a model with no saved layout", () => {
    const model = new OrmModel({ name: "Bare" });
    model.addObjectType({ name: "A", id: "ot-a", kind: "entity", referenceMode: "a_id" });
    const { xml } = roundTrip(model);
    expect(xml).not.toContain("ormDiagram");
  });
});
