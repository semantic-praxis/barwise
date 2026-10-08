/**
 * NORMA export draws exactly what a saved view shows
 * (docs/specs/norma-export-view-scope.spec.md, barwise-1065).
 *
 * The four views are the ones measured against the edge build on
 * 2026-10-08, where they exported as: nothing; three objects and no fact
 * types; three objects and no fact types; one object.
 */
import { type DiagramLayout, OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { mapNormaToOrm } from "../src/norma/NormaToOrmMapper.js";
import { parseNormaXml } from "../src/norma/NormaXmlParser.js";
import { serializeNormaDocument } from "../src/norma/NormaXmlSerializer.js";
import type { NormaDiagram } from "../src/norma/NormaXmlTypes.js";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";

const PX_PER_INCH = 96;

/** Customer places Order; Order includes Product; Customer is active. */
function shop(layouts: DiagramLayout[]): OrmModel {
  const model = new OrmModel({ name: "Shop" });
  for (
    const [id, name] of [["ot-customer", "Customer"], ["ot-order", "Order"], [
      "ot-product",
      "Product",
    ]]
  ) {
    model.addObjectType({ id, name, kind: "entity", referenceMode: `${name.toLowerCase()}_id` });
  }
  model.addFactType({
    id: "ft-places",
    name: "Customer places Order",
    roles: [
      { id: "r-p1", name: "places", playerId: "ot-customer" },
      { id: "r-p2", name: "is placed by", playerId: "ot-order" },
    ],
    readings: ["{0} places {1}"],
  });
  model.addFactType({
    id: "ft-includes",
    name: "Order includes Product",
    roles: [
      { id: "r-i1", name: "includes", playerId: "ot-order" },
      { id: "r-i2", name: "is included in", playerId: "ot-product" },
    ],
    readings: ["{0} includes {1}"],
  });
  model.addFactType({
    id: "ft-active",
    name: "Customer is active",
    roles: [{ id: "r-a1", name: "is active", playerId: "ot-customer" }],
    readings: ["{0} is active"],
  });
  for (const layout of layouts) model.addDiagramLayout(layout);
  return model;
}

function diagram(model: OrmModel, name: string): NormaDiagram {
  return writeOrmToNorma(model).diagrams!.find((d) => d.name === name)!;
}

/** Subject refs by shape kind, sorted. */
function subjects(d: NormaDiagram): { objects: string[]; facts: string[]; } {
  const of = (kind: string) =>
    d.shapes.filter((s) => s.kind === kind).map((s) => s.subjectRef).sort();
  return { objects: of("object_type"), facts: of("fact_type") };
}

/** Horizontal gap, in pixels, between two shapes (left edge of b minus right edge of a). */
function gapPx(d: NormaDiagram, a: string, b: string): number {
  const sa = d.shapes.find((sh) => sh.subjectRef === a)!;
  const sb = d.shapes.find((sh) => sh.subjectRef === b)!;
  return Math.round((sb.x - (sa.x + sa.width)) * PX_PER_INCH);
}

/** A shape's center in barwise pixels, recovered from its NORMA bounds. */
function center(d: NormaDiagram, subjectRef: string): { x: number; y: number; } {
  const s = d.shapes.find((sh) => sh.subjectRef === subjectRef)!;
  return {
    x: Math.round((s.x + s.width / 2) * PX_PER_INCH),
    y: Math.round((s.y + s.height / 2) * PX_PER_INCH),
  };
}

const none = { positions: {}, orientations: {} };

describe("NORMA export: view membership", () => {
  it("draws a view created without positions (Create View), not an empty diagram", () => {
    const d = diagram(shop([{ name: "V", elements: ["ot-customer", "ot-order"], ...none }]), "V");
    expect(subjects(d)).toEqual({
      objects: ["_ot-customer", "_ot-order"],
      facts: ["_ft-active", "_ft-places"],
    });
  });

  it("ignores a saved position for an element outside the view", () => {
    const d = diagram(
      shop([{
        name: "V",
        elements: ["ot-customer", "ot-order"],
        positions: {
          "ot-customer": { x: 100, y: 100 },
          "ot-order": { x: 400, y: 100 },
          "ot-product": { x: 700, y: 100 },
        },
        orientations: {},
      }]),
      "V",
    );
    expect(subjects(d).objects).toEqual(["_ot-customer", "_ot-order"]);
  });

  it("draws every fact type in a show-all view, not only moved ones", () => {
    const d = diagram(
      shop([{
        name: "All",
        positions: { "ot-customer": { x: 100, y: 100 }, "ot-order": { x: 400, y: 100 } },
        orientations: {},
      }]),
      "All",
    );
    expect(subjects(d)).toEqual({
      objects: ["_ot-customer", "_ot-order", "_ot-product"],
      facts: ["_ft-active", "_ft-includes", "_ft-places"],
    });
  });

  it("draws nothing for an empty view, whatever positions it carries", () => {
    const d = diagram(
      shop([{
        name: "E",
        elements: [],
        positions: { "ot-customer": { x: 1, y: 1 } },
        orientations: {},
      }]),
      "E",
    );
    expect(d.shapes).toEqual([]);
  });
});

describe("NORMA export: placement of members without a saved position", () => {
  it("keeps saved centers exactly", () => {
    const d = diagram(
      shop([{
        name: "V",
        positions: { "ot-customer": { x: 192, y: 96 }, "ft-places": { x: 336, y: 96 } },
        orientations: {},
      }]),
      "V",
    );
    expect(center(d, "_ot-customer")).toEqual({ x: 192, y: 96 });
    expect(center(d, "_ft-places")).toEqual({ x: 336, y: 96 });
  });

  it("places unpositioned object types in a row below the positioned ones, in model order", () => {
    const d = diagram(
      shop([{ name: "V", positions: { "ot-order": { x: 400, y: 100 } }, orientations: {} }]),
      "V",
    );
    // Row starts at the leftmost positioned x, 150 below the lowest, and
    // each box starts 60 px after the previous one ends.
    expect(center(d, "_ot-customer")).toEqual({ x: 400, y: 250 });
    expect(center(d, "_ot-product").y).toBe(250);
    expect(gapPx(d, "_ot-customer", "_ot-product")).toBe(60);
  });

  it("starts the row at (100, 100) when nothing is positioned", () => {
    const d = diagram(shop([{ name: "V", ...none }]), "V");
    expect(center(d, "_ot-customer")).toEqual({ x: 100, y: 100 });
    expect(gapPx(d, "_ot-customer", "_ot-order")).toBe(60);
    expect(gapPx(d, "_ot-order", "_ot-product")).toBe(60);
  });

  it("centers an unpositioned fact type between its players", () => {
    const d = diagram(
      shop([{
        name: "V",
        positions: { "ot-customer": { x: 100, y: 100 }, "ot-order": { x: 400, y: 300 } },
        orientations: {},
      }]),
      "V",
    );
    expect(center(d, "_ft-places")).toEqual({ x: 250, y: 200 });
  });

  it("moves a generated center off a taken one, so a unary does not cover its player", () => {
    const d = diagram(
      shop([{ name: "V", positions: { "ot-customer": { x: 100, y: 100 } }, orientations: {} }]),
      "V",
    );
    expect(center(d, "_ft-active")).toEqual({ x: 100, y: 140 });
  });
});

describe("NORMA export: shapes do not overlap or double up", () => {
  it("spaces long-named object types by their width, so they do not overlap", () => {
    const model = new OrmModel({ name: "Long" });
    for (const id of ["ot-a", "ot-b"]) {
      model.addObjectType({
        id,
        name: `A very long entity type name number ${id}`,
        kind: "entity",
        referenceMode: "id",
      });
    }
    model.addDiagramLayout({ name: "V", ...none });
    expect(gapPx(diagram(model, "V"), "_ot-a", "_ot-b")).toBe(60);
  });

  it("nudges a generated center that is near, not only equal to, a taken one", () => {
    // "places" would sit at the midpoint (200,100) of its players, 5 px from
    // the saved "includes" at (205,105): near, not equal, so it moves down.
    const d = diagram(
      shop([{
        name: "V",
        positions: {
          "ot-customer": { x: 100, y: 100 },
          "ot-order": { x: 300, y: 100 },
          "ft-includes": { x: 205, y: 105 },
        },
        orientations: {},
      }]),
      "V",
    );
    expect(center(d, "_ft-places")).toEqual({ x: 200, y: 140 });
  });

  it("draws an entity that only objectifies a fact type as that fact type, not twice", () => {
    const model = shop([{ name: "All", ...none }]);
    model.addObjectType({ id: "ot-sale", name: "Sale", kind: "entity", referenceMode: "sale_nr" });
    model.addObjectifiedFactType({ factTypeId: "ft-places", objectTypeId: "ot-sale" });
    const s = subjects(diagram(model, "All"));
    expect(s.objects).not.toContain("_ot-sale");
    expect(s.facts).toContain("_ft-places");
  });
});

describe("NORMA import: a diagram's shapes are its scope", () => {
  const roundTrip = (model: OrmModel) =>
    mapNormaToOrm(parseNormaXml(serializeNormaDocument(writeOrmToNorma(model))));

  it("brings a scoped view back as the same scoped view", () => {
    const back = roundTrip(shop([{ name: "V", elements: ["ot-customer", "ot-order"], ...none }]));
    const ids = ["Customer", "Order"].map((n) => back.getObjectTypeByName(n)!.id);
    expect([...(back.getDiagramLayout("V")!.elements ?? [])].sort()).toEqual(ids.sort());
  });

  it("brings a show-all view back as show-all", () => {
    const back = roundTrip(shop([{ name: "All", ...none }]));
    expect(back.getDiagramLayout("All")!.elements).toBeUndefined();
  });
});

/** Customer with an explicit reference-mode value type, as NORMA and dbt imports write it. */
function withRefMode(layout: DiagramLayout): OrmModel {
  const model = new OrmModel({ name: "RefMode" });
  model.addObjectType({
    id: "ot-customer",
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });
  model.addObjectType({ id: "vt-customer-id", name: "Customer_id", kind: "value" });
  model.addObjectType({ id: "ot-order", name: "Order", kind: "entity", referenceMode: "order_nr" });
  model.addFactType({
    id: "ft-has-id",
    name: "Customer has Customer_id",
    roles: [
      { id: "r-h1", name: "has", playerId: "ot-customer" },
      { id: "r-h2", name: "is of", playerId: "vt-customer-id" },
    ],
    readings: ["{0} has {1}"],
    constraints: [{ type: "internal_uniqueness", roleIds: ["r-h2"], isPreferred: true }],
  });
  model.addFactType({
    id: "ft-places",
    name: "Customer places Order",
    roles: [
      { id: "r-p1", name: "places", playerId: "ot-customer" },
      { id: "r-p2", name: "is placed by", playerId: "ot-order" },
    ],
    readings: ["{0} places {1}"],
  });
  model.addDiagramLayout(layout);
  return model;
}

describe("NORMA export: what the panel folds away is not drawn", () => {
  it("draws a reference-mode value type as the entity's label, not as its own shapes", () => {
    const s = subjects(diagram(withRefMode({ name: "All", ...none }), "All"));
    expect(s.objects).toEqual(["_ot-customer", "_ot-order"]);
    expect(s.facts).toEqual(["_ft-places"]);
  });

  it("keeps folding the identifying fact type when its value type stays drawn", () => {
    const model = withRefMode({ name: "All", ...none });
    // Customer_id plays another role, so the panel draws it, but the
    // identifying fact type is still shown as the "(.customer_id)" label.
    model.addFactType({
      id: "ft-legacy",
      name: "Customer_id is legacy",
      roles: [{ id: "r-l1", name: "is legacy", playerId: "vt-customer-id" }],
      readings: ["{0} is legacy"],
    });
    const s = subjects(diagram(model, "All"));
    expect(s.objects).toContain("_vt-customer-id");
    expect(s.facts).not.toContain("_ft-has-id");
  });

  it("moves a fact type whose midpoint falls inside a wide box", () => {
    const model = new OrmModel({ name: "Wide" });
    model.addObjectType({ id: "ot-a", name: "A", kind: "entity", referenceMode: "a_id" });
    model.addObjectType({
      id: "ot-wide",
      name: "An entity type with a very long name indeed",
      kind: "entity",
      referenceMode: "w_id",
    });
    model.addObjectType({ id: "ot-b", name: "B", kind: "entity", referenceMode: "b_id" });
    model.addFactType({
      id: "ft-ab",
      name: "A relates to B",
      roles: [
        { id: "r1", name: "relates to", playerId: "ot-a" },
        { id: "r2", name: "is related to by", playerId: "ot-b" },
      ],
      readings: ["{0} relates to {1}"],
    });
    // The wide box spans roughly 380..620; A and B's midpoint (400,100) is
    // inside it but about 100 px from its center, so only a box test sees it.
    model.addDiagramLayout({
      name: "V",
      positions: {
        "ot-a": { x: 100, y: 100 },
        "ot-wide": { x: 500, y: 100 },
        "ot-b": { x: 700, y: 100 },
      },
      orientations: {},
    });
    const d = diagram(model, "V");
    const wide = d.shapes.find((sh) => sh.subjectRef === "_ot-wide")!;
    const fact = d.shapes.find((sh) => sh.subjectRef === "_ft-ab")!;
    expect(fact.y).toBeGreaterThanOrEqual(wide.y + wide.height);
  });
});

describe("NORMA import: shapes that stand for something else", () => {
  const toModel = (xml: string) => mapNormaToOrm(parseNormaXml(xml));

  it("keeps an objectifying entity that plays roles, which NORMA draws only as its fact type", () => {
    const model = shop([{ name: "V", ...none }]);
    model.addObjectType({ id: "ot-sale", name: "Sale", kind: "entity", referenceMode: "sale_nr" });
    model.addObjectifiedFactType({ factTypeId: "ft-places", objectTypeId: "ot-sale" });
    model.addFactType({
      id: "ft-sale-paid",
      name: "Sale is paid",
      roles: [{ id: "r-s1", name: "is paid", playerId: "ot-sale" }],
      readings: ["{0} is paid"],
    });
    // Scope the view so the import has to decide membership from shapes.
    model.updateDiagramLayout({
      name: "V",
      elements: ["ot-customer", "ot-order", "ot-sale"],
      ...none,
    });
    const doc = writeOrmToNorma(model);
    // NORMA-authored files draw the objectification as the fact type only.
    const v = doc.diagrams!.find((d) => d.name === "V")!;
    const noSaleBox = {
      ...doc,
      diagrams: [{ ...v, shapes: v.shapes.filter((sh) => sh.subjectRef !== "_ot-sale") }],
    };
    const back = toModel(serializeNormaDocument(noSaleBox));
    expect(back.getDiagramLayout("V")!.elements).toContain(back.getObjectTypeByName("Sale")!.id);
  });

  it("lists an object type once when NORMA shows it twice", () => {
    const doc = writeOrmToNorma(
      shop([{ name: "V", elements: ["ot-customer", "ot-order"], ...none }]),
    );
    const v = doc.diagrams!.find((d) => d.name === "V")!;
    const dup = v.shapes.find((sh) => sh.subjectRef === "_ot-customer")!;
    const twice = {
      ...doc,
      diagrams: [{ ...v, shapes: [...v.shapes, { ...dup, id: `${dup.id}_2` as typeof dup.id }] }],
    };
    const elements = toModel(serializeNormaDocument(twice)).getDiagramLayout("V")!.elements!;
    expect(new Set(elements).size).toBe(elements.length);
  });

  it("treats a diagram missing only folded-away value types as show-all", () => {
    const back = toModel(
      serializeNormaDocument(writeOrmToNorma(withRefMode({ name: "All", ...none }))),
    );
    expect(back.getDiagramLayout("All")!.elements).toBeUndefined();
  });
});
