/**
 * Key columns keep their declared data types through import and
 * relational mapping (dbt-key-type-fidelity.spec.md, WS1; barwise-1057).
 *
 * The oracle is the relational schema core's mapper produces from the
 * imported model -- the same schema the DDL, dbt, OpenAPI and Avro
 * exports render -- so a key typed from anything but its own dbt
 * `data_type` fails here rather than in a downstream export.
 */
import { ValidationEngine } from "@barwise/core";
import { RelationalMapper } from "@barwise/core/mapping";
import { describe, expect, it } from "vitest";
import { importDbtProject } from "../../src/DbtProjectImporter.js";

/** The reproduction from the spec, verbatim in shape. */
const REPRO_YAML = `
models:
  - name: customers
    columns:
      - name: customer_id
        data_type: number
        data_tests: [not_null, unique]
      - name: customer_name
        data_type: varchar
      - name: is_active
        data_type: boolean
      - name: created_at
        data_type: timestamp_ntz
  - name: orders
    columns:
      - name: order_id
        data_type: number
        data_tests: [not_null, unique]
      - name: customer_id
        data_type: number
        data_tests:
          - not_null
          - relationships:
              to: ref('customers')
              field: customer_id
      - name: order_total
        data_type: number(10,2)
`;

function columnType(yaml: string, table: string, column: string): string | undefined {
  const { model } = importDbtProject([yaml]);
  const schema = new RelationalMapper().map(model);
  return schema.tables
    .find((t) => t.name === table)
    ?.columns.find((c) => c.name === column)
    ?.dataType;
}

describe("dbt import: typed identifiers", () => {
  it("creates an identifier value type carrying the key's declared type and a definition", () => {
    const { model } = importDbtProject([REPRO_YAML]);

    for (const name of ["CustomerId", "OrderId"]) {
      const vt = model.getObjectTypeByName(name);
      expect(vt?.kind, name).toBe("value");
      expect(vt?.kind === "value" ? vt.dataType : undefined, name).toEqual({
        name: "decimal",
        length: undefined,
        scale: undefined,
      });
      expect(vt?.definition, name).toBeTruthy();
    }
  });

  it("makes the identifier the entity's preferred identifying binary", () => {
    const { model } = importDbtProject([REPRO_YAML]);
    const customers = model.getObjectTypeByName("Customers")!;
    const customerId = model.getObjectTypeByName("CustomerId")!;

    const preferred = model.factTypes.filter((ft) =>
      ft.constraints.some((c) => c.type === "internal_uniqueness" && c.isPreferred)
    );
    expect(preferred.map((ft) => ft.name)).toEqual([
      "Customers has CustomerId",
      "Orders has OrderId",
    ]);

    const binary = preferred[0]!;
    const entityRole = binary.roles.find((r) => r.playerId === customers.id)!;
    const valueRole = binary.roles.find((r) => r.playerId === customerId.id)!;
    expect(binary.constraints).toContainEqual(expect.objectContaining({
      type: "internal_uniqueness",
      roleIds: [valueRole.id],
      isPreferred: true,
    }));

    const entityRoleConstraints = binary.constraints.filter(
      (c) =>
        (c.type === "mandatory" && c.roleId === entityRole.id)
        || (c.type === "internal_uniqueness" && c.roleIds.includes(entityRole.id)),
    );
    expect(entityRoleConstraints.map((c) => c.type).sort()).toEqual([
      "internal_uniqueness",
      "mandatory",
    ]);
  });

  it("types the primary keys and the foreign key from the declared data_type", () => {
    expect(columnType(REPRO_YAML, "customers", "customer_id")).toBe("DECIMAL");
    expect(columnType(REPRO_YAML, "orders", "order_id")).toBe("DECIMAL");
    expect(columnType(REPRO_YAML, "orders", "customer_id")).toBe("DECIMAL");
  });

  it("does not take the key's type from an unrelated attribute", () => {
    // Before WS1, orders.order_id was DECIMAL(10,2), borrowed from order_total.
    expect(columnType(REPRO_YAML, "orders", "order_id")).not.toBe("DECIMAL(10,2)");
  });

  it("maps the identifying binary once, as the key, not again as a value column", () => {
    const { model } = importDbtProject([REPRO_YAML]);
    const customers = new RelationalMapper()
      .map(model)
      .tables.find((t) => t.name === "customers")!;
    expect(customers.primaryKey.columnNames).toEqual(["customer_id"]);
    expect(customers.columns.filter((c) => c.name === "customer_id")).toHaveLength(1);
  });

  it("imports a model that validates without errors", () => {
    const { model } = importDbtProject([REPRO_YAML]);
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });

  it("resolves a key's type from source definitions when the model column has none", () => {
    const yaml = `
sources:
  - name: raw
    tables:
      - name: raw_products
        columns:
          - name: product_id
            data_type: integer
models:
  - name: products
    columns:
      - name: product_id
        data_tests: [not_null, unique]
`;
    const { model, report } = importDbtProject([yaml]);
    const vt = model.getObjectTypeByName("ProductId");
    expect(vt?.kind === "value" ? vt.dataType?.name : undefined).toBe("integer");
    expect(
      report.entries.some(
        (e) =>
          e.category === "data_type"
          && e.columnName === "product_id"
          && e.message.includes("from source definitions"),
      ),
    ).toBe(true);
  });

  it("reports a key with no data_type anywhere as a gap, and exports it with the fallback", () => {
    const yaml = `
models:
  - name: products
    columns:
      - name: product_id
        data_tests: [not_null, unique]
      - name: price
        data_type: "decimal(8,2)"
`;
    const { report } = importDbtProject([yaml]);
    expect(
      report.entries.some(
        (e) => e.severity === "gap" && e.category === "data_type" && e.columnName === "product_id",
      ),
    ).toBe(true);
    // Not DECIMAL(8,2) from price: an untyped key is untyped, not guessed.
    expect(columnType(yaml, "products", "product_id")).toBe("TEXT");
  });
});

