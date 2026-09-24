/**
 * Tests for diagram layout serialization and deserialization.
 *
 * Diagram layouts store element positions (keyed by element id, integer
 * pixels) and fact type orientation overrides in the .orm.yaml file. Since
 * orm_version 2.0 every key is an id; 1.x files keyed by name are migrated
 * on load (docs/specs/diagram-references-by-id.spec.md).
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

describe("DiagramLayout Serialization", () => {
  const serializer = new OrmYamlSerializer();

  describe("serialize", () => {
    it("omits diagrams section when no layouts exist", () => {
      const model = new OrmModel({ name: "Test" });
      const yaml = serializer.serialize(model);
      expect(yaml).not.toContain("diagrams:");
    });

    it("serializes a diagram layout with positions", () => {
      const model = new OrmModel({ name: "Test" });
      model.addDiagramLayout({
        name: "Default",
        positions: {
          "ot-customer": { x: 100, y: 200 },
          "ot-order": { x: 400, y: 200 },
        },
        orientations: {},
      });

      const yaml = serializer.serialize(model);
      expect(yaml).toContain("diagrams:");
      expect(yaml).toContain("name: Default");
      expect(yaml).toContain("ot-customer:");
      expect(yaml).toContain("x: 100");
      expect(yaml).toContain("y: 200");
      expect(yaml).toContain("ot-order:");
      expect(yaml).toContain("x: 400");
    });

    it("serializes orientation overrides", () => {
      const model = new OrmModel({ name: "Test" });
      model.addDiagramLayout({
        name: "Default",
        positions: {},
        orientations: {
          "ft-places": "vertical",
        },
      });

      const yaml = serializer.serialize(model);
      expect(yaml).toContain("orientations:");
      expect(yaml).toContain("ft-places: vertical");
    });

    it("rounds fractional positions to integers", () => {
      const model = new OrmModel({ name: "Test" });
      model.addDiagramLayout({
        name: "Default",
        positions: {
          "ot-customer": { x: 99.7, y: 200.3 },
        },
        orientations: {},
      });

      const yaml = serializer.serialize(model);
      expect(yaml).toContain("x: 100");
      expect(yaml).toContain("y: 200");
    });

    it("omits empty positions and orientations", () => {
      const model = new OrmModel({ name: "Test" });
      model.addDiagramLayout({
        name: "Default",
        positions: {},
        orientations: {},
      });

      const yaml = serializer.serialize(model);
      expect(yaml).toContain("name: Default");
      expect(yaml).not.toContain("positions:");
      expect(yaml).not.toContain("orientations:");
    });
  });

  describe("deserialize", () => {
    it("deserializes a diagram layout with positions and orientations", () => {
      const yaml = `
orm_version: "2.0"
model:
  name: Test
  diagrams:
    - name: Default
      positions:
        ot-customer:
          x: 100
          y: 200
        ot-order:
          x: 400
          y: 200
      orientations:
        ft-places: vertical
`;
      const model = serializer.deserialize(yaml);
      const layouts = model.diagramLayouts;
      expect(layouts).toHaveLength(1);

      const layout = layouts[0]!;
      expect(layout.name).toBe("Default");
      expect(layout.positions).toEqual({
        "ot-customer": { x: 100, y: 200 },
        "ot-order": { x: 400, y: 200 },
      });
      expect(layout.orientations).toEqual({
        "ft-places": "vertical",
      });
    });

    it("deserializes a layout with no positions or orientations", () => {
      const yaml = `
orm_version: "2.0"
model:
  name: Test
  diagrams:
    - name: Overview
`;
      const model = serializer.deserialize(yaml);
      const layout = model.getDiagramLayout("Overview");
      expect(layout).toBeDefined();
      expect(layout!.positions).toEqual({});
      expect(layout!.orientations).toEqual({});
    });
  });

  describe("round-trip", () => {
    it("preserves diagram layout through serialize/deserialize", () => {
      const model = new OrmModel({ name: "RoundTrip" });
      model.addDiagramLayout({
        name: "Default",
        positions: {
          "ot-customer": { x: 100, y: 200 },
          "ot-order": { x: 400, y: 200 },
          "ot-product": { x: 250, y: 500 },
        },
        orientations: {
          "ft-places": "vertical",
          "ft-contains": "horizontal",
        },
      });

      const yaml = serializer.serialize(model);
      const restored = serializer.deserialize(yaml);

      expect(restored.diagramLayouts).toHaveLength(1);
      const layout = restored.getDiagramLayout("Default")!;
      expect(layout.positions).toEqual({
        "ot-customer": { x: 100, y: 200 },
        "ot-order": { x: 400, y: 200 },
        "ot-product": { x: 250, y: 500 },
      });
      expect(layout.orientations).toEqual({
        "ft-places": "vertical",
        "ft-contains": "horizontal",
      });
    });

    it("preserves multiple diagram layouts", () => {
      const model = new OrmModel({ name: "MultiView" });
      model.addDiagramLayout({
        name: "Overview",
        positions: { "ot-customer": { x: 100, y: 100 } },
        orientations: {},
      });
      model.addDiagramLayout({
        name: "Detail",
        positions: { "ot-order": { x: 200, y: 300 } },
        orientations: { "ft-places": "vertical" },
      });

      const yaml = serializer.serialize(model);
      const restored = serializer.deserialize(yaml);

      expect(restored.diagramLayouts).toHaveLength(2);
      expect(restored.getDiagramLayout("Overview")).toBeDefined();
      expect(restored.getDiagramLayout("Detail")).toBeDefined();
    });
  });
});

describe("1.1 -> 2.0 migration: diagram names become ids", () => {
  const serializer = new OrmYamlSerializer();

  /** A 1.x document whose one diagram references everything by name. */
  function v1Doc(version: string, diagram: string): string {
    return `
orm_version: "${version}"
model:
  name: Shop
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: customer_id
    - id: ot-order
      name: Order
      kind: entity
      reference_mode: order_nr
  fact_types:
    - id: ft-places
      name: Customer places Order
      roles:
        - id: r-1
          player: ot-customer
          role_name: places
        - id: r-2
          player: ot-order
          role_name: is placed by
      readings:
        - "{0} places {1}"
  diagrams:
${diagram}
`;
  }

  const byName = `    - name: Sales
      elements: [Customer, Order]
      positions:
        Customer: { x: 10, y: 20 }
        Customer places Order: { x: 30, y: 40 }
      orientations:
        Customer places Order: vertical`;

  it("rewrites elements, positions and orientations from names to ids", () => {
    const layout = serializer.deserialize(v1Doc("1.1", byName)).getDiagramLayout("Sales")!;
    expect(layout.elements).toEqual(["ot-customer", "ot-order"]);
    expect(layout.positions).toEqual({
      "ot-customer": { x: 10, y: 20 },
      "ft-places": { x: 30, y: 40 },
    });
    expect(layout.orientations).toEqual({ "ft-places": "vertical" });
  });

  it("chains a 1.0 document through 1.1 to 2.0", () => {
    const model = serializer.deserialize(v1Doc("1.0", byName));
    expect(model.getDiagramLayout("Sales")!.elements).toEqual(["ot-customer", "ot-order"]);
    expect(serializer.serialize(model)).toContain('orm_version: "2.0"');
  });

  it("keeps a name that matches no element, so validation can report it", () => {
    const stale = `    - name: Sales
      elements: [Customer, Invoice]`;
    const layout = serializer.deserialize(v1Doc("1.1", stale)).getDiagramLayout("Sales")!;
    expect(layout.elements).toEqual(["ot-customer", "Invoice"]);
  });

  it("leaves a 2.0 document's ids alone, even one equal to an element name", () => {
    // In 2.0 a key is an id and nothing else; "Customer" is not an id here,
    // so it must not be quietly resolved as a name.
    const doc = v1Doc(
      "2.0",
      `    - name: Sales
      elements: [Customer, ot-order]`,
    );
    const layout = serializer.deserialize(doc).getDiagramLayout("Sales")!;
    expect(layout.elements).toEqual(["Customer", "ot-order"]);
  });

  it("survives a rename after migration: the view still holds the element", () => {
    // The failure the migration exists for: under 1.x, renaming Customer
    // dropped it from every view that listed it.
    const yaml = serializer.serialize(serializer.deserialize(v1Doc("1.1", byName)));
    const renamed = serializer.deserialize(yaml.replace("name: Customer\n", "name: Client\n"));
    expect(renamed.getObjectType("ot-customer")!.name).toBe("Client");
    const layout = renamed.getDiagramLayout("Sales")!;
    expect(layout.elements).toContain("ot-customer");
    expect(layout.positions["ot-customer"]).toEqual({ x: 10, y: 20 });
  });
});
