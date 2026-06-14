/**
 * Tests for the headless static SVG renderer.
 *
 * These port the SVG-output assertions that lived in @barwise/diagram's
 * DiagramGenerator/SvgRenderer tests before the renderer moved here: they
 * are the parity guard for the one renderer the CLI and MCP use. The
 * structural (layout / graph) assertions stay in @barwise/diagram.
 */
import { generateDiagram } from "@barwise/diagram";
import { describe, expect, it } from "vitest";
import { ModelBuilder } from "../../core/tests/helpers/ModelBuilder.js";
import { renderDiagramSvg } from "../src/renderDiagramSvg.js";

type DiagramModel = Parameters<typeof generateDiagram>[0];

/** Lay out a model and render it to a static SVG string. */
async function svg(model: DiagramModel): Promise<string> {
  const { layout } = await generateDiagram(model);
  return renderDiagramSvg(layout);
}

describe("renderDiagramSvg", () => {
  it("produces a complete SVG document with object and fact type names", async () => {
    const model = new ModelBuilder("Order Management")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .build();

    const out = await svg(model);

    expect(out).toContain("<svg");
    expect(out).toContain("</svg>");
    expect(out).toContain("Customer");
    expect(out).toContain("Order");
    expect(out).toContain("Customer places Order");
  });

  it("renders value types as ellipses", async () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withValueType("Name")
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
        mandatory: "role1",
      })
      .build();

    const out = await svg(model);

    expect(out).toContain("<ellipse");
    expect(out).toContain("Name");
  });

  it("renders an empty model as a valid SVG", async () => {
    const out = await svg(new ModelBuilder("Empty").build());
    expect(out).toContain("<svg");
    expect(out).toContain("</svg>");
  });

  it("renders subtype arrows", async () => {
    const model = new ModelBuilder("Subtypes")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Employee", { referenceMode: "employee_id" })
      .withSubtypeFact("Employee", "Person")
      .build();

    const out = await svg(model);

    expect(out).toContain("subtype-arrow");
    expect(out).toContain('data-kind="subtype"');
  });

  it("renders external uniqueness constraint markers", async () => {
    const model = new ModelBuilder("External Uniqueness")
      .withEntityType("Employee", { referenceMode: "emp_id" })
      .withValueType("FirstName")
      .withValueType("LastName")
      .withBinaryFactType("Employee has FirstName", {
        role1: { player: "Employee", name: "has" },
        role2: { player: "FirstName", name: "is of" },
      })
      .withBinaryFactType("Employee has LastName", {
        role1: { player: "Employee", name: "has" },
        role2: { player: "LastName", name: "is of" },
      })
      .build();
    const ft1 = model.getFactTypeByName("Employee has FirstName")!;
    const ft2 = model.getFactTypeByName("Employee has LastName")!;
    ft1.addConstraint({
      type: "external_uniqueness",
      roleIds: [ft1.roles[1]!.id, ft2.roles[1]!.id],
    });

    const out = await svg(model);

    expect(out).toContain('data-kind="constraint"');
    expect(out).toContain('data-kind="constraint-edge"');
    expect(out).toContain('stroke-dasharray="4,3"');
  });

  it("renders exclusion constraint markers", async () => {
    const model = new ModelBuilder("Exclusion")
      .withEntityType("Person", { referenceMode: "pid" })
      .withValueType("DriverLic")
      .withValueType("Passport")
      .withBinaryFactType("Person has DriverLic", {
        role1: { player: "Person", name: "has" },
        role2: { player: "DriverLic", name: "is of" },
      })
      .withBinaryFactType("Person has Passport", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Passport", name: "is of" },
      })
      .build();
    const ft1 = model.getFactTypeByName("Person has DriverLic")!;
    const ft2 = model.getFactTypeByName("Person has Passport")!;
    ft1.addConstraint({
      type: "exclusion",
      roleIds: [ft1.roles[1]!.id, ft2.roles[1]!.id],
    });

    const out = await svg(model);

    expect(out).toContain('data-constraint-kind="exclusion"');
  });

  it("renders uniqueness bars and mandatory dots", async () => {
    const model = new ModelBuilder("Constraints")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withEntityType("Order", { referenceMode: "oid" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "both",
        mandatory: "both",
      })
      .build();

    const out = await svg(model);

    expect((out.match(/#3a86c8/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((out.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("renders frequency and ring constraint labels", async () => {
    const model = new ModelBuilder("FreqRing")
      .withEntityType("Person", { referenceMode: "pid" })
      .withBinaryFactType("Person is parent of Person", {
        role1: { player: "Person", name: "is parent of" },
        role2: { player: "Person", name: "is child of" },
      })
      .build();
    const ft = model.getFactTypeByName("Person is parent of Person")!;
    ft.addConstraint({ type: "frequency", roleId: ft.roles[0]!.id, min: 0, max: 2 });
    ft.addConstraint({
      type: "ring",
      roleId1: ft.roles[0]!.id,
      roleId2: ft.roles[1]!.id,
      ringType: "irreflexive",
    });

    const out = await svg(model);

    expect(out).toContain("0..2");
    expect(out).toContain("ir");
  });

  it("renders the objectification box for objectified fact types", async () => {
    const model = new ModelBuilder("Enrollment")
      .withEntityType("Student", { referenceMode: "student_id" })
      .withEntityType("Course", { referenceMode: "course_code" })
      .withEntityType("Enrollment", { referenceMode: "enrollment_id" })
      .withBinaryFactType("Student enrolls in Course", {
        role1: { player: "Student", name: "enrolls in" },
        role2: { player: "Course", name: "is enrolled in by" },
      })
      .withObjectifiedFactType("Student enrolls in Course", "Enrollment")
      .build();

    const out = await svg(model);

    expect(out).toContain('data-kind="objectification"');
    expect(out).toContain("Enrollment");
    expect(out).toContain('stroke="#3a86c8"');
  });

  it("marks nodes listed in ghostNodeIds as ghosts", async () => {
    const model = new ModelBuilder("Ghosts")
      .withEntityType("A", { referenceMode: "id" })
      .withEntityType("B", { referenceMode: "id" })
      .withBinaryFactType("A relates to B", {
        role1: { player: "A", name: "relates to" },
        role2: { player: "B", name: "is related to by" },
      })
      .build();
    const bId = model.getObjectTypeByName("B")!.id;

    const { layout } = await generateDiagram(model);
    const out = renderDiagramSvg(layout, { ghostNodeIds: new Set([bId]) });

    expect(out).toContain('data-ghost="true"');
    expect(out).toContain(`data-id="${bId}"`);
  });
});