describe("dbt import: key columns that share a name (decision D1)", () => {
  const SHARED_ID = (secondType: string) => `
models:
  - name: orders
    columns:
      - name: id
        data_type: number
        data_tests: [not_null, unique]
  - name: users
    columns:
      - name: id
        data_type: ${secondType}
        data_tests: [not_null, unique]
`;

  it("shares one identifier value type when the declared types agree", () => {
    const { model } = importDbtProject([SHARED_ID("number")]);
    expect(model.getObjectTypeByName("Id")?.kind).toBe("value");
    expect(model.getObjectTypeByName("UsersId")).toBeUndefined();
    expect(columnType(SHARED_ID("number"), "orders", "id")).toBe("DECIMAL");
    expect(columnType(SHARED_ID("number"), "users", "id")).toBe("DECIMAL");
  });

  it("keeps both types on a conflict and reports the renamed key column", () => {
    const yaml = SHARED_ID("varchar(36)");
    const { model, report } = importDbtProject([yaml]);

    const perEntity = model.getObjectTypeByName("UsersId");
    expect(perEntity?.kind === "value" ? perEntity.dataType : undefined).toEqual({
      name: "text",
      length: 36,
      scale: undefined,
    });
    expect(columnType(yaml, "orders", "id")).toBe("DECIMAL");
    expect(columnType(yaml, "users", "users_id")).toBe("VARCHAR(36)");

    const warnings = report.entries
      .filter((e) =>
        e.severity === "warning" && e.category === "identifier" && e.modelName === "users"
      )
      .map((e) => e.message);
    expect(warnings).toContainEqual(expect.stringContaining(`identifies model "orders"`));
    expect(warnings).toContainEqual(expect.stringContaining(`will export as "users_id"`));
  });

  it("does not throw when a key's name is held by an entity", () => {
    // The key column `orders` of model `order_lines` PascalCases to the
    // entity name of model `orders`.
    const yaml = `
models:
  - name: orders
    columns:
      - name: order_id
        data_type: number
        data_tests: [not_null, unique]
  - name: order_lines
    columns:
      - name: orders
        data_type: varchar
        data_tests: [not_null, unique]
`;
    const { model, report } = importDbtProject([yaml]);
    expect(model.getObjectTypeByName("Orders")?.kind).toBe("entity");
    expect(model.getObjectTypeByName("OrderLinesOrders")?.kind).toBe("value");
    expect(
      report.entries.some(
        (e) => e.category === "identifier" && e.message.includes(`entity type "Orders"`),
      ),
    ).toBe(true);
  });

  it("lets a non-key column with a key's name play that identifier value type", () => {
    // orders.customer_id without a relationships test is an attribute, not
    // a reference; it plays Customers' identifier value type. The diagram
    // keeps that value type visible for this reason (ModelToGraph).
    const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        data_type: number
        data_tests: [not_null, unique]
  - name: orders
    columns:
      - name: order_id
        data_type: number
        data_tests: [not_null, unique]
      - name: customer_id
        data_type: number
`;
    const { model } = importDbtProject([yaml]);
    const customerId = model.getObjectTypeByName("CustomerId")!;
    const attribute = model.getFactTypeByName("Orders has CustomerId");
    expect(attribute?.roles.map((r) => r.playerId)).toContain(customerId.id);
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });

  it("does not bind a typed non-key column to a same-named value type of another type", () => {
    // PR #564 review: customers.customer_id is a numeric key; an unrelated
    // orders.customer_id attribute is varchar(36). Sharing CustomerId
    // would export the varchar column as DECIMAL.
    const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        data_type: number
        data_tests: [not_null, unique]
  - name: orders
    columns:
      - name: order_id
        data_type: number
        data_tests: [not_null, unique]
      - name: customer_id
        data_type: varchar(36)
`;
    const { model, report } = importDbtProject([yaml]);
    // The attribute gets its own value type, and the mapper names the
    // column after it: a reported rename, never a wrong type (as D1 does
    // for keys).
    expect(columnType(yaml, "orders", "orders_customer_id")).toBe("VARCHAR(36)");
    expect(columnType(yaml, "customers", "customer_id")).toBe("DECIMAL");
    expect(model.getObjectTypeByName("OrdersCustomerId")?.kind).toBe("value");
    const warnings = report.entries
      .filter((e) =>
        e.severity === "warning" && e.columnName === "customer_id" && e.modelName === "orders"
      )
      .map((e) => e.message);
    expect(warnings).toContainEqual(
      expect.stringContaining(`Created value type "OrdersCustomerId"`),
    );
    expect(warnings).toContainEqual(expect.stringContaining(`will export as "orders_customer_id"`));
  });

  it("still shares a same-named value type when the column declares no type of its own", () => {
    const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        data_type: number
        data_tests: [not_null, unique]
      - name: status
        data_type: varchar
  - name: orders
    columns:
      - name: order_id
        data_type: number
        data_tests: [not_null, unique]
      - name: status
`;
    const { model } = importDbtProject([yaml]);
    expect(model.getObjectTypeByName("OrdersStatus")).toBeUndefined();
    expect(model.getFactTypeByName("Orders has Status")).toBeDefined();
  });

  it("does not throw when an ordinary column's name equals its own entity's renamed identifier", () => {
    // PR #564 review: the key `orders` of order_lines falls back to
    // OrderLinesOrders (an entity holds "Orders"), and the ordinary column
    // order_lines_orders PascalCases to the same name. Reusing that value
    // type would give OrderLines two fact types named
    // "OrderLines has OrderLinesOrders", and addFactType throws.
    const yaml = `
models:
  - name: orders
    columns:
      - name: order_id
        data_type: number
        data_tests: [not_null, unique]
  - name: order_lines
    columns:
      - name: orders
        data_type: varchar
        data_tests: [not_null, unique]
      - name: order_lines_orders
        data_type: varchar
`;
    const { model } = importDbtProject([yaml]);
    expect(model.getFactTypeByName("OrderLines has OrderLinesOrders")).toBeDefined();
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });

  it("does not make an entity the player of an ordinary attribute", () => {
    const yaml = `
models:
  - name: orders
    columns:
      - name: order_id
        data_type: number
        data_tests: [not_null, unique]
  - name: shipments
    columns:
      - name: shipment_id
        data_type: number
        data_tests: [not_null, unique]
      - name: orders
        data_type: varchar
`;
    const { model } = importDbtProject([yaml]);
    const vt = model.getObjectTypeByName("ShipmentsOrders");
    expect(vt?.kind).toBe("value");
    expect(model.getFactTypeByName("Shipments has ShipmentsOrders")).toBeDefined();
    expect(model.getFactTypeByName("Shipments has Orders")).toBeUndefined();
  });
});

describe("dbt import: key column names the mapping cannot reproduce", () => {
  it("reports a key column whose spelling does not survive the round trip", () => {
    const yaml = `
models:
  - name: customers
    columns:
      - name: customerID
        data_type: number
        data_tests: [not_null, unique]
`;
    const { report } = importDbtProject([yaml]);
    const renames = report.entries.filter(
      (e) => e.category === "identifier" && e.message.includes("will export as"),
    );
    expect(renames).toHaveLength(1);
    expect(renames[0]!.columnName).toBe("customerID");
  });

  it("reports nothing when every key column exports under its own name", () => {
    const { report } = importDbtProject([REPRO_YAML]);
    expect(report.entries.filter((e) => e.message.includes("will export as"))).toEqual([]);
  });
});
