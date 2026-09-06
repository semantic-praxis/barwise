/**
 * Tests for population rendering utilities.
 */

import { describe, expect, it } from "vitest";
import {
  renderPopulationAsOpenApiExamples,
  renderPopulationAsSql,
} from "../../src/export/populationRenderer.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import type { RelationalSchema } from "../../src/mapping/RelationalSchema.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("renderPopulationAsSql", () => {
  it("should render SQL INSERT statements for a populated model", () => {
    // Use a many-to-many relationship that creates a separate table (not absorbed)
    const model = new ModelBuilder("TestModel")
      .withEntityType("Student", { referenceMode: "student_id" })
      .withEntityType("Course", { referenceMode: "course_id" })
      .withValueType("StudentId", { dataType: { name: "text", length: 10 } })
      .withValueType("CourseId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Student has StudentId", {
        role1: { player: "Student", name: "has" },
        role2: { player: "StudentId", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Course has CourseId", {
        role1: { player: "Course", name: "has" },
        role2: { player: "CourseId", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Student enrolls in Course", {
        role1: { player: "Student", name: "enrolls in" },
        role2: { player: "Course", name: "has enrolled" },
      })
      .build();

    // Get the enrollment fact type to add population
    const ft = model.getFactTypeByName("Student enrolls in Course");
    if (!ft) throw new Error("Fact type not found");

    // Add population for many-to-many relationship
    const pop = model.addPopulation({
      factTypeId: ft.id,
      description: "Sample enrollments",
    });
    pop.addInstance({
      roleValues: {
        [ft.roles[0]!.id]: "S001",
        [ft.roles[1]!.id]: "CS101",
      },
    });
    pop.addInstance({
      roleValues: {
        [ft.roles[0]!.id]: "S002",
        [ft.roles[1]!.id]: "CS101",
      },
    });

    // Map to relational schema
    const mapper = new RelationalMapper();
    const schema = mapper.map(model);

    // Render
    const sql = renderPopulationAsSql(model, schema);

    expect(sql).toContain("-- Sample data from populations");
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("S001");
    expect(sql).toContain("CS101");
  });

  it("should return empty string when model has no populations", () => {
    const model = new ModelBuilder("EmptyModel")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
      })
      .build();

    const mapper = new RelationalMapper();
    const schema = mapper.map(model);

    const sql = renderPopulationAsSql(model, schema);

    expect(sql).toBe("");
  });

  it("should handle binary fact types", () => {
    const model = new ModelBuilder("OrderModel")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withValueType("OrderNumber", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Order has OrderNumber", {
        role1: { player: "Order", name: "has" },
        role2: { player: "OrderNumber", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    // Add population for relationship
    const placesFt = model.getFactTypeByName("Customer places Order");
    if (!placesFt) throw new Error("Fact type not found");

    const pop = model.addPopulation({
      factTypeId: placesFt.id,
      description: "Sample orders",
    });
    pop.addInstance({
      roleValues: {
        [placesFt.roles[0]!.id]: "C001",
        [placesFt.roles[1]!.id]: "O123",
      },
    });

    const mapper = new RelationalMapper();
    const schema = mapper.map(model);

    const sql = renderPopulationAsSql(model, schema);

    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("C001");
    expect(sql).toContain("O123");
  });

  it("skips a population whose fact type is not in the model", () => {
    // addPopulation validates the fact type exists at creation time, so
    // the only way a population outlives its fact type is removal after
    // the fact -- removeFactType does not cascade to populations.
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const ft = model.getFactTypeByName("Customer places Order")!;
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({
      roleValues: { [ft.roles[0]!.id]: "C001", [ft.roles[1]!.id]: "O123" },
    });

    const mapper = new RelationalMapper();
    const schema = mapper.map(model);
    model.removeFactType(ft.id);

    expect(renderPopulationAsSql(model, schema)).toBe("");
  });

  it("returns an empty string when the fact type maps to no table (absorbed into a column)", () => {
    // "Customer has CustomerId" maps into a column on the customer table,
    // not its own table, so no table's sourceElementId matches this fact
    // type -- the population is silently dropped.
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
        uniqueness: "role1",
      })
      .build();
    const ft = model.getFactTypeByName("Customer has CustomerId")!;
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({ roleValues: { [ft.roles[0]!.id]: "C001", [ft.roles[1]!.id]: "C001" } });

    const mapper = new RelationalMapper();
    const schema = mapper.map(model);

    expect(renderPopulationAsSql(model, schema)).toBe("");
  });

  it("skips instances that map to no column, and quotes an identifier that needs it", () => {
    // A hand-authored schema: renderPopulationAsSql's contract is any
    // RelationalSchema, not only mapper output. This exercises the
    // column-without-traceability skip, a fully-unmapped instance
    // (which contributes no INSERT), and quoteIdent's special-character
    // path -- none of which RelationalMapper's own output produces.
    const model = new OrmModel({ name: "Test" });
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const ft = model.addFactType({
      name: "Customer has Nickname",
      roles: [{ id: "r1", name: "has", playerId: customer.id }],
      readings: ["{0} has a nickname"],
    });
    const pop = model.addPopulation({ factTypeId: ft.id });
    pop.addInstance({ roleValues: { r1: "Al" } }); // maps to the "nickname" column
    pop.addInstance({ roleValues: { "no-such-role": "ignored" } }); // maps to nothing

    const schema: RelationalSchema = {
      sourceModelId: model.name,
      tables: [
        {
          name: "Customer Table", // needs quoting: space, uppercase
          columns: [
            { name: "id", dataType: "TEXT", nullable: false }, // no sourceRoleId: skipped
            { name: "nickname", dataType: "TEXT", nullable: true, sourceRoleId: "r1" },
          ],
          primaryKey: { columnNames: ["id"] },
          foreignKeys: [],
          sourceElementId: ft.id,
        },
      ],
    };

    const sql = renderPopulationAsSql(model, schema);
    expect(sql).toContain("INSERT INTO \"Customer Table\" (nickname) VALUES ('Al');");
    // The second instance produced no INSERT at all.
    expect(sql.match(/INSERT INTO/g)).toHaveLength(1);
  });
});

