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
});
