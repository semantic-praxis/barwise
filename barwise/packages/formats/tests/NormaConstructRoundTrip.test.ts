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

describe("exclusive-or round-trip (norma-round-trip-completion WS1)", () => {
  function xorModel(): OrmModel {
    const model = new OrmModel({ name: "Xor" });
    const person = model.addObjectType({
      name: "Person",
      id: "ot-person",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addFactType({
      name: "Person is employed",
      id: "ft-employed",
      roles: [{ id: "r-employed", name: "is employed", playerId: person.id }],
      readings: ["{0} is employed"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["r-employed"] }],
    });
    model.addFactType({
      name: "Person is retired",
      id: "ft-retired",
      roles: [{ id: "r-retired", name: "is retired", playerId: person.id }],
      readings: ["{0} is retired"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r-retired"] },
        { type: "exclusive_or", id: "c-xor", roleIds: ["r-employed", "r-retired"] },
      ],
    });
    return model;
  }

  it("exports the coupled pair and re-imports a single exclusive_or", () => {
    const { xml, back } = roundTrip(xorModel());
    expect(xml).toContain("orm:ExclusiveOrMandatoryConstraint");
    expect(xml).toContain("orm:ExclusiveOrExclusionConstraint");
    expect(xml).toMatch(/MandatoryConstraint[^>]*IsSimple="false"/);

    const all = back.factTypes.flatMap((f) => f.constraints);
    const xors = all.filter((c) => c.type === "exclusive_or");
    expect(xors).toHaveLength(1);
    const expectedRoleIds = [
      back.getFactTypeByName("Person is employed")!.roles[0]!.id,
      back.getFactTypeByName("Person is retired")!.roles[0]!.id,
    ].sort();
    expect([...xors[0]!.roleIds].sort()).toEqual(expectedRoleIds);
    expect(all.some((c) => c.type === "exclusion")).toBe(false);
    expect(all.some((c) => c.type === "disjunctive_mandatory")).toBe(false);
  });

  it("collapses a pair carrying only the mandatory-side coupler", () => {
    // NORMA writes both coupler refs; a file carrying only one must
    // still collapse. Strip the exclusion-side coupler and re-import.
    const xml = serializeNormaDocument(writeOrmToNorma(xorModel()));
    const oneSided = xml.replace(/<orm:ExclusiveOrMandatoryConstraint[^/]*\/>/, "");
    expect(oneSided).not.toContain("ExclusiveOrMandatoryConstraint");
    expect(oneSided).toContain("ExclusiveOrExclusionConstraint");

    const back = mapNormaToOrm(parseNormaXml(oneSided));
    const all = back.factTypes.flatMap((f) => f.constraints);
    expect(all.filter((c) => c.type === "exclusive_or")).toHaveLength(1);
    expect(all.some((c) => c.type === "exclusion")).toBe(false);
    expect(all.some((c) => c.type === "disjunctive_mandatory")).toBe(false);
  });
});

describe("value-comparison round-trip (norma-round-trip-completion WS2)", () => {
  function comparisonModel(): OrmModel {
    const model = new OrmModel({ name: "Comparison" });
    const period = model.addObjectType({
      name: "ReviewPeriod",
      id: "ot-period",
      kind: "entity",
      referenceMode: "period_id",
    });
    const date = model.addObjectType({
      name: "EventDate",
      id: "ot-date",
      kind: "value",
      dataType: { name: "date" },
    });
    model.addFactType({
      name: "ReviewPeriod runs from and to",
      id: "ft-runs",
      roles: [
        { id: "r-period", name: "spans", playerId: period.id },
        { id: "r-start", name: "starts on", playerId: date.id },
        { id: "r-end", name: "ends on", playerId: date.id },
      ],
      readings: ["{0} runs from {1} to {2}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r-period"] },
        {
          type: "value_comparison",
          id: "c-cmp",
          roleId1: "r-start",
          roleId2: "r-end",
          operator: "<=",
          modality: "deontic",
        },
      ],
    });
    return model;
  }

  it("round-trips the constraint with its operator and modality", () => {
    const { xml, back } = roundTrip(comparisonModel());
    expect(xml).toContain("orm:ValueComparisonConstraint");
    expect(xml).toContain('Operator="LessThanOrEqual"');

    const ft = back.getFactTypeByName("ReviewPeriod runs from and to")!;
    const cmp = ft.constraints.find((c) => c.type === "value_comparison")!;
    expect(cmp).toMatchObject({
      roleId1: ft.roles[1]!.id,
      roleId2: ft.roles[2]!.id,
      operator: "<=",
      modality: "deontic",
    });
  });
});

describe("default-value round-trip (norma-round-trip-completion WS3)", () => {
  it("round-trips a value-type default, preserving numeric text", () => {
    const model = new OrmModel({ name: "Defaults" });
    const status = model.addObjectType({
      name: "StatusCode",
      id: "ot-status",
      kind: "value",
      dataType: { name: "text" },
      defaultValue: "active",
    });
    model.addObjectType({
      name: "RetryCount",
      id: "ot-retry",
      kind: "value",
      dataType: { name: "integer" },
      defaultValue: "3",
    });
    const order = model.addObjectType({
      name: "Order",
      id: "ot-order",
      kind: "entity",
      referenceMode: "order_id",
    });
    model.addFactType({
      name: "Order has StatusCode",
      id: "ft-status",
      roles: [
        { id: "r-order", name: "has", playerId: order.id },
        { id: "r-status", name: "is of", playerId: status.id },
      ],
      readings: ["{0} has {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["r-order"] }],
    });

    const { xml, back } = roundTrip(model);
    expect(xml).toContain("orm:DefaultValue");
    expect(back.getObjectTypeByName("StatusCode")!.defaultValue).toBe("active");
    expect(back.getObjectTypeByName("RetryCount")!.defaultValue).toBe("3");
    expect(back.getObjectTypeByName("Order")!.defaultValue).toBeUndefined();
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
