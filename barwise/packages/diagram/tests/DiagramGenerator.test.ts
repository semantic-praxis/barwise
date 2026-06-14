/**
 * Tests for the end-to-end diagram generator.
 *
 * generateDiagram takes an OrmModel and produces the positioned layout
 * plus the unpositioned graph, composing ModelToGraph -> ElkLayoutEngine.
 * These tests verify the structural output (node/edge counts, positions,
 * neighborhood filtering, objectification flags). SVG rendering moved to
 * @barwise/diagram-ui; its output is covered by renderDiagramSvg.test.
 */
import { describe, expect, it } from "vitest";
import { ModelBuilder } from "../../core/tests/helpers/ModelBuilder.js";
import { generateDiagram } from "../src/DiagramGenerator.js";

describe("DiagramGenerator (end-to-end)", () => {
  it("lays out a model into nodes and edges", async () => {
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

    const result = await generateDiagram(model);

    // Layout should have positioned nodes.
    expect(result.layout.nodes).toHaveLength(3);
    expect(result.layout.edges).toHaveLength(2);
    expect(result.layout.width).toBeGreaterThan(0);
    expect(result.layout.height).toBeGreaterThan(0);

    // Graph should be available.
    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toHaveLength(2);
  });

  it("generates a diagram for a model with multiple fact types", async () => {
    const model = new ModelBuilder("Complex")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withEntityType("Order", { referenceMode: "oid" })
      .withValueType("Name")
      .withValueType("Date")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
        mandatory: "role1",
      })
      .withBinaryFactType("Order placed on Date", {
        role1: { player: "Order", name: "is placed on" },
        role2: { player: "Date", name: "is date of" },
        uniqueness: "role1",
        mandatory: "role1",
      })
      .build();

    const result = await generateDiagram(model);

    expect(result.layout.nodes).toHaveLength(7); // 4 OTs + 3 FTs
    expect(result.layout.edges).toHaveLength(6); // 2 per FT

    // All nodes should have positive positions.
    for (const node of result.layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  it("handles an empty model", async () => {
    const model = new ModelBuilder("Empty").build();
    const result = await generateDiagram(model);

    expect(result.layout.nodes).toHaveLength(0);
    expect(result.layout.edges).toHaveLength(0);
  });

  it("generates a diagram with subtype relationships", async () => {
    const model = new ModelBuilder("Subtypes")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Employee", { referenceMode: "employee_id" })
      .withEntityType("Manager", { referenceMode: "manager_id" })
      .withSubtypeFact("Employee", "Person")
      .withSubtypeFact("Manager", "Employee")
      .build();

    const result = await generateDiagram(model);

    // Graph should have 3 nodes, 0 role edges, 2 subtype edges.
    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toHaveLength(0);
    expect(result.graph.subtypeEdges).toHaveLength(2);

    // Layout should position 2 subtype edges with routing points.
    expect(result.layout.subtypeEdges).toHaveLength(2);
    for (const se of result.layout.subtypeEdges) {
      expect(se.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("generates a diagram with subtypes and fact types together", async () => {
    const model = new ModelBuilder("Mixed")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Employee", { referenceMode: "employee_id" })
      .withValueType("Name")
      .withSubtypeFact("Employee", "Person")
      .withBinaryFactType("Person has Name", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
        mandatory: "role1",
      })
      .build();

    const result = await generateDiagram(model);

    // 3 OT nodes + 1 FT node = 4 nodes.
    expect(result.graph.nodes).toHaveLength(4);
    // 2 role edges + 1 subtype edge.
    expect(result.graph.edges).toHaveLength(2);
    expect(result.graph.subtypeEdges).toHaveLength(1);

    // Layout should include both edge types.
    expect(result.layout.edges).toHaveLength(2);
    expect(result.layout.subtypeEdges).toHaveLength(1);
  });

  it("generates a diagram with external uniqueness constraints", async () => {
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

    // Add external uniqueness across FirstName and LastName roles.
    const ft1 = model.getFactTypeByName("Employee has FirstName")!;
    const ft2 = model.getFactTypeByName("Employee has LastName")!;
    ft1.addConstraint({
      type: "external_uniqueness",
      roleIds: [ft1.roles[1]!.id, ft2.roles[1]!.id],
    });

    const result = await generateDiagram(model);

    // Graph: 3 OTs + 2 FTs + 1 constraint node = 6 nodes.
    expect(result.graph.nodes).toHaveLength(6);
    expect(result.graph.constraintEdges).toHaveLength(2);

    // Layout should position constraint node and edges.
    const constraintNodes = result.layout.nodes.filter(
      (n) => n.kind === "constraint",
    );
    expect(constraintNodes).toHaveLength(1);
    expect(result.layout.constraintEdges).toHaveLength(2);
  });

  it("generates a diagram with exclusion constraints", async () => {
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

    const result = await generateDiagram(model);

    // Graph: 3 OTs + 2 FTs + 1 constraint = 6 nodes.
    expect(result.graph.nodes).toHaveLength(6);
    expect(result.graph.constraintEdges).toHaveLength(2);
  });

  it("generates a diagram with objectified fact types", async () => {
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

    const result = await generateDiagram(model);

    // Graph should mark the fact type as objectified.
    const ftNode = result.graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.isObjectified).toBe(true);
      expect(ftNode.objectifiedEntityName).toBe("Enrollment");
    }

    // Layout: 2 OTs (Student, Course) + 1 FT = 3 nodes.
    // Enrollment is a pure objectified entity (no role-playing) so it is
    // represented by the fact type's objectification envelope, not a
    // separate node.
    expect(result.layout.nodes).toHaveLength(3);
    expect(result.layout.edges).toHaveLength(2);
    expect(result.layout.width).toBeGreaterThan(0);
    expect(result.layout.height).toBeGreaterThan(0);
  });

  it("generates a diagram with objectified and non-objectified fact types together", async () => {
    const model = new ModelBuilder("Mixed")
      .withEntityType("Student", { referenceMode: "student_id" })
      .withEntityType("Course", { referenceMode: "course_code" })
      .withEntityType("Enrollment", { referenceMode: "enrollment_id" })
      .withEntityType("Instructor", { referenceMode: "instructor_id" })
      .withBinaryFactType("Student enrolls in Course", {
        role1: { player: "Student", name: "enrolls in" },
        role2: { player: "Course", name: "is enrolled in by" },
      })
      .withObjectifiedFactType("Student enrolls in Course", "Enrollment")
      .withBinaryFactType("Instructor teaches Course", {
        role1: { player: "Instructor", name: "teaches" },
        role2: { player: "Course", name: "is taught by" },
        uniqueness: "role2",
      })
      .build();

    const result = await generateDiagram(model);

    // 3 OTs (Student, Course, Instructor) + 2 FTs = 5 graph nodes.
    // Enrollment is a pure objectified entity, represented by the fact
    // type envelope, not a separate node.
    expect(result.graph.nodes).toHaveLength(5);
    // 2 roles per FT = 4 edges.
    expect(result.graph.edges).toHaveLength(4);

    // Only the objectified fact type should have the objectification box.
    const ftNodes = result.graph.nodes.filter((n) => n.kind === "fact_type");
    expect(ftNodes).toHaveLength(2);

    const objectifiedFt = ftNodes.find(
      (n) => n.kind === "fact_type" && n.isObjectified,
    );
    expect(objectifiedFt).toBeDefined();
    if (objectifiedFt?.kind === "fact_type") {
      expect(objectifiedFt.name).toBe("Student enrolls in Course");
    }

    const normalFt = ftNodes.find(
      (n) => n.kind === "fact_type" && !n.isObjectified,
    );
    expect(normalFt).toBeDefined();
    if (normalFt?.kind === "fact_type") {
      expect(normalFt.name).toBe("Instructor teaches Course");
    }
  });

  describe("focus / neighborhood filtering", () => {
    function chainModel() {
      // A relates to B relates to C (3 entities, 2 binary fact types).
      return new ModelBuilder("Chain")
        .withEntityType("A", { referenceMode: "id" })
        .withEntityType("B", { referenceMode: "id" })
        .withEntityType("C", { referenceMode: "id" })
        .withBinaryFactType("A relates to B", {
          role1: { player: "A", name: "relates to" },
          role2: { player: "B", name: "is related to by" },
        })
        .withBinaryFactType("B relates to C", {
          role1: { player: "B", name: "relates to" },
          role2: { player: "C", name: "is related to by" },
        })
        .build();
    }

    it("filters to the focus entity's neighborhood when focusEntityId is set", async () => {
      const model = chainModel();
      const aId = model.getObjectTypeByName("A")!.id;

      const result = await generateDiagram(model, { focusEntityId: aId, hopCount: 1 });

      // Unfiltered the chain has 5 nodes (3 OTs + 2 FTs); one hop from A
      // keeps A, B, and the A-B fact type -- C and B-C are excluded.
      expect(result.graph.nodes).toHaveLength(3);
      expect(result.graph.nodes.filter((n) => n.kind === "object_type")).toHaveLength(2);
      expect(result.graph.nodes.filter((n) => n.kind === "fact_type")).toHaveLength(1);
    });

    it("defaults to one hop when hopCount is omitted", async () => {
      const model = chainModel();
      const aId = model.getObjectTypeByName("A")!.id;

      const result = await generateDiagram(model, { focusEntityId: aId });

      // Same neighborhood as an explicit hopCount of 1.
      expect(result.graph.nodes).toHaveLength(3);
    });

    it("does not filter when no focus entity is given", async () => {
      const model = chainModel();

      const result = await generateDiagram(model);

      expect(result.graph.nodes).toHaveLength(5);
    });
  });
});
