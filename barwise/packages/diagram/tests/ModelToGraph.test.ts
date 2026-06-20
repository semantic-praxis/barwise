/**
 * Tests for ModelToGraph, which converts an OrmModel into an OrmGraph
 * (an intermediate representation suitable for layout engines).
 *
 * The graph has two node kinds (object_type and fact_type) connected
 * by edges (one per role). Each fact_type node carries metadata about
 * its roles (uniqueness, mandatory). These tests verify:
 *   - Correct node and edge counts
 *   - Entity vs value type annotation on object_type nodes
 *   - Uniqueness and mandatory flags on role metadata
 *   - Spanning uniqueness detection
 *   - Empty models produce empty graphs
 */
import { describe, expect, it } from "vitest";
import { ModelBuilder } from "../../core/tests/helpers/ModelBuilder.js";
import { modelToGraph } from "../src/graph/ModelToGraph.js";

describe("ModelToGraph", () => {
  it("converts a simple model to graph nodes and edges", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .build();

    const graph = modelToGraph(model);

    // 2 object types + 1 fact type = 3 nodes.
    expect(graph.nodes).toHaveLength(3);

    const otNodes = graph.nodes.filter((n) => n.kind === "object_type");
    expect(otNodes).toHaveLength(2);

    const ftNodes = graph.nodes.filter((n) => n.kind === "fact_type");
    expect(ftNodes).toHaveLength(1);

    // 2 roles = 2 edges.
    expect(graph.edges).toHaveLength(2);
  });

  it("marks entity and value types correctly", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("Name")
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
        mandatory: "role1",
      })
      .build();

    const graph = modelToGraph(model);
    const otNodes = graph.nodes.filter((n) => n.kind === "object_type");

    const customerNode = otNodes.find(
      (n) => n.kind === "object_type" && n.name === "Customer",
    );
    expect(customerNode).toBeDefined();
    if (customerNode?.kind === "object_type") {
      expect(customerNode.objectTypeKind).toBe("entity");
      expect(customerNode.referenceMode).toBe("customer_id");
    }

    const nameNode = otNodes.find(
      (n) => n.kind === "object_type" && n.name === "Name",
    );
    expect(nameNode).toBeDefined();
    if (nameNode?.kind === "object_type") {
      expect(nameNode.objectTypeKind).toBe("value");
      expect(nameNode.referenceMode).toBeUndefined();
    }
  });

  it("detects single-role uniqueness on role boxes", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withEntityType("Order", { referenceMode: "oid" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
      })
      .build();

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      // role1 (Customer places) has no uniqueness.
      expect(ftNode.roles[0]?.hasUniqueness).toBe(false);
      // role2 (Order is placed by) has uniqueness.
      expect(ftNode.roles[1]?.hasUniqueness).toBe(true);
    }
  });

  it("detects mandatory roles", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withEntityType("Order", { referenceMode: "oid" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .build();

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.roles[0]?.isMandatory).toBe(false);
      expect(ftNode.roles[1]?.isMandatory).toBe(true);
    }
  });

  it("detects spanning uniqueness", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withEntityType("Product", { referenceMode: "pid" })
      .withBinaryFactType("Customer reviews Product", {
        role1: { player: "Customer", name: "reviews" },
        role2: { player: "Product", name: "is reviewed by" },
        uniqueness: "spanning",
      })
      .build();

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.hasSpanningUniqueness).toBe(true);
      expect(ftNode.roles[0]?.hasUniqueness).toBe(false);
      expect(ftNode.roles[1]?.hasUniqueness).toBe(false);
    }
  });

  it("handles models with multiple fact types", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withEntityType("Order", { referenceMode: "oid" })
      .withValueType("Name")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
      })
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
      })
      .build();

    const graph = modelToGraph(model);
    expect(graph.nodes).toHaveLength(5); // 3 OTs + 2 FTs
    expect(graph.edges).toHaveLength(4); // 2 roles per FT

    // Customer should have 2 edges (one per fact type).
    const customerOt = model.getObjectTypeByName("Customer")!;
    const customerEdges = graph.edges.filter(
      (e) => e.sourceNodeId === customerOt.id,
    );
    expect(customerEdges).toHaveLength(2);
  });

  it("creates an empty graph for an empty model", () => {
    const model = new ModelBuilder("Empty").build();
    const graph = modelToGraph(model);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.subtypeEdges).toHaveLength(0);
  });

  it("creates subtype edges from SubtypeFacts", () => {
    const model = new ModelBuilder("Subtypes")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Employee", { referenceMode: "employee_id" })
      .withSubtypeFact("Employee", "Person")
      .build();

    const graph = modelToGraph(model);

    // 2 object type nodes, no fact types.
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(0);

    // 1 subtype edge.
    expect(graph.subtypeEdges).toHaveLength(1);

    const se = graph.subtypeEdges[0]!;
    const employee = model.getObjectTypeByName("Employee")!;
    const person = model.getObjectTypeByName("Person")!;
    expect(se.subtypeNodeId).toBe(employee.id);
    expect(se.supertypeNodeId).toBe(person.id);
    expect(se.providesIdentification).toBe(true);
  });

  it("creates subtype edges with providesIdentification false", () => {
    const model = new ModelBuilder("Subtypes")
      .withEntityType("Animal", { referenceMode: "animal_id" })
      .withEntityType("Pet", { referenceMode: "pet_id" })
      .withSubtypeFact("Pet", "Animal", { providesIdentification: false })
      .build();

    const graph = modelToGraph(model);
    expect(graph.subtypeEdges).toHaveLength(1);
    expect(graph.subtypeEdges[0]!.providesIdentification).toBe(false);
  });

  it("creates constraint nodes and edges for external uniqueness", () => {
    const model = new ModelBuilder("ExtUniq")
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

    // Add an external uniqueness across the two "name" roles.
    const ft1 = model.getFactTypeByName("Employee has FirstName")!;
    const ft2 = model.getFactTypeByName("Employee has LastName")!;
    const fnameRoleId = ft1.roles[1]!.id; // FirstName role
    const lnameRoleId = ft2.roles[1]!.id; // LastName role
    ft1.addConstraint({
      type: "external_uniqueness",
      roleIds: [fnameRoleId, lnameRoleId],
    });

    const graph = modelToGraph(model);

    // Should have a constraint node.
    const constraintNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(constraintNodes).toHaveLength(1);

    const cNode = constraintNodes[0]!;
    expect(cNode.kind).toBe("constraint");
    if (cNode.kind === "constraint") {
      expect(cNode.constraintKind).toBe("external_uniqueness");
      expect(cNode.roleIds).toEqual([fnameRoleId, lnameRoleId]);
    }

    // Should have 2 constraint edges (one per covered role).
    expect(graph.constraintEdges).toHaveLength(2);

    const ce1 = graph.constraintEdges.find((e) => e.roleId === fnameRoleId);
    expect(ce1).toBeDefined();
    expect(ce1!.constraintNodeId).toBe(cNode.id);
    expect(ce1!.factTypeNodeId).toBe(ft1.id);

    const ce2 = graph.constraintEdges.find((e) => e.roleId === lnameRoleId);
    expect(ce2).toBeDefined();
    expect(ce2!.constraintNodeId).toBe(cNode.id);
    expect(ce2!.factTypeNodeId).toBe(ft2.id);
  });

  it("produces empty constraintEdges when no external uniqueness exists", () => {
    const model = new ModelBuilder("NoExtUniq")
      .withEntityType("Customer", { referenceMode: "cid" })
      .withEntityType("Order", { referenceMode: "oid" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
      })
      .build();

    const graph = modelToGraph(model);
    expect(graph.constraintEdges).toHaveLength(0);

    const constraintNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(constraintNodes).toHaveLength(0);
  });

  it("skips constraint edges for roles not found in any fact type", () => {
    const model = new ModelBuilder("Orphan")
      .withEntityType("A", { referenceMode: "a_id" })
      .withValueType("B")
      .withBinaryFactType("A has B", {
        role1: { player: "A", name: "has" },
        role2: { player: "B", name: "is of" },
      })
      .build();

    // Add an external uniqueness referencing a non-existent role.
    const ft = model.getFactTypeByName("A has B")!;
    const realRoleId = ft.roles[0]!.id;
    ft.addConstraint({
      type: "external_uniqueness",
      roleIds: [realRoleId, "non-existent-role"],
    });

    const graph = modelToGraph(model);

    // Constraint node still created.
    const constraintNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(constraintNodes).toHaveLength(1);

    // Only 1 constraint edge (for the real role), not 2.
    expect(graph.constraintEdges).toHaveLength(1);
    expect(graph.constraintEdges[0]!.roleId).toBe(realRoleId);
  });

  it("creates exclusion constraint nodes and edges", () => {
    const model = new ModelBuilder("Exclusion")
      .withEntityType("Person", { referenceMode: "pid" })
      .withValueType("DriverLicNr")
      .withValueType("PassportNr")
      .withBinaryFactType("Person has DriverLicNr", {
        role1: { player: "Person", name: "has" },
        role2: { player: "DriverLicNr", name: "is of" },
      })
      .withBinaryFactType("Person has PassportNr", {
        role1: { player: "Person", name: "has" },
        role2: { player: "PassportNr", name: "is of" },
      })
      .build();

    const ft1 = model.getFactTypeByName("Person has DriverLicNr")!;
    const ft2 = model.getFactTypeByName("Person has PassportNr")!;
    ft1.addConstraint({
      type: "exclusion",
      roleIds: [ft1.roles[1]!.id, ft2.roles[1]!.id],
    });

    const graph = modelToGraph(model);

    const cNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(cNodes).toHaveLength(1);
    if (cNodes[0]!.kind === "constraint") {
      expect(cNodes[0]!.constraintKind).toBe("exclusion");
      expect(cNodes[0]!.roleIds).toHaveLength(2);
    }
    expect(graph.constraintEdges).toHaveLength(2);
  });

  it("creates exclusive-or constraint nodes", () => {
    const model = new ModelBuilder("ExclusiveOr")
      .withEntityType("Person", { referenceMode: "pid" })
      .withValueType("Male")
      .withValueType("Female")
      .withBinaryFactType("Person is Male", {
        role1: { player: "Person", name: "is" },
        role2: { player: "Male", name: "of" },
      })
      .withBinaryFactType("Person is Female", {
        role1: { player: "Person", name: "is" },
        role2: { player: "Female", name: "of" },
      })
      .build();

    const ft1 = model.getFactTypeByName("Person is Male")!;
    const ft2 = model.getFactTypeByName("Person is Female")!;
    ft1.addConstraint({
      type: "exclusive_or",
      roleIds: [ft1.roles[0]!.id, ft2.roles[0]!.id],
    });

    const graph = modelToGraph(model);
    const cNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(cNodes).toHaveLength(1);
    if (cNodes[0]!.kind === "constraint") {
      expect(cNodes[0]!.constraintKind).toBe("exclusive_or");
    }
    expect(graph.constraintEdges).toHaveLength(2);
  });

  it("creates disjunctive mandatory constraint nodes", () => {
    const model = new ModelBuilder("DisjMand")
      .withEntityType("Person", { referenceMode: "pid" })
      .withValueType("Phone")
      .withValueType("Email")
      .withBinaryFactType("Person has Phone", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Phone", name: "is of" },
      })
      .withBinaryFactType("Person has Email", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Email", name: "is of" },
      })
      .build();

    const ft1 = model.getFactTypeByName("Person has Phone")!;
    const ft2 = model.getFactTypeByName("Person has Email")!;
    ft1.addConstraint({
      type: "disjunctive_mandatory",
      roleIds: [ft1.roles[0]!.id, ft2.roles[0]!.id],
    });

    const graph = modelToGraph(model);
    const cNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(cNodes).toHaveLength(1);
    if (cNodes[0]!.kind === "constraint") {
      expect(cNodes[0]!.constraintKind).toBe("disjunctive_mandatory");
    }
    expect(graph.constraintEdges).toHaveLength(2);
  });

  it("creates subset constraint nodes with superset role ids", () => {
    const model = new ModelBuilder("Subset")
      .withEntityType("Person", { referenceMode: "pid" })
      .withEntityType("Team", { referenceMode: "tid" })
      .withBinaryFactType("Person leads Team", {
        role1: { player: "Person", name: "leads" },
        role2: { player: "Team", name: "is led by" },
      })
      .withBinaryFactType("Person belongs to Team", {
        role1: { player: "Person", name: "belongs to" },
        role2: { player: "Team", name: "has member" },
      })
      .build();

    const ft1 = model.getFactTypeByName("Person leads Team")!;
    const ft2 = model.getFactTypeByName("Person belongs to Team")!;
    ft1.addConstraint({
      type: "subset",
      subsetRoleIds: [ft1.roles[0]!.id],
      supersetRoleIds: [ft2.roles[0]!.id],
    });

    const graph = modelToGraph(model);
    const cNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(cNodes).toHaveLength(1);
    if (cNodes[0]!.kind === "constraint") {
      expect(cNodes[0]!.constraintKind).toBe("subset");
      expect(cNodes[0]!.roleIds).toEqual([ft1.roles[0]!.id]);
      expect(cNodes[0]!.supersetRoleIds).toEqual([ft2.roles[0]!.id]);
    }
    // Edges for both subset and superset roles.
    expect(graph.constraintEdges).toHaveLength(2);
  });

  it("creates equality constraint nodes with two role sets", () => {
    const model = new ModelBuilder("Equality")
      .withEntityType("Person", { referenceMode: "pid" })
      .withEntityType("Spouse", { referenceMode: "sid" })
      .withBinaryFactType("Person is married to Spouse", {
        role1: { player: "Person", name: "is married to" },
        role2: { player: "Spouse", name: "is married to" },
      })
      .withBinaryFactType("Spouse is married to Person", {
        role1: { player: "Spouse", name: "is married to" },
        role2: { player: "Person", name: "is married to" },
      })
      .build();

    const ft1 = model.getFactTypeByName("Person is married to Spouse")!;
    const ft2 = model.getFactTypeByName("Spouse is married to Person")!;
    ft1.addConstraint({
      type: "equality",
      roleIds1: [ft1.roles[0]!.id],
      roleIds2: [ft2.roles[0]!.id],
    });

    const graph = modelToGraph(model);
    const cNodes = graph.nodes.filter((n) => n.kind === "constraint");
    expect(cNodes).toHaveLength(1);
    if (cNodes[0]!.kind === "constraint") {
      expect(cNodes[0]!.constraintKind).toBe("equality");
    }
    expect(graph.constraintEdges).toHaveLength(2);
  });

  it("extracts frequency constraints on role boxes", () => {
    const model = new ModelBuilder("Frequency")
      .withEntityType("Person", { referenceMode: "pid" })
      .withEntityType("Car", { referenceMode: "vin" })
      .withBinaryFactType("Person owns Car", {
        role1: { player: "Person", name: "owns" },
        role2: { player: "Car", name: "is owned by" },
        uniqueness: "role2",
      })
      .build();

    const ft = model.getFactTypeByName("Person owns Car")!;
    ft.addConstraint({
      type: "frequency",
      roleIds: [ft.roles[0]!.id],
      min: 1,
      max: 3,
    });

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.roles[0]!.frequencyMin).toBe(1);
      expect(ftNode.roles[0]!.frequencyMax).toBe(3);
      // Second role has no frequency constraint.
      expect(ftNode.roles[1]!.frequencyMin).toBeUndefined();
    }
  });

  it("extracts unbounded frequency constraints", () => {
    const model = new ModelBuilder("FreqUnbounded")
      .withEntityType("Person", { referenceMode: "pid" })
      .withEntityType("Car", { referenceMode: "vin" })
      .withBinaryFactType("Person owns Car", {
        role1: { player: "Person", name: "owns" },
        role2: { player: "Car", name: "is owned by" },
        uniqueness: "role2",
      })
      .build();

    const ft = model.getFactTypeByName("Person owns Car")!;
    ft.addConstraint({
      type: "frequency",
      roleIds: [ft.roles[0]!.id],
      min: 2,
      max: "unbounded",
    });

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.roles[0]!.frequencyMin).toBe(2);
      expect(ftNode.roles[0]!.frequencyMax).toBe("unbounded");
    }
  });

  it("extracts ring constraints on fact types", () => {
    const model = new ModelBuilder("Ring")
      .withEntityType("Person", { referenceMode: "pid" })
      .withBinaryFactType("Person is parent of Person", {
        role1: { player: "Person", name: "is parent of" },
        role2: { player: "Person", name: "is child of" },
      })
      .build();

    const ft = model.getFactTypeByName("Person is parent of Person")!;
    ft.addConstraint({
      type: "ring",
      roleId1: ft.roles[0]!.id,
      roleId2: ft.roles[1]!.id,
      ringType: "irreflexive",
    });

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.ringConstraint).toBeDefined();
      expect(ftNode.ringConstraint!.label).toBe("ir");
      expect(ftNode.ringConstraint!.roleId1).toBe(ft.roles[0]!.id);
      expect(ftNode.ringConstraint!.roleId2).toBe(ft.roles[1]!.id);
    }
  });

  it("maps all ring types to correct abbreviations", () => {
    const ringTypes = [
      { type: "irreflexive" as const, label: "ir" },
      { type: "asymmetric" as const, label: "as" },
      { type: "antisymmetric" as const, label: "ans" },
      { type: "intransitive" as const, label: "it" },
      { type: "acyclic" as const, label: "ac" },
      { type: "symmetric" as const, label: "sym" },
      { type: "transitive" as const, label: "tr" },
      { type: "purely_reflexive" as const, label: "pr" },
    ];

    for (const { type, label } of ringTypes) {
      const model = new ModelBuilder(`Ring-${type}`)
        .withEntityType("A", { referenceMode: "aid" })
        .withBinaryFactType("A relates A", {
          role1: { player: "A", name: "relates" },
          role2: { player: "A", name: "is related by" },
        })
        .build();

      const ft = model.getFactTypeByName("A relates A")!;
      ft.addConstraint({
        type: "ring",
        roleId1: ft.roles[0]!.id,
        roleId2: ft.roles[1]!.id,
        ringType: type,
      });

      const graph = modelToGraph(model);
      const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
      if (ftNode?.kind === "fact_type") {
        expect(ftNode.ringConstraint?.label).toBe(label);
      }
    }
  });

  it("creates multiple subtype edges for a type hierarchy", () => {
    const model = new ModelBuilder("Hierarchy")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Employee", { referenceMode: "employee_id" })
      .withEntityType("Manager", { referenceMode: "manager_id" })
      .withSubtypeFact("Employee", "Person")
      .withSubtypeFact("Manager", "Employee")
      .build();

    const graph = modelToGraph(model);

    // 3 object type nodes, 2 subtype edges.
    expect(graph.nodes).toHaveLength(3);
    expect(graph.subtypeEdges).toHaveLength(2);

    const employee = model.getObjectTypeByName("Employee")!;
    const person = model.getObjectTypeByName("Person")!;
    const manager = model.getObjectTypeByName("Manager")!;

    // Employee -> Person.
    const empToPerson = graph.subtypeEdges.find(
      (e) => e.subtypeNodeId === employee.id,
    );
    expect(empToPerson).toBeDefined();
    expect(empToPerson!.supertypeNodeId).toBe(person.id);

    // Manager -> Employee.
    const mgrToEmp = graph.subtypeEdges.find(
      (e) => e.subtypeNodeId === manager.id,
    );
    expect(mgrToEmp).toBeDefined();
    expect(mgrToEmp!.supertypeNodeId).toBe(employee.id);
  });

  it("marks objectified fact types with isObjectified and entity name", () => {
    const model = new ModelBuilder("Objectification")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Marriage", { referenceMode: "marriage_id" })
      .withBinaryFactType("Person marries Person", {
        role1: { player: "Person", name: "marries" },
        role2: { player: "Person", name: "is married to" },
      })
      .withObjectifiedFactType("Person marries Person", "Marriage")
      .build();

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.isObjectified).toBe(true);
      expect(ftNode.objectifiedEntityName).toBe("Marriage");
    }
  });

  it("includes aliases on object type nodes when present", () => {
    const model = new ModelBuilder("Aliases")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client", "Buyer"],
      })
      .build();

    const graph = modelToGraph(model);
    const otNode = graph.nodes.find(
      (n) => n.kind === "object_type" && n.name === "Customer",
    );
    expect(otNode).toBeDefined();
    if (otNode?.kind === "object_type") {
      expect(otNode.aliases).toEqual(["Client", "Buyer"]);
    }
  });

  it("omits aliases on object type nodes when not set", () => {
    const model = new ModelBuilder("NoAliases")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const graph = modelToGraph(model);
    const otNode = graph.nodes.find(
      (n) => n.kind === "object_type" && n.name === "Customer",
    );
    expect(otNode).toBeDefined();
    if (otNode?.kind === "object_type") {
      expect(otNode.aliases).toBeUndefined();
    }
  });

  it("does not mark non-objectified fact types", () => {
    const model = new ModelBuilder("Regular")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Order", { referenceMode: "order_id" })
      .withBinaryFactType("Person places Order", {
        role1: { player: "Person", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const graph = modelToGraph(model);
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    expect(ftNode).toBeDefined();
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.isObjectified).toBe(false);
      expect(ftNode.objectifiedEntityName).toBeUndefined();
    }
  });

  it("populates annotations on object type nodes from options map", () => {
    const model = new ModelBuilder("Annotations")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const customer = model.getObjectTypeByName("Customer")!;
    const annotations = new Map<string, readonly string[]>([
      [customer.id, ["No model description", "Missing definition"]],
    ]);

    const graph = modelToGraph(model, { annotations });
    const otNode = graph.nodes.find(
      (n) => n.kind === "object_type" && n.name === "Customer",
    );
    expect(otNode).toBeDefined();
    if (otNode?.kind === "object_type") {
      expect(otNode.annotations).toEqual([
        "No model description",
        "Missing definition",
      ]);
    }
  });

  it("populates annotations on fact type nodes from options map", () => {
    const model = new ModelBuilder("Annotations")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const ft = model.getFactTypeByName("Customer places Order")!;
    const annotations = new Map<string, readonly string[]>([
      [ft.id, ["Review constraint coverage"]],
    ]);

    const graph = modelToGraph(model, { annotations });
    const ftNode = graph.nodes.find((n) => n.kind === "fact_type");
    if (ftNode?.kind === "fact_type") {
      expect(ftNode.annotations).toEqual(["Review constraint coverage"]);
    }
  });

  it("omits annotations when options map does not contain the element", () => {
    const model = new ModelBuilder("NoAnnotations")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const graph = modelToGraph(model, { annotations: new Map() });
    const otNode = graph.nodes.find(
      (n) => n.kind === "object_type" && n.name === "Customer",
    );
    if (otNode?.kind === "object_type") {
      expect(otNode.annotations).toBeUndefined();
    }
  });
});
