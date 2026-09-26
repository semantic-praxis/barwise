/**
 * OpenAPI import puts a property's constraints on the entity's role
 * (docs/specs/openapi-import-constraint-roles.spec.md, barwise-1076).
 *
 * Asserted by the role's PLAYER, not by counting constraints: the older
 * tests checked that some uniqueness existed, which is how the importer
 * shipped with both constraints on the value's role.
 */
import { type FactType, type OrmModel, ValidationEngine } from "@barwise/core";
import { Verbalizer } from "@barwise/core/verbalization";
import { describe, expect, it } from "vitest";
import { OpenApiImportFormat } from "../src/openapi/OpenApiImportFormat.js";

const importer = new OpenApiImportFormat();

function spec(schemas: Record<string, unknown>): string {
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    paths: {},
    components: { schemas },
  });
}

function factType(model: OrmModel, name: string): FactType {
  const ft = model.factTypes.find((f) => f.name === name);
  if (!ft) throw new Error(`no fact type "${name}": ${model.factTypes.map((f) => f.name)}`);
  return ft;
}

/** The names of the players whose roles carry a constraint of `type`. */
function constrainedPlayers(model: OrmModel, ft: FactType, type: string): string[] {
  const roleIds = ft.constraints.flatMap((c) =>
    c.type !== type ? [] : "roleIds" in c ? c.roleIds : "roleId" in c ? [c.roleId] : []
  );
  return roleIds.map((id) => {
    const role = ft.roles.find((r) => r.id === id)!;
    return model.getObjectType(role.playerId)!.name;
  });
}

const CUSTOMER = spec({
  Customer: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" }, nickname: { type: "string" } },
  },
});

describe("R1: a scalar property's fact type is entity-first, constrained on the entity's role", () => {
  it("reads <Entity> has <Value>, with the entity's role first and a reverse reading", () => {
    const { model } = importer.parse(CUSTOMER);
    const ft = factType(model, "Customer has Name");
    expect(ft.roles.map((r) => model.getObjectType(r.playerId)!.name)).toEqual([
      "Customer",
      "Name",
    ]);
    expect(ft.readings.map((r) => r.template)).toEqual(["{0} has {1}", "{1} is of {0}"]);
  });

  it("puts uniqueness on the entity's role, and required's mandatory there too", () => {
    const { model } = importer.parse(CUSTOMER);
    const ft = factType(model, "Customer has Name");
    expect(constrainedPlayers(model, ft, "internal_uniqueness")).toEqual(["Customer"]);
    expect(constrainedPlayers(model, ft, "mandatory")).toEqual(["Customer"]);
  });

  it("leaves an optional property's entity role optional", () => {
    const { model } = importer.parse(CUSTOMER);
    const ft = factType(model, "Customer has Nickname");
    expect(constrainedPlayers(model, ft, "internal_uniqueness")).toEqual(["Customer"]);
    expect(constrainedPlayers(model, ft, "mandatory")).toEqual([]);
  });

  it("verbalizes the way the schema reads (the finding's reproduction)", () => {
    const { model } = importer.parse(CUSTOMER);
    const text = new Verbalizer().verbalizeModel(model).map((v) => v.text).join("\n");
    expect(text).toContain("Each Customer has at most one Name.");
    expect(text).toContain("Each Customer has at least one Name.");
    expect(text).not.toContain("Each Name has at most one Customer.");
  });

  it("imports a model with no validation errors", () => {
    const { model } = importer.parse(CUSTOMER);
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });
});

