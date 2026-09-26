/**
 * OpenAPI import puts a property's constraints on the entity's role and
 * imports its id as the key (docs/specs/openapi-import-constraint-roles.spec.md).
 *
 * OpenApiImportFormat.test.ts passes with the constraints on either role:
 * it asserts that some uniqueness or mandatory exists. These assert the
 * role, by its player, as DdlImportFidelity.test.ts does for DDL.
 */
import { type Constraint, type FactType, type OrmModel, ValidationEngine } from "@barwise/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { OpenApiImportFormat } from "../src/openapi/OpenApiImportFormat.js";

const importer = new OpenApiImportFormat();

function api(schemas: Record<string, unknown>): string {
  return JSON.stringify({
    openapi: "3.0.0",
    info: { title: "t", version: "1" },
    components: { schemas },
  });
}

function factType(model: OrmModel, name: string): FactType {
  const ft = model.factTypes.find((f) => f.name === name);
  if (!ft) throw new Error(`no fact type "${name}": ${model.factTypes.map((f) => f.name)}`);
  return ft;
}

/** Each constraint as `<type>:<player names>`, so a test reads which role holds it. */
function constraintsByPlayer(model: OrmModel, ft: FactType): string[] {
  const player = (roleId: string) =>
    model.getObjectType(ft.roles.find((r) => r.id === roleId)!.playerId)!.name;
  return ft.constraints.map((c: Constraint) => {
    if (c.type === "mandatory") return `mandatory:${player(c.roleId)}`;
    if (c.type === "internal_uniqueness") {
      return `unique:${c.roleIds.map(player).join(",")}${c.isPreferred ? ":preferred" : ""}`;
    }
    return c.type;
  }).sort();
}

const CUSTOMER_ORDER = api({
  Customer: {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
      email: { type: "string" },
    },
  },
  Order: {
    type: "object",
    required: ["id", "customer"],
    properties: {
      id: { type: "integer" },
      placedAt: { type: "string", format: "date-time" },
      customer: { $ref: "#/components/schemas/Customer" },
    },
  },
});

describe("properties: the entity's role first, constraints on it (R1)", () => {
  const { model } = importer.parse(CUSTOMER_ORDER);

  it("reads <Entity> has <Value>, entity first, with the inverse reading", () => {
    const ft = factType(model, "Customer has Name");
    expect(ft.roles.map((r) => model.getObjectType(r.playerId)!.name)).toEqual([
      "Customer",
      "Name",
    ]);
    expect(ft.readings.map((r) => r.template)).toEqual(["{0} has {1}", "{1} is of {0}"]);
  });

  it("a required property is mandatory on the entity's role, unique on it too", () => {
    expect(constraintsByPlayer(model, factType(model, "Customer has Name"))).toEqual([
      "mandatory:Customer",
      "unique:Customer",
    ]);
  });

  it("an optional property has only the entity-role uniqueness", () => {
    expect(constraintsByPlayer(model, factType(model, "Customer has Email"))).toEqual([
      "unique:Customer",
    ]);
  });
});