describe("renderPopulationAsOpenApiExamples", () => {
  it("should render OpenAPI examples for entity types", () => {
    const model = new ModelBuilder("TestModel")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .build();

    const ft = model.getFactTypeByName("Customer has CustomerId");
    if (!ft) throw new Error("Fact type not found");

    const pop = model.addPopulation({
      factTypeId: ft.id,
      description: "Sample customers",
    });
    pop.addInstance({
      roleValues: {
        [ft.roles[0]!.id]: "C001",
        [ft.roles[1]!.id]: "C001",
      },
    });

    const examples = renderPopulationAsOpenApiExamples(model);

    expect(examples.has("Customer")).toBe(true);
    const customerExample = examples.get("Customer");
    expect(customerExample).toBeDefined();
    expect(Object.keys(customerExample!).length).toBeGreaterThan(0);
  });

  it("should return empty map when model has no populations", () => {
    const model = new ModelBuilder("EmptyModel")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
      })
      .build();

    const examples = renderPopulationAsOpenApiExamples(model);

    expect(examples.size).toBe(0);
  });

  it("should use first instance when multiple exist", () => {
    const model = new ModelBuilder("TestModel")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .build();

    const ft = model.getFactTypeByName("Customer has CustomerId");
    if (!ft) throw new Error("Fact type not found");

    const pop = model.addPopulation({
      factTypeId: ft.id,
    });
    pop.addInstance({
      roleValues: {
        [ft.roles[0]!.id]: "FIRST",
        [ft.roles[1]!.id]: "FIRST",
      },
    });
    pop.addInstance({
      roleValues: {
        [ft.roles[0]!.id]: "SECOND",
        [ft.roles[1]!.id]: "SECOND",
      },
    });

    const examples = renderPopulationAsOpenApiExamples(model);

    expect(examples.has("Customer")).toBe(true);
    const customerExample = examples.get("Customer");
    expect(customerExample).toBeDefined();
    // Should use first instance
    expect(JSON.stringify(customerExample)).toContain("FIRST");
  });

  it("skips an entity type whose identifier fact type has no population at all", () => {
    const model = new ModelBuilder("TestModel")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      // No population added.
      .build();

    const examples = renderPopulationAsOpenApiExamples(model);
    expect(examples.has("Customer")).toBe(false);
  });

  it("skips an entity type whose identifier population has no instances", () => {
    const model = new ModelBuilder("TestModel")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("CustomerId", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .build();
    const ft = model.getFactTypeByName("Customer has CustomerId")!;
    model.addPopulation({ factTypeId: ft.id }); // empty: no instances added

    const examples = renderPopulationAsOpenApiExamples(model);
    expect(examples.has("Customer")).toBe(false);
  });

  it("omits a role's value when it is missing from the instance or its player type is unresolved", () => {
    const model = new OrmModel({ name: "Test" });
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const ft = model.addFactType(
      {
        name: "Customer has CustomerId",
        roles: [
          // Present in the instance, but its player type is unresolved.
          { id: "r1", name: "has", playerId: customer.id },
          { id: "r2", name: "identifies", playerId: "missing-id-type" },
        ],
        readings: ["{0} has {1}", "{1} identifies {0}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"], isPreferred: true },
        ],
      },
      { skipPlayerValidation: true },
    );
    const pop = model.addPopulation({ factTypeId: ft.id });
    // r1 is simply missing from the instance; r2's player type is unresolved.
    // Every role fails to contribute a value, so the example stays empty
    // and is never added to the map.
    pop.addInstance({ roleValues: { r2: "IDVAL" } });

    const examples = renderPopulationAsOpenApiExamples(model);
    expect(examples.has("Customer")).toBe(false);
  });
});
