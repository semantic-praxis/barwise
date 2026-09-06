/**
 * Tests for the ORM-to-relational schema mapper.
 *
 * RelationalMapper translates an OrmModel into a relational schema
 * following standard ORM-to-relational mapping rules:
 *   - Entity types become tables; value types become columns
 *   - Single-role uniqueness -> FK on the unique side (many-to-one)
 *   - Both-roles unique + one mandatory -> FK absorbed into mandatory side (1:1)
 *   - Both-roles unique + neither mandatory -> associative table (1:1 optional)
 *   - No uniqueness -> associative table (many-to-many)
 *   - Unary fact types -> boolean columns
 *   - Mandatory constraints -> NOT NULL
 */
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { renderDdl } from "../../src/mapping/renderers/ddl.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

describe("RelationalMapper", () => {
  describe("entity type tables", () => {
    it("creates a table for each entity type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .build();

      const schema = mapper.map(model);
      expect(schema.tables).toHaveLength(2);
      expect(schema.tables.map((t) => t.name)).toContain("customer");
      expect(schema.tables.map((t) => t.name)).toContain("order");
    });

    it("uses the reference mode as PK column", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .build();

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "customer")!;
      expect(table.primaryKey.columnNames).toEqual(["customer_id"]);
      expect(table.columns[0]!.name).toBe("customer_id");
      expect(table.columns[0]!.nullable).toBe(false);
    });

    it("does not create tables for value types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Rating")
        .build();

      const schema = mapper.map(model);
      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0]!.name).toBe("customer");
    });
  });

  describe("binary fact types with single-role uniqueness", () => {
    it("adds FK to the unique side table (standard many-to-one)", () => {
      // Customer places Order: uniqueness on Order role means
      // each Order -> at most one Customer. FK goes on Order table.
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;

      // FK column added to order table.
      expect(orderTable.foreignKeys).toHaveLength(1);
      expect(orderTable.foreignKeys[0]!.referencedTable).toBe("customer");
    });

    it("FK column is nullable when role is not mandatory", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      const fkCol = orderTable.columns.find((c) => c.name === "customer_id")!;
      expect(fkCol.nullable).toBe(true);
    });

    it("FK column is NOT NULL when role is mandatory", () => {
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

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      const fkCol = orderTable.columns.find((c) => c.name === "customer_id")!;
      expect(fkCol.nullable).toBe(false);
    });
  });

  describe("binary fact types with both roles unique (1:1)", () => {
    it("absorbs FK into mandatory side when one side is mandatory", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withEntityType("Desk", { referenceMode: "desk_id" })
        .withBinaryFactType("Employee sits at Desk", {
          role1: { player: "Employee", name: "sits at" },
          role2: { player: "Desk", name: "is sat at by" },
          uniqueness: "both",
          mandatory: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const employeeTable = schema.tables.find((t) => t.name === "employee")!;
      expect(employeeTable.foreignKeys).toHaveLength(1);
      expect(employeeTable.foreignKeys[0]!.referencedTable).toBe("desk");
      // No separate associative table.
      expect(schema.tables).toHaveLength(2);
    });

    it("absorbs FK into the mandatory side when only role2 is mandatory", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withEntityType("Desk", { referenceMode: "desk_id" })
        .withBinaryFactType("Employee sits at Desk", {
          role1: { player: "Employee", name: "sits at" },
          role2: { player: "Desk", name: "is sat at by" },
          uniqueness: "both",
          mandatory: "role2",
        })
        .build();

      const schema = mapper.map(model);
      const deskTable = schema.tables.find((t) => t.name === "desk")!;
      expect(deskTable.foreignKeys).toHaveLength(1);
      expect(deskTable.foreignKeys[0]!.referencedTable).toBe("employee");
      expect(schema.tables).toHaveLength(2);
    });

    it("creates associative table when neither side is mandatory", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withEntityType("Desk", { referenceMode: "desk_id" })
        .withBinaryFactType("Employee sits at Desk", {
          role1: { player: "Employee", name: "sits at" },
          role2: { player: "Desk", name: "is sat at by" },
          uniqueness: "both",
        })
        .build();

      const schema = mapper.map(model);
      // 2 entity tables + 1 associative
      expect(schema.tables).toHaveLength(3);
      const assoc = schema.tables.find((t) => t.name === "employee_sits_at_desk");
      expect(assoc).toBeDefined();
    });
  });

  describe("binary fact types with no uniqueness", () => {
    it("creates an associative table (many-to-many)", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Student", { referenceMode: "student_id" })
        .withEntityType("Course", { referenceMode: "course_id" })
        .withBinaryFactType("Student enrolls in Course", {
          role1: { player: "Student", name: "enrolls in" },
          role2: { player: "Course", name: "has enrolled" },
          // No uniqueness -> spanning/many-to-many
        })
        .build();

      const schema = mapper.map(model);
      expect(schema.tables).toHaveLength(3);
      const assoc = schema.tables.find((t) => t.name === "student_enrolls_in_course");
      expect(assoc).toBeDefined();
      expect(assoc!.foreignKeys).toHaveLength(2);
    });
  });

  describe("value type columns", () => {
    it("adds a column for a value type in a binary fact type", () => {
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      const name = model.addObjectType({ name: "Name", kind: "value" });
      model.addFactType({
        name: "Customer has Name",
        roles: [
          { id: "r1", name: "has", playerId: customer.id },
          { id: "r2", name: "is of", playerId: name.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
          { type: "mandatory", roleId: "r1" },
        ],
      });

      const schema = mapper.map(model);
      expect(schema.tables).toHaveLength(1);
      const table = schema.tables[0]!;
      expect(table.name).toBe("customer");
      const nameCol = table.columns.find((c) => c.name === "name");
      expect(nameCol).toBeDefined();
      expect(nameCol!.nullable).toBe(false); // mandatory
    });

    it("adds a column when the value type is role1 and the entity is role2", () => {
      const model = new OrmModel({ name: "Test" });
      const name = model.addObjectType({ name: "Name", kind: "value" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      model.addFactType({
        name: "Name is of Customer",
        roles: [
          { id: "r1", name: "is of", playerId: name.id },
          { id: "r2", name: "has", playerId: customer.id },
        ],
        readings: ["{0} is of {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r2"] },
          { type: "mandatory", roleId: "r2" },
        ],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "customer")!;
      const nameCol = table.columns.find((c) => c.name === "name");
      expect(nameCol).toBeDefined();
      expect(nameCol!.nullable).toBe(false);
    });
  });

  describe("foreign key column naming collisions", () => {
    it("prefixes the FK column when a second FK to the same target would collide", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withEntityType("Manager", { referenceMode: "manager_id" })
        .withBinaryFactType("Employee reports to Manager", {
          role1: { player: "Employee", name: "reports to" },
          role2: { player: "Manager", name: "has report" },
          uniqueness: "role1",
        })
        .withBinaryFactType("Employee was hired by Manager", {
          role1: { player: "Employee", name: "was hired by" },
          role2: { player: "Manager", name: "hired" },
          uniqueness: "role1",
        })
        .build();

      const schema = mapper.map(model);
      const employeeTable = schema.tables.find((t) => t.name === "employee")!;
      expect(employeeTable.foreignKeys).toHaveLength(2);
      expect(employeeTable.columns.some((c) => c.name === "manager_id")).toBe(true);
      expect(employeeTable.columns.some((c) => c.name === "fk_manager_id")).toBe(true);
    });

    it("disambiguates associative-table columns when the same entity plays two roles", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const event = model.addObjectType({
        name: "Event",
        kind: "entity",
        referenceMode: "event_id",
      });
      model.addFactType({
        name: "Person introduces Person at Event",
        roles: [
          { id: "r1", name: "introduces", playerId: person.id },
          { id: "r2", name: "is introduced by", playerId: person.id },
          { id: "r3", name: "at", playerId: event.id },
        ],
        readings: ["{0} introduces {1} at {2}"],
      });

      const schema = mapper.map(model);
      const assoc = schema.tables.find((t) => t.name === "person_introduces_person_at_event")!;
      // Both Person roles produce a column; the second is disambiguated
      // by role name rather than colliding on "person_id".
      expect(assoc.columns.map((c) => c.name)).toContain("person_id");
      expect(assoc.columns.map((c) => c.name)).toContain("is_introduced_by_person_id");
    });
  });

  describe("subtype fact mapping", () => {
    it("adds a shared-PK foreign key when the subtype fact provides identification", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "person_id",
      });
      model.addSubtypeFact({
        subtypeId: customer.id,
        supertypeId: person.id,
        providesIdentification: true,
      });

      const schema = mapper.map(model);
      const customerTable = schema.tables.find((t) => t.name === "customer")!;
      expect(customerTable.foreignKeys).toHaveLength(1);
      expect(customerTable.foreignKeys[0]!.columnNames).toEqual(["person_id"]);
      expect(customerTable.foreignKeys[0]!.referencedTable).toBe("person");
      // Shared PK: no extra column beyond the existing PK column.
      expect(customerTable.columns).toHaveLength(1);
    });

    it("adds a separate nullable FK column when the subtype fact does not provide identification", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const employee = model.addObjectType({
        name: "Employee",
        kind: "entity",
        referenceMode: "employee_id",
      });
      model.addSubtypeFact({
        subtypeId: employee.id,
        supertypeId: person.id,
        providesIdentification: false,
      });

      const schema = mapper.map(model);
      const employeeTable = schema.tables.find((t) => t.name === "employee")!;
      const fkCol = employeeTable.columns.find((c) => c.name === "person_id")!;
      expect(fkCol).toBeDefined();
      expect(fkCol.nullable).toBe(false);
      expect(employeeTable.foreignKeys[0]!.referencedTable).toBe("person");
    });

    it("prefixes the subtype FK column when it collides with an existing column", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "shared_id",
      });
      const org = model.addObjectType({
        name: "Organization",
        kind: "entity",
        referenceMode: "shared_id",
      });
      model.addSubtypeFact({
        subtypeId: org.id,
        supertypeId: person.id,
        providesIdentification: false,
      });

      const schema = mapper.map(model);
      const orgTable = schema.tables.find((t) => t.name === "organization")!;
      // Organization's own PK column is already "shared_id"; the FK to
      // Person's "shared_id" must be renamed to avoid colliding with it.
      expect(orgTable.columns.filter((c) => c.name === "shared_id")).toHaveLength(1);
      expect(orgTable.columns.some((c) => c.name === "fk_shared_id")).toBe(true);
    });
  });

  describe("objectified fact type mapping", () => {
    it("absorbs a mixed entity/value-role fact type's entity roles as a composite PK", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const country = model.addObjectType({
        name: "Country",
        kind: "entity",
        referenceMode: "country_code",
      });
      const role = model.addObjectType({ name: "Role", kind: "value" });
      const marriage = model.addObjectType({
        name: "Marriage",
        kind: "entity",
        referenceMode: "marriage_id",
      });
      const ft = model.addFactType({
        name: "Person marries in Country as Role",
        roles: [
          { id: "r1", name: "marries in", playerId: person.id },
          { id: "r2", name: "hosts", playerId: country.id },
          // A value-type role: skipped when absorbing FK columns.
          { id: "r3", name: "as", playerId: role.id },
        ],
        readings: ["{0} marries in {1} as {2}"],
      });
      model.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: marriage.id });

      const schema = mapper.map(model);
      const marriageTable = schema.tables.find((t) => t.name === "marriage")!;
      expect(marriageTable.primaryKey.columnNames).toEqual(["person_id", "country_code"]);
      expect(marriageTable.foreignKeys).toHaveLength(2);
      // The value-type role contributes no column.
      expect(marriageTable.columns.some((c) => c.sourceRoleId === "r3")).toBe(false);
    });

    it("leaves the entity's original PK when the underlying fact type has no entity roles", () => {
      const model = new OrmModel({ name: "Test" });
      const unit = model.addObjectType({ name: "Unit", kind: "value" });
      const amount = model.addObjectType({ name: "Amount", kind: "value" });
      const measurement = model.addObjectType({
        name: "Measurement",
        kind: "entity",
        referenceMode: "measurement_id",
      });
      const ft = model.addFactType({
        name: "Amount is in Unit",
        roles: [
          { id: "r1", name: "is in", playerId: amount.id },
          { id: "r2", name: "measures", playerId: unit.id },
        ],
        readings: ["{0} is in {1}"],
      });
      model.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: measurement.id });

      const schema = mapper.map(model);
      const measurementTable = schema.tables.find((t) => t.name === "measurement")!;
      // No entity roles to absorb, so the original PK is untouched.
      expect(measurementTable.primaryKey.columnNames).toEqual(["measurement_id"]);
      expect(measurementTable.foreignKeys).toHaveLength(0);
    });
  });

  describe("unary fact types", () => {
    it("adds a boolean column", () => {
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      model.addFactType({
        name: "Customer is active",
        roles: [{ id: "r1", name: "is active", playerId: customer.id }],
        readings: ["{0} is active"],
        constraints: [],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "customer")!;
      const col = table.columns.find((c) => c.name === "customer_is_active");
      expect(col).toBeDefined();
      expect(col!.dataType).toBe("BOOLEAN");
      expect(col!.nullable).toBe(true);
    });
  });

  describe("data type resolution", () => {
    it("resolves entity PK type from reference-mode value type", () => {
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      model.addObjectType({
        name: "Customer_id",
        kind: "value",
        dataType: { name: "auto_counter" },
      });
      // Reference-mode fact type linking Customer to Customer_id.
      model.addFactType({
        name: "Customer has id",
        roles: [
          { id: "r1", name: "has", playerId: customer.id },
          {
            id: "r2",
            name: "is of",
            playerId: model.getObjectTypeByName("Customer_id")!.id,
          },
        ],
        readings: ["{0} has {1}"],
        constraints: [],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "customer")!;
      expect(table.columns[0]!.dataType).toBe("INTEGER");
    });

    it("falls back to TEXT when entity has no reference-mode value type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Widget", { referenceMode: "widget_id" })
        .build();

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "widget")!;
      // No value type in the model, so PK defaults to TEXT.
      expect(table.columns[0]!.dataType).toBe("TEXT");
    });

    it("maps text with length to VARCHAR(n)", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const firstName = model.addObjectType({
        name: "FirstName",
        kind: "value",
        dataType: { name: "text", length: 30 },
      });
      model.addFactType({
        name: "Person has FirstName",
        roles: [
          { id: "r1", name: "has", playerId: person.id },
          { id: "r2", name: "is of", playerId: firstName.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
        ],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "person")!;
      const col = table.columns.find((c) => c.name === "first_name")!;
      expect(col.dataType).toBe("VARCHAR(30)");
    });

    it("maps text without length to TEXT", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const note = model.addObjectType({
        name: "Note",
        kind: "value",
        dataType: { name: "text" },
      });
      model.addFactType({
        name: "Person has Note",
        roles: [
          { id: "r1", name: "has", playerId: person.id },
          { id: "r2", name: "is of", playerId: note.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
        ],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "person")!;
      const col = table.columns.find((c) => c.name === "note")!;
      expect(col.dataType).toBe("TEXT");
    });

    it("maps decimal with precision and scale", () => {
      const model = new OrmModel({ name: "Test" });
      const product = model.addObjectType({
        name: "Product",
        kind: "entity",
        referenceMode: "product_id",
      });
      const price = model.addObjectType({
        name: "Price",
        kind: "value",
        dataType: { name: "decimal", length: 10, scale: 2 },
      });
      model.addFactType({
        name: "Product has Price",
        roles: [
          { id: "r1", name: "has", playerId: product.id },
          { id: "r2", name: "is of", playerId: price.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
        ],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "product")!;
      const col = table.columns.find((c) => c.name === "price")!;
      expect(col.dataType).toBe("DECIMAL(10,2)");
    });

    it("maps boolean, date, and uuid types correctly", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const active = model.addObjectType({
        name: "IsActive",
        kind: "value",
        dataType: { name: "boolean" },
      });
      const dob = model.addObjectType({
        name: "BirthDate",
        kind: "value",
        dataType: { name: "date" },
      });
      const token = model.addObjectType({
        name: "Token",
        kind: "value",
        dataType: { name: "uuid" },
      });
      model.addFactType({
        name: "Person has IsActive",
        roles: [
          { id: "r1", name: "has", playerId: person.id },
          { id: "r2", name: "is of", playerId: active.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"] }],
      });
      model.addFactType({
        name: "Person has BirthDate",
        roles: [
          { id: "r3", name: "has", playerId: person.id },
          { id: "r4", name: "is of", playerId: dob.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r3"] }],
      });
      model.addFactType({
        name: "Person has Token",
        roles: [
          { id: "r5", name: "has", playerId: person.id },
          { id: "r6", name: "is of", playerId: token.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r5"] }],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "person")!;
      expect(table.columns.find((c) => c.name === "is_active")!.dataType).toBe("BOOLEAN");
      expect(table.columns.find((c) => c.name === "birth_date")!.dataType).toBe("DATE");
      expect(table.columns.find((c) => c.name === "token")!.dataType).toBe("UUID");
    });

    it("FK column type matches referenced PK type", () => {
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      const customerId = model.addObjectType({
        name: "Customer_id",
        kind: "value",
        dataType: { name: "auto_counter" },
      });
      const order = model.addObjectType({
        name: "Order",
        kind: "entity",
        referenceMode: "order_number",
      });
      // Reference-mode fact type for Customer.
      model.addFactType({
        name: "Customer has id",
        roles: [
          { id: "r1", name: "has", playerId: customer.id },
          { id: "r2", name: "is of", playerId: customerId.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [],
      });
      // Binary fact type: Order -> Customer.
      model.addFactType({
        name: "Customer places Order",
        roles: [
          { id: "r3", name: "places", playerId: customer.id },
          { id: "r4", name: "is placed by", playerId: order.id },
        ],
        readings: ["{0} places {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r4"] },
        ],
      });

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      const fkCol = orderTable.columns.find((c) => c.name === "customer_id")!;
      // FK should be INTEGER (matching the auto_counter PK).
      expect(fkCol.dataType).toBe("INTEGER");
    });

    it("maps money type to DECIMAL(19,2)", () => {
      const model = new OrmModel({ name: "Test" });
      const invoice = model.addObjectType({
        name: "Invoice",
        kind: "entity",
        referenceMode: "invoice_id",
      });
      const amount = model.addObjectType({
        name: "Amount",
        kind: "value",
        dataType: { name: "money" },
      });
      model.addFactType({
        name: "Invoice has Amount",
        roles: [
          { id: "r1", name: "has", playerId: invoice.id },
          { id: "r2", name: "is of", playerId: amount.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"] }],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "invoice")!;
      const col = table.columns.find((c) => c.name === "amount")!;
      expect(col.dataType).toBe("DECIMAL(19,2)");
    });

    it("maps a length-bounded money type to DECIMAL(length,scale)", () => {
      const model = new OrmModel({ name: "Test" });
      const invoice = model.addObjectType({
        name: "Invoice",
        kind: "entity",
        referenceMode: "invoice_id",
      });
      const amount = model.addObjectType({
        name: "Amount",
        kind: "value",
        dataType: { name: "money", length: 12, scale: 4 },
      });
      model.addFactType({
        name: "Invoice has Amount",
        roles: [
          { id: "r1", name: "has", playerId: invoice.id },
          { id: "r2", name: "is of", playerId: amount.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"] }],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "invoice")!;
      const col = table.columns.find((c) => c.name === "amount")!;
      expect(col.dataType).toBe("DECIMAL(12,4)");
    });

    it("defaults the scale to 2 for a length-bounded money type with no explicit scale", () => {
      const model = new OrmModel({ name: "Test" });
      const invoice = model.addObjectType({
        name: "Invoice",
        kind: "entity",
        referenceMode: "invoice_id",
      });
      const amount = model.addObjectType({
        name: "Amount",
        kind: "value",
        dataType: { name: "money", length: 12 },
      });
      model.addFactType({
        name: "Invoice has Amount",
        roles: [
          { id: "r1", name: "has", playerId: invoice.id },
          { id: "r2", name: "is of", playerId: amount.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"] }],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "invoice")!;
      const col = table.columns.find((c) => c.name === "amount")!;
      expect(col.dataType).toBe("DECIMAL(12,2)");
    });

    it("maps a length-only decimal without a scale", () => {
      const model = new OrmModel({ name: "Test" });
      const product = model.addObjectType({
        name: "Product",
        kind: "entity",
        referenceMode: "product_id",
      });
      const weight = model.addObjectType({
        name: "Weight",
        kind: "value",
        dataType: { name: "decimal", length: 8 },
      });
      model.addFactType({
        name: "Product has Weight",
        roles: [
          { id: "r1", name: "has", playerId: product.id },
          { id: "r2", name: "is of", playerId: weight.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"] }],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "product")!;
      const col = table.columns.find((c) => c.name === "weight")!;
      expect(col.dataType).toBe("DECIMAL(8)");
    });

    it("maps float to FLOAT and 'other' to TEXT", () => {
      const model = new OrmModel({ name: "Test" });
      const sensor = model.addObjectType({
        name: "Sensor",
        kind: "entity",
        referenceMode: "sensor_id",
      });
      const reading = model.addObjectType({
        name: "Reading",
        kind: "value",
        dataType: { name: "float" },
      });
      const raw = model.addObjectType({ name: "Raw", kind: "value", dataType: { name: "other" } });
      model.addFactType({
        name: "Sensor has Reading",
        roles: [
          { id: "r1", name: "has", playerId: sensor.id },
          { id: "r2", name: "is of", playerId: reading.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"] }],
      });
      model.addFactType({
        name: "Sensor has Raw",
        roles: [
          { id: "r3", name: "has", playerId: sensor.id },
          { id: "r4", name: "is of", playerId: raw.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r3"] }],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "sensor")!;
      expect(table.columns.find((c) => c.name === "reading")!.dataType).toBe("FLOAT");
      expect(table.columns.find((c) => c.name === "raw")!.dataType).toBe("TEXT");
    });

    it("resolves the PK type from the reference-mode fact type when the entity plays role2", () => {
      const model = new OrmModel({ name: "Test" });
      const orderId = model.addObjectType({
        name: "OrderId",
        kind: "value",
        dataType: { name: "uuid" },
      });
      const order = model.addObjectType({
        name: "Order",
        kind: "entity",
        referenceMode: "order_id",
      });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      // The value type is role1 and the entity being identified is
      // role2 -- the reverse of the usual "Entity has Value" shape.
      model.addFactType({
        name: "OrderId identifies Order",
        roles: [
          { id: "r1", name: "identifies", playerId: orderId.id },
          { id: "r2", name: "is identified by", playerId: order.id },
        ],
        readings: ["{0} identifies {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r2"] }],
      });
      model.addFactType({
        name: "Order placed by Customer",
        roles: [
          { id: "r3", name: "placed by", playerId: order.id },
          { id: "r4", name: "places", playerId: customer.id },
        ],
        readings: ["{0} placed by {1}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r3"] }],
      });

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      expect(orderTable.columns[0]!.dataType).toBe("UUID");
    });
  });

  describe("data types in DDL rendering", () => {
    it("renders parameterized types in DDL", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const personId = model.addObjectType({
        name: "Person_id",
        kind: "value",
        dataType: { name: "auto_counter" },
      });
      const firstName = model.addObjectType({
        name: "FirstName",
        kind: "value",
        dataType: { name: "text", length: 50 },
      });
      model.addFactType({
        name: "Person has id",
        roles: [
          { id: "r1", name: "has", playerId: person.id },
          { id: "r2", name: "is of", playerId: personId.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [],
      });
      model.addFactType({
        name: "Person has FirstName",
        roles: [
          { id: "r3", name: "has", playerId: person.id },
          { id: "r4", name: "is of", playerId: firstName.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r3"] },
          { type: "mandatory", roleId: "r3" },
        ],
      });

      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      expect(ddl).toContain("person_id INTEGER NOT NULL");
      expect(ddl).toContain("first_name VARCHAR(50) NOT NULL");
    });

    it("uses isPreferred uniqueness constraint to determine PK type", () => {
      // Person has both a Name (text) and a PersonCode (integer).
      // Only PersonCode's fact type has isPreferred, so PK should be INTEGER.
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_code",
      });
      const personName = model.addObjectType({
        name: "Name",
        kind: "value",
        dataType: { name: "text", length: 80 },
      });
      const personCode = model.addObjectType({
        name: "Person_code",
        kind: "value",
        dataType: { name: "integer" },
      });

      // Add Name fact type FIRST (without isPreferred) -- the heuristic
      // would pick this one up if isPreferred were not checked.
      model.addFactType({
        name: "Person has Name",
        roles: [
          { id: "r1", name: "has", playerId: person.id },
          { id: "r2", name: "is of", playerId: personName.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
          { type: "mandatory", roleId: "r1" },
        ],
      });

      // Add PersonCode fact type SECOND with isPreferred.
      model.addFactType({
        name: "Person has code",
        roles: [
          { id: "r3", name: "has", playerId: person.id },
          { id: "r4", name: "is of", playerId: personCode.id },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r3"], isPreferred: true },
        ],
      });

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "person")!;
      const pkCol = table.columns.find((c) => c.name === "person_code")!;
      const ddl = renderDdl(schema);

      // PK should use INTEGER from isPreferred, not VARCHAR(80) from Name
      expect(pkCol.dataType).toBe("INTEGER");
      expect(ddl).toContain("person_code INTEGER NOT NULL");
      // Name column should still be VARCHAR(80)
      expect(ddl).toContain("name VARCHAR(80) NOT NULL");
    });
  });

  describe("preferredIdentifierStrategy option", () => {
    it("uses INTEGER fallback when strategy is 'integer'", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Widget", { referenceMode: "widget_id" })
        .build();

      const schema = mapper.map(model, { preferredIdentifierStrategy: "integer" });
      const table = schema.tables.find((t) => t.name === "widget")!;
      expect(table.columns[0]!.dataType).toBe("INTEGER");
    });

    it("uses UUID fallback when strategy is 'uuid'", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Widget", { referenceMode: "widget_id" })
        .build();

      const schema = mapper.map(model, { preferredIdentifierStrategy: "uuid" });
      const table = schema.tables.find((t) => t.name === "widget")!;
      expect(table.columns[0]!.dataType).toBe("UUID");
    });

    it("falls back to TEXT when no strategy is set", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Widget", { referenceMode: "widget_id" })
        .build();

      const schema = mapper.map(model);
      const table = schema.tables.find((t) => t.name === "widget")!;
      expect(table.columns[0]!.dataType).toBe("TEXT");
    });

    it("explicit value type overrides strategy", () => {
      // Even with uuid strategy, an entity with a declared integer
      // value type should use INTEGER for its PK.
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      model.addObjectType({
        name: "Customer_id",
        kind: "value",
        dataType: { name: "auto_counter" },
      });
      model.addFactType({
        name: "Customer has id",
        roles: [
          { id: "r1", name: "has", playerId: customer.id },
          {
            id: "r2",
            name: "is of",
            playerId: model.getObjectTypeByName("Customer_id")!.id,
          },
        ],
        readings: ["{0} has {1}"],
        constraints: [],
      });

      const schema = mapper.map(model, { preferredIdentifierStrategy: "uuid" });
      const table = schema.tables.find((t) => t.name === "customer")!;
      // Explicit auto_counter value type takes precedence over uuid strategy.
      expect(table.columns[0]!.dataType).toBe("INTEGER");
    });

    it("strategy applies to all entity types without explicit value types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .build();

      const schema = mapper.map(model, { preferredIdentifierStrategy: "uuid" });
      for (const table of schema.tables) {
        expect(table.columns[0]!.dataType).toBe("UUID");
      }
    });
  });

  describe("schema metadata", () => {
    it("sets sourceModelId", () => {
      const model = new ModelBuilder("Order Management").build();
      const schema = mapper.map(model);
      expect(schema.sourceModelId).toBe("Order Management");
    });
  });

  describe("traceability (sourceConstraintId)", () => {
    it("populates sourceConstraintId on FK from uniqueness constraint", () => {
      // Customer places Order with uniqueness on Order role.
      // This should create a FK on the order table with sourceConstraintId
      // pointing to the uniqueness constraint.
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      // Find the uniqueness constraint ID
      const ft = model.getFactTypeByName("Customer places Order")!;
      const uniquenessConstraint = ft.constraints.find(
        (c) => c.type === "internal_uniqueness",
      )!;
      expect(uniquenessConstraint).toBeDefined();

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      expect(orderTable.foreignKeys).toHaveLength(1);

      const fk = orderTable.foreignKeys[0]!;
      expect(fk.sourceConstraintId).toBeDefined();
      expect(fk.sourceConstraintId).toBe(uniquenessConstraint.id);
    });

    it("populates sourceConstraintId on FK from mandatory constraint", () => {
      // Customer places Order with mandatory on Order role.
      // The FK is created because of the uniqueness constraint,
      // but we should still track it.
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

      const ft = model.getFactTypeByName("Customer places Order")!;
      const uniquenessConstraint = ft.constraints.find(
        (c) => c.type === "internal_uniqueness",
      )!;

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      const fk = orderTable.foreignKeys[0]!;

      // FK is created by uniqueness constraint
      expect(fk.sourceConstraintId).toBe(uniquenessConstraint.id);
    });

    it("omits sourceConstraintId when the uniqueness constraint has no id", () => {
      const model = new OrmModel({ name: "Test" });
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
      const ft = model.addFactType({
        name: "Customer places Order",
        roles: [
          { id: "r1", name: "places", playerId: customer.id },
          { id: "r2", name: "is placed by", playerId: order.id },
        ],
        readings: ["{0} places {1}", "{1} is placed by {0}"],
      });
      // addConstraint (unlike the fact-type constructor) does not
      // backfill a missing id.
      ft.addConstraint({ type: "internal_uniqueness", roleIds: ["r2"] });

      const schema = mapper.map(model);
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      expect(orderTable.foreignKeys[0]!.sourceConstraintId).toBeUndefined();
    });
  });
});