describe("the reference-mode property is the preferred identifier (R2)", () => {
  it("gives id the identifying binary shape", () => {
    const { model } = importer.parse(CUSTOMER_ORDER);
    expect(model.getObjectTypeByName("Customer")).toMatchObject({ referenceMode: "id" });
    expect(constraintsByPlayer(model, factType(model, "Customer has Id"))).toEqual([
      "mandatory:Customer",
      "unique:Customer",
      "unique:Id:preferred",
    ]);
  });

  it("does the same for a <schema>Id property", () => {
    const { model } = importer.parse(api({
      User: { type: "object", properties: { userId: { type: "string", format: "uuid" } } },
    }));
    expect(model.getObjectTypeByName("User")).toMatchObject({ referenceMode: "userId" });
    // userId is not in `required`, and the key is still mandatory: an
    // identifier does not depend on the schema's required list.
    expect(constraintsByPlayer(model, factType(model, "User has UserId"))).toEqual([
      "mandatory:User",
      "unique:User",
      "unique:UserId:preferred",
    ]);
  });

  it("finds a multi-word schema's own id property, in camel or snake case (review of PR #573)", () => {
    for (const key of ["purchaseOrderId", "purchase_order_id"]) {
      const { model } = importer.parse(api({
        PurchaseOrder: { type: "object", properties: { [key]: { type: "integer" } } },
      }));
      expect(model.getObjectTypeByName("PurchaseOrder")).toMatchObject({ referenceMode: key });
      expect(constraintsByPlayer(model, factType(model, "PurchaseOrder has PurchaseOrderId")))
        .toContain("unique:PurchaseOrderId:preferred");
    }
  });

  it("defaults a multi-word schema with no id property to a snake-case reference mode", () => {
    const { model } = importer.parse(api({
      PurchaseOrder: { type: "object", properties: { total: { type: "number" } } },
    }));
    expect(model.getObjectTypeByName("PurchaseOrder")).toMatchObject({
      referenceMode: "purchase_order_id",
    });
  });

  it("gives the key its plain name whatever the property order (review of PR #573)", () => {
    const keyFirst = { userId: { type: "string", format: "uuid" }, user_id: { type: "integer" } };
    const keyLast = { user_id: { type: "integer" }, userId: { type: "string", format: "uuid" } };
    for (const properties of [keyFirst, keyLast]) {
      const { model } = importer.parse(api({ User: { type: "object", properties } }));
      expect(model.getObjectTypeByName("UserId")?.dataType).toEqual({ name: "uuid" });
      expect(constraintsByPlayer(model, factType(model, "User has UserId"))).toContain(
        "unique:UserId:preferred",
      );
    }
  });

  it("creates every schema's key before any other schema's properties", () => {
    const { model } = importer.parse(api({
      Account: {
        type: "object",
        properties: { id: { type: "integer" }, userId: { type: "string" } },
      },
      User: { type: "object", properties: { userId: { type: "string", format: "uuid" } } },
    }));
    expect(model.getObjectTypeByName("UserId")?.dataType).toEqual({ name: "uuid" });
    expect(model.getObjectTypeByName("AccountUserId")?.dataType).toEqual({ name: "text" });
  });
});

describe("value types are shared only when sharing loses nothing (R3)", () => {
  it("splits a same-named property with a different type, and warns", () => {
    const { model, warnings } = importer.parse(api({
      Customer: { type: "object", properties: { code: { type: "string" } } },
      Supplier: { type: "object", properties: { code: { type: "integer" } } },
    }));
    expect(model.getObjectTypeByName("Code")?.dataType).toEqual({ name: "text" });
    expect(model.getObjectTypeByName("SupplierCode")?.dataType).toEqual({ name: "integer" });
    expect(warnings.join("\n")).toMatch(/created value type "SupplierCode"/);
  });

  it("shares a same-named property with the same type", () => {
    const { model } = importer.parse(api({
      Customer: { type: "object", properties: { code: { type: "string" } } },
      Supplier: { type: "object", properties: { code: { type: "string" } } },
    }));
    expect(model.objectTypes.filter((o) => o.name.endsWith("Code")).map((o) => o.name))
      .toEqual(["Code"]);
  });
});

describe("the acceptance round trip through DDL export", () => {
  it("exports the spec's input without invented columns or constraints", () => {
    const { model, warnings } = importer.parse(CUSTOMER_ORDER);
    expect(warnings).toEqual([]);
    const ddl = new DdlExportFormat().export(model).text
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim() !== "")
      .join("\n");
    expect(ddl).toBe([
      "CREATE TABLE customer (",
      "  id INTEGER NOT NULL,",
      "  name TEXT NOT NULL,",
      "  email TEXT,",
      "  PRIMARY KEY (id)",
      ");",
      "CREATE TABLE order (",
      "  id INTEGER NOT NULL,",
      "  placed_at DATETIME,",
      "  fk_id INTEGER NOT NULL,",
      "  PRIMARY KEY (id),",
      "  FOREIGN KEY (fk_id) REFERENCES customer (id)",
      ");",
    ].join("\n"));
  });
});

describe("schemas that share a property name import as a valid model (barwise-lh9)", () => {
  // The trial's reproduction, moved here when the fix landed
  // (trial/README.md). Role ids used to be built as
  // `<schema uuid>-<property>-role`, so two schemas with a `related`
  // property collided and every imported model failed
  // structural/duplicate-role-id. #563 mints them through generateId.
  it("validates with no errors", () => {
    const input = readFileSync(
      new URL("./fixtures/openapi-shared-property-names.json", import.meta.url),
      "utf8",
    );
    const { model } = importer.parse(input);
    expect(model.objectTypes.filter((o) => o.kind === "entity").map((o) => o.name).sort())
      .toEqual(["Patient", "Payer", "Provider"]);
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });
});