describe("R2: a held value-type name is shared only under claimValueTypeName", () => {
  it("shares a same-named, same-typed value type across schemas", () => {
    const { model } = importer.parse(spec({
      Customer: { type: "object", properties: { name: { type: "string" } } },
      Supplier: { type: "object", properties: { name: { type: "string" } } },
    }));
    expect(model.objectTypes.filter((o) => o.kind === "value").map((o) => o.name)).toEqual([
      "Name",
    ]);
    expect(factType(model, "Supplier has Name")).toBeDefined();
  });

  it("does not bind a property to a same-named value type of another type", () => {
    const { model, warnings } = importer.parse(spec({
      Customer: { type: "object", properties: { code: { type: "string" } } },
      Product: { type: "object", properties: { code: { type: "integer" } } },
    }));
    const productCode = model.getObjectTypeByName("ProductCode");
    expect(productCode?.kind === "value" ? productCode.dataType?.name : undefined).toBe("integer");
    expect(factType(model, "Product has ProductCode")).toBeDefined();
    expect(warnings.some((w) => w.includes("ProductCode"))).toBe(true);
  });

  it("does not make an entity the player of a scalar property", () => {
    // A string property named like another schema's entity.
    const { model } = importer.parse(spec({
      Customer: { type: "object", properties: { id: { type: "string" } } },
      Order: { type: "object", properties: { customer: { type: "string" } } },
    }));
    expect(model.getObjectTypeByName("Customer")?.kind).toBe("entity");
    expect(factType(model, "Order has OrderCustomer")).toBeDefined();
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });

  it("does not share a value type whose enum differs, in either direction", () => {
    // PR #572 review: Order.status reused Customer's Status and took its domain.
    const { model, warnings } = importer.parse(spec({
      Customer: {
        type: "object",
        properties: { status: { type: "string", enum: ["active"] } },
      },
      Order: {
        type: "object",
        properties: { status: { type: "string", enum: ["pending"] } },
      },
      Note: { type: "object", properties: { status: { type: "string" } } },
    }));
    const domain = (name: string) => {
      const ot = model.getObjectTypeByName(name);
      return ot?.kind === "value" ? ot.valueConstraint?.values : "missing";
    };
    expect(domain("Status")).toEqual(["active"]);
    expect(domain("OrderStatus")).toEqual(["pending"]);
    expect(domain("NoteStatus")).toBeUndefined();
    expect(factType(model, "Order has OrderStatus")).toBeDefined();
    expect(factType(model, "Note has NoteStatus")).toBeDefined();
    expect(warnings.filter((w) => w.includes("enum"))).toHaveLength(2);
  });

  it("shares a value type whose enum is the same set", () => {
    const { model } = importer.parse(spec({
      Customer: { type: "object", properties: { tier: { type: "string", enum: ["a", "b"] } } },
      Supplier: { type: "object", properties: { tier: { type: "string", enum: ["b", "a"] } } },
    }));
    expect(factType(model, "Supplier has Tier")).toBeDefined();
    expect(model.getObjectTypeByName("SupplierTier")).toBeUndefined();
  });
});

describe("R3: the reference-mode property is the entity's preferred identifier", () => {
  /** Constraints on a fact type as `<type>:<player>[:preferred]`, sorted. */
  function shape(model: OrmModel, ft: FactType): string[] {
    const player = (id: string) =>
      model.getObjectType(ft.roles.find((r) => r.id === id)!.playerId)!.name;
    return ft.constraints.map((c) => {
      if (c.type === "mandatory") return `mandatory:${player(c.roleId)}`;
      if (c.type === "internal_uniqueness") {
        return `unique:${c.roleIds.map(player).join(",")}${c.isPreferred ? ":preferred" : ""}`;
      }
      return c.type;
    }).sort();
  }

  it("gives id the identifying binary shape, mandatory even when not required", () => {
    const { model } = importer.parse(spec({
      Customer: { type: "object", properties: { id: { type: "integer" } } },
    }));
    expect(shape(model, factType(model, "Customer has Id"))).toEqual([
      "mandatory:Customer",
      "unique:Customer",
      "unique:Id:preferred",
    ]);
  });

  it("finds a multi-word schema's own id property, camel or snake case", () => {
    for (const key of ["purchaseOrderId", "purchase_order_id"]) {
      const { model } = importer.parse(spec({
        PurchaseOrder: { type: "object", properties: { [key]: { type: "integer" } } },
      }));
      expect(model.getObjectTypeByName("PurchaseOrder")).toMatchObject({ referenceMode: key });
      expect(shape(model, factType(model, "PurchaseOrder has PurchaseOrderId")))
        .toContain("unique:PurchaseOrderId:preferred");
    }
  });

  it("defaults a multi-word schema with no id property to snake case", () => {
    const { model } = importer.parse(spec({
      PurchaseOrder: { type: "object", properties: { total: { type: "number" } } },
    }));
    expect(model.getObjectTypeByName("PurchaseOrder")).toMatchObject({
      referenceMode: "purchase_order_id",
    });
  });

  it("gives the key its plain name whatever the property order", () => {
    const keyFirst = { userId: { type: "string", format: "uuid" }, user_id: { type: "integer" } };
    const keyLast = { user_id: { type: "integer" }, userId: { type: "string", format: "uuid" } };
    for (const properties of [keyFirst, keyLast]) {
      const { model } = importer.parse(spec({ User: { type: "object", properties } }));
      expect(model.getObjectTypeByName("UserId")?.dataType).toEqual({ name: "uuid" });
      expect(shape(model, factType(model, "User has UserId"))).toContain(
        "unique:UserId:preferred",
      );
    }
  });

  it("creates every schema's key before any other schema's properties", () => {
    const { model } = importer.parse(spec({
      Account: {
        type: "object",
        properties: { id: { type: "integer" }, userId: { type: "string" } },
      },
      User: { type: "object", properties: { userId: { type: "string", format: "uuid" } } },
    }));
    expect(model.getObjectTypeByName("UserId")?.dataType).toEqual({ name: "uuid" });
    expect(model.getObjectTypeByName("AccountUserId")?.dataType).toEqual({ name: "text" });
  });

  it("exports the id as the key alone, with no has_id column", async () => {
    const { DdlExportFormat } = await import("../src/ddl/DdlExportFormat.js");
    const { model } = importer.parse(spec({
      Customer: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          email: { type: "string" },
        },
      },
    }));
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
    ].join("\n"));
  });
});
