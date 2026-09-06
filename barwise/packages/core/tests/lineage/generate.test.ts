import { describe, expect, it } from "vitest";
import { generateDdlLineage, generateModelLineage } from "../../src/lineage/generate.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import type { RelationalSchema } from "../../src/mapping/RelationalSchema.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("Lineage Generation", () => {
  describe("generateDdlLineage", () => {
    it("should generate lineage for a simple entity table", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const mapper = new RelationalMapper();
      const schema = mapper.map(model);

      const lineage = generateDdlLineage(model, schema);

      expect(lineage).toHaveLength(1);
      expect(lineage[0].artifact).toBe("customer");

      // Should trace back to the Customer entity type
      const entitySource = lineage[0].sources.find(
        s => s.elementType === "EntityType" && s.elementName === "Customer",
      );
      expect(entitySource).toBeDefined();
    });

    it("should trace FK relationships to source constraints", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_id" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2", // Order is unique -> FK on Order table
          mandatory: "role2",
        })
        .build();

      const mapper = new RelationalMapper();
      const schema = mapper.map(model);

      const lineage = generateDdlLineage(model, schema);

      // Find the Order table lineage
      const orderLineage = lineage.find(entry => entry.artifact === "order");
      expect(orderLineage).toBeDefined();

      // Should have the Order entity type as a source
      const orderEntitySource = orderLineage!.sources.find(
        s => s.elementType === "EntityType" && s.elementName === "Order",
      );
      expect(orderEntitySource).toBeDefined();

      // Should have the fact type as a source (FK column)
      const factTypeSource = orderLineage!.sources.find(
        s => s.elementType === "FactType" && s.elementName === "Customer places Order",
      );
      expect(factTypeSource).toBeDefined();

      // Should have the Customer entity as a source (FK references Customer)
      const customerSource = orderLineage!.sources.find(
        s => s.elementType === "EntityType" && s.elementName === "Customer",
      );
      expect(customerSource).toBeDefined();
    });

    it("should trace columns back to their source roles", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("CustomerName", { dataType: { name: "Text" } })
        .withBinaryFactType("Customer has CustomerName", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerName", name: "is name of" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .build();

      const mapper = new RelationalMapper();
      const schema = mapper.map(model);

      const lineage = generateDdlLineage(model, schema);

      const customerLineage = lineage.find(entry => entry.artifact === "customer");
      expect(customerLineage).toBeDefined();

      // Should have the fact type that produced the name column
      const factTypeSource = customerLineage!.sources.find(
        s => s.elementType === "FactType" && s.elementName === "Customer has CustomerName",
      );
      expect(factTypeSource).toBeDefined();

      // Should have the CustomerName value type
      const valueTypeSource = customerLineage!.sources.find(
        s => s.elementType === "ValueType" && s.elementName === "CustomerName",
      );
      expect(valueTypeSource).toBeDefined();

      // Should have roles as sources
      const roleSources = customerLineage!.sources.filter(s => s.elementType === "Role");
      expect(roleSources.length).toBeGreaterThan(0);
    });

    it("should handle associative tables from many-to-many relationships", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Student", { referenceMode: "student_id" })
        .withEntityType("Course", { referenceMode: "course_id" })
        .withBinaryFactType("Student enrolls in Course", {
          role1: { player: "Student", name: "enrolls in" },
          role2: { player: "Course", name: "has enrolled" },
          // No uniqueness on either role -> spanning uniqueness -> associative table
        })
        .build();

      const mapper = new RelationalMapper();
      const schema = mapper.map(model);

      const lineage = generateDdlLineage(model, schema);

      // Should have 3 tables: student, course, and the associative table
      expect(lineage.length).toBe(3);

      // Find the associative table
      const assocLineage = lineage.find(
        entry => entry.artifact !== "student" && entry.artifact !== "course",
      );
      expect(assocLineage).toBeDefined();

      // Should trace to the fact type
      const factTypeSource = assocLineage!.sources.find(
        s => s.elementType === "FactType" && s.elementName === "Student enrolls in Course",
      );
      expect(factTypeSource).toBeDefined();

      // Should reference both entity types
      const studentSource = assocLineage!.sources.find(
        s => s.elementType === "EntityType" && s.elementName === "Student",
      );
      const courseSource = assocLineage!.sources.find(
        s => s.elementType === "EntityType" && s.elementName === "Course",
      );
      expect(studentSource).toBeDefined();
      expect(courseSource).toBeDefined();
    });
  });

  describe("generateDdlLineage against a hand-authored schema", () => {
    // generateDdlLineage's contract is any RelationalSchema, not only
    // mapper-produced ones -- these exercise its defensive fallbacks for
    // references a schema producer got wrong (a nonexistent source
    // element, an unknown source role, or a foreign key pointing at a
    // table name that isn't in the schema), which RelationalMapper's own
    // output never triggers.
    function personModel() {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Person", { referenceMode: "person_id" })
        .build();
      return model;
    }

    it("adds no element source when the table's sourceElementId matches nothing in the model", () => {
      const model = personModel();
      const schema: RelationalSchema = {
        sourceModelId: model.id,
        tables: [
          {
            name: "orphan",
            columns: [],
            primaryKey: { columnNames: ["id"] },
            foreignKeys: [],
            sourceElementId: "no-such-element",
          },
        ],
      };

      const lineage = generateDdlLineage(model, schema);
      expect(lineage).toHaveLength(1);
      expect(lineage[0]!.sources).toEqual([]);
    });

    it("skips role tracing for a column whose sourceRoleId is not in the model", () => {
      const model = personModel();
      const person = model.getObjectTypeByName("Person")!;
      const schema: RelationalSchema = {
        sourceModelId: model.id,
        tables: [
          {
            name: "person",
            columns: [{
              name: "id",
              dataType: "TEXT",
              nullable: false,
              sourceRoleId: "no-such-role",
            }],
            primaryKey: { columnNames: ["id"] },
            foreignKeys: [],
            sourceElementId: person.id,
          },
        ],
      };

      const lineage = generateDdlLineage(model, schema);
      // Only the table's own entity-type source; the dangling role is ignored.
      expect(lineage[0]!.sources).toEqual([
        { elementId: person.id, elementType: "EntityType", elementName: "Person" },
      ]);
    });

    it("ignores a foreign key whose referencedTable is not a table in the schema", () => {
      const model = personModel();
      const person = model.getObjectTypeByName("Person")!;
      const schema: RelationalSchema = {
        sourceModelId: model.id,
        tables: [
          {
            name: "person",
            columns: [],
            primaryKey: { columnNames: ["id"] },
            foreignKeys: [
              { columnNames: ["ghost_id"], referencedTable: "ghost", referencedColumns: ["id"] },
            ],
            sourceElementId: person.id,
          },
        ],
      };

      const lineage = generateDdlLineage(model, schema);
      // Only the table's own entity-type source; the FK adds nothing.
      expect(lineage[0]!.sources).toEqual([
        { elementId: person.id, elementType: "EntityType", elementName: "Person" },
      ]);
    });

    it("ignores a foreign key whose sourceConstraintId matches no constraint on any fact type", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Team", { referenceMode: "team_id" })
        .withBinaryFactType("Person belongs to Team", {
          role1: { player: "Person", name: "belongs to" },
          role2: { player: "Team", name: "has member" },
          mandatory: "role1",
        })
        .build();
      const person = model.getObjectTypeByName("Person")!;
      const team = model.getObjectTypeByName("Team")!;

      const schema: RelationalSchema = {
        sourceModelId: model.id,
        tables: [
          {
            name: "person",
            columns: [],
            primaryKey: { columnNames: ["id"] },
            foreignKeys: [
              {
                columnNames: ["team_id"],
                referencedTable: "team",
                referencedColumns: ["id"],
                sourceConstraintId: "no-such-constraint",
              },
            ],
            sourceElementId: person.id,
          },
          {
            name: "team",
            columns: [],
            primaryKey: { columnNames: ["id"] },
            foreignKeys: [],
            sourceElementId: team.id,
          },
        ],
      };

      const lineage = generateDdlLineage(model, schema);
      const personLineage = lineage.find((e) => e.artifact === "person")!;
      // The referenced Team entity is still traced (independent of the
      // constraint lookup), but no Constraint or Role source is added
      // since the id doesn't match any constraint in the model.
      expect(personLineage.sources).toEqual([
        { elementId: person.id, elementType: "EntityType", elementName: "Person" },
        { elementId: team.id, elementType: "EntityType", elementName: "Team" },
      ]);
    });

    it("skips non-matching constraints before finding the one a foreign key traces to", () => {
      const model = new OrmModel({ name: "Test Model" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      const order = model.addObjectType({
        name: "Order",
        kind: "entity",
        referenceMode: "order_id",
      });
      // The mandatory constraint is declared before the uniqueness
      // constraint the mapper's FK will trace to -- RelationalMapper
      // finds the uniqueness constraint by type regardless of order, so
      // generateDdlLineage's search must skip past the non-matching
      // mandatory constraint first.
      const ft = model.addFactType({
        name: "Customer places Order",
        roles: [
          { id: "r1", name: "places", playerId: customer.id },
          { id: "r2", name: "is placed by", playerId: order.id },
        ],
        readings: ["{0} places {1}", "{1} is placed by {0}"],
        constraints: [
          { id: "c-mandatory", type: "mandatory", roleId: "r2" },
          { id: "c-unique", type: "internal_uniqueness", roleIds: ["r2"] },
        ],
      });
      expect(ft.constraints.map((c) => c.id)).toEqual(["c-mandatory", "c-unique"]);

      const mapper = new RelationalMapper();
      const schema = mapper.map(model);
      const lineage = generateDdlLineage(model, schema);

      const orderLineage = lineage.find((e) => e.artifact === "order")!;
      const constraintSource = orderLineage.sources.find((s) => s.elementType === "Constraint");
      expect(constraintSource).toBeDefined();
      expect(constraintSource!.elementName).toBe("UC: Customer places Order");
    });
  });

  describe("generateModelLineage", () => {
    it("should generate lineage entries for all entity types", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_id" })
        .build();

      const lineage = generateModelLineage(model);

      expect(lineage).toHaveLength(2);

      const customerEntry = lineage.find(e => e.artifact === "Customer");
      const orderEntry = lineage.find(e => e.artifact === "Order");

      expect(customerEntry).toBeDefined();
      expect(orderEntry).toBeDefined();

      // Each should have the entity itself as a source
      expect(customerEntry!.sources.some(
        s => s.elementType === "EntityType" && s.elementName === "Customer",
      )).toBe(true);
      expect(orderEntry!.sources.some(
        s => s.elementType === "EntityType" && s.elementName === "Order",
      )).toBe(true);
    });

    it("should include related fact types and constraints", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_id" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .build();

      const lineage = generateModelLineage(model);

      const customerEntry = lineage.find(e => e.artifact === "Customer");
      expect(customerEntry).toBeDefined();

      // Should include the fact type
      const factTypeSource = customerEntry!.sources.find(
        s => s.elementType === "FactType" && s.elementName === "Customer places Order",
      );
      expect(factTypeSource).toBeDefined();

      // Should include roles
      const roleSources = customerEntry!.sources.filter(s => s.elementType === "Role");
      expect(roleSources.length).toBeGreaterThan(0);

      // Should include constraints
      const constraintSources = customerEntry!.sources.filter(s => s.elementType === "Constraint");
      expect(constraintSources.length).toBeGreaterThan(0);
    });

    it("should include value types when present", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("CustomerName", { dataType: { name: "Text" } })
        .withBinaryFactType("Customer has CustomerName", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerName", name: "is name of" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .build();

      const lineage = generateModelLineage(model);

      const customerEntry = lineage.find(e => e.artifact === "Customer");
      expect(customerEntry).toBeDefined();

      // Should include the value type
      const valueTypeSource = customerEntry!.sources.find(
        s => s.elementType === "ValueType" && s.elementName === "CustomerName",
      );
      expect(valueTypeSource).toBeDefined();
    });

    it("should include subtype relationships", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Customer", { referenceMode: "person_id" })
        .withSubtypeFact("Customer", "Person")
        .build();

      const lineage = generateModelLineage(model);

      const customerEntry = lineage.find(e => e.artifact === "Customer");
      expect(customerEntry).toBeDefined();

      // Should include Person as a supertype
      const personSource = customerEntry!.sources.filter(
        s => s.elementType === "EntityType" && s.elementName === "Person",
      );
      expect(personSource.length).toBeGreaterThan(0);

      const personEntry = lineage.find(e => e.artifact === "Person");
      expect(personEntry).toBeDefined();

      // Person should reference Customer as a subtype
      const customerSource = personEntry!.sources.filter(
        s => s.elementType === "EntityType" && s.elementName === "Customer",
      );
      expect(customerSource.length).toBeGreaterThan(0);
    });

    it("should handle entities with no fact types", () => {
      const model = new ModelBuilder("Test Model")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const lineage = generateModelLineage(model);

      expect(lineage).toHaveLength(1);
      expect(lineage[0].artifact).toBe("Customer");

      // Should only have the entity itself as a source
      expect(lineage[0].sources).toHaveLength(1);
      expect(lineage[0].sources[0].elementType).toBe("EntityType");
      expect(lineage[0].sources[0].elementName).toBe("Customer");
    });

    it("names every constraint kind, including the generic label for kinds with none of their own", () => {
      const model = new OrmModel({ name: "Test Model" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const ft = model.addFactType({
        name: "Person recommends Person",
        roles: [
          { id: "r1", name: "recommends", playerId: person.id },
          { id: "r2", name: "is recommended by", playerId: person.id },
        ],
        readings: ["{0} recommends {1}"],
      });
      // addConstraint skips construction-time validation, so a single
      // fact type can carry one of every constraint kind for this check
      // -- these are not meant to form a semantically coherent model.
      ft.addConstraint({ id: "c1", type: "external_uniqueness", roleIds: ["r1"] });
      ft.addConstraint({ id: "c2", type: "value_constraint", roleId: "r1", values: ["a", "b"] });
      ft.addConstraint({ id: "c3", type: "disjunctive_mandatory", roleIds: ["r1", "r2"] });
      ft.addConstraint({ id: "c4", type: "exclusion", roleIds: ["r1", "r2"] });
      ft.addConstraint({ id: "c5", type: "exclusive_or", roleIds: ["r1", "r2"] });
      ft.addConstraint({ id: "c6", type: "frequency", roleIds: ["r1"], min: 1, max: 2 });
      ft.addConstraint({
        id: "c7",
        type: "ring",
        roleId1: "r1",
        roleId2: "r2",
        ringType: "irreflexive",
      });
      ft.addConstraint({
        id: "c8",
        type: "subset",
        subsetRoleIds: ["r1"],
        supersetRoleIds: ["r2"],
      });
      ft.addConstraint({ id: "c9", type: "equality", roleIds1: ["r1"], roleIds2: ["r2"] });
      // value_comparison falls into the generic-labeled default case.
      ft.addConstraint({
        id: "c10",
        type: "value_comparison",
        roleId1: "r1",
        roleId2: "r2",
        operator: "<",
      });

      const lineage = generateModelLineage(model);
      const names = lineage[0]!.sources
        .filter((s) => s.elementType === "Constraint")
        .map((s) => s.elementName);

      expect(names).toEqual([
        "External UC: Person recommends Person",
        "Value: Person recommends Person",
        "Disjunctive Mandatory",
        "Exclusion: Person recommends Person",
        "Exclusive-Or",
        "Frequency: Person recommends Person",
        "Ring: Person recommends Person",
        "Subset",
        "Equality",
        "Constraint: Person recommends Person",
      ]);
    });

    it("omits a constraint source when the constraint has no id", () => {
      const model = new OrmModel({ name: "Test Model" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const ft = model.addFactType({
        name: "Person is active",
        roles: [{ id: "r1", name: "is active", playerId: person.id }],
        readings: ["{0} is active"],
      });
      // addConstraint (unlike the fact-type constructor) does not
      // backfill a missing id.
      ft.addConstraint({ type: "value_constraint", roleId: "r1", values: ["x"] });

      const lineage = generateModelLineage(model);
      const constraintSources = lineage[0]!.sources.filter((s) => s.elementType === "Constraint");
      expect(constraintSources).toEqual([]);
    });
  });
});
