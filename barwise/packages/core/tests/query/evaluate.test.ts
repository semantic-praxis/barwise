import { describe, expect, it } from "vitest";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { queryModel } from "../../src/query/evaluate.js";
import { runQuery } from "../../src/query/index.js";
import type { QueryResult } from "../../src/query/types.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

function buildModel(): OrmModel {
  return new ModelBuilder("Shop", "retail")
    .withEntityType("Customer", {
      referenceMode: "customer_id",
      definition: "A buyer.",
    })
    .withEntityType("Order", { referenceMode: "order_number" })
    .withEntityType("Product", { referenceMode: "sku" })
    .withEntityType("Person", { referenceMode: "person_id" })
    .withEntityType("Employee", { referenceMode: "employee_id" })
    .withEntityType("Manager", { referenceMode: "manager_id" })
    .withValueType("Name")
    .withBinaryFactType("Customer places Order", {
      role1: { player: "Customer", name: "places" },
      role2: { player: "Order", name: "is placed by" },
      uniqueness: "role2",
      mandatory: "role2",
    })
    .withBinaryFactType("Order contains Product", {
      role1: { player: "Order", name: "contains" },
      role2: { player: "Product", name: "is in" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Customer has Name", {
      role1: { player: "Customer", name: "has" },
      role2: { player: "Name", name: "is of" },
    })
    .withSubtypeFact("Employee", "Person")
    .withSubtypeFact("Manager", "Employee")
    .build();
}

const model = buildModel();

describe("queryModel: list-entities", () => {
  it("lists all object types", () => {
    const r = runQuery(model, "entities");
    expect(r.kind).toBe("entities");
    if (r.kind !== "entities") throw new Error("wrong kind");
    expect(r.entities).toHaveLength(7);
    // Sorted by name.
    expect(r.entities[0]!.name).toBe("Customer");
  });

  it("filters by entity kind", () => {
    const entities = runQuery(model, "entities entity");
    const values = runQuery(model, "entities value");
    if (entities.kind !== "entities" || values.kind !== "entities") {
      throw new Error("wrong kind");
    }
    expect(entities.entities).toHaveLength(6);
    expect(values.entities).toHaveLength(1);
    expect(values.entities[0]!.name).toBe("Name");
  });

  it("carries the definition on entity refs", () => {
    const r = runQuery(model, "entities");
    if (r.kind !== "entities") throw new Error("wrong kind");
    const customer = r.entities.find((e) => e.name === "Customer")!;
    expect(customer.definition).toBe("A buyer.");
    expect(customer.referenceMode).toBe("customer_id");
  });
});

describe("queryModel: list-fact-types", () => {
  it("lists all fact types", () => {
    const r = runQuery(model, "fact-types");
    if (r.kind !== "fact-types") throw new Error("wrong kind");
    expect(r.factTypes).toHaveLength(3);
    expect(r.factTypes[0]!.reading).toBeTruthy();
  });

  it("filters by arity", () => {
    const binary = runQuery(model, "fact-types 2");
    const ternary = runQuery(model, "fact-types 3");
    if (binary.kind !== "fact-types" || ternary.kind !== "fact-types") {
      throw new Error("wrong kind");
    }
    expect(binary.factTypes).toHaveLength(3);
    expect(ternary.factTypes).toHaveLength(0);
  });
});

describe("queryModel: list-constraints", () => {
  it("lists every constraint", () => {
    const r = runQuery(model, "constraints");
    if (r.kind !== "constraints") throw new Error("wrong kind");
    expect(r.constraints).toHaveLength(3);
  });

  it("filters by constraint-type keyword", () => {
    const unique = runQuery(model, "constraints uniqueness");
    const mandatory = runQuery(model, "constraints mandatory");
    if (unique.kind !== "constraints" || mandatory.kind !== "constraints") {
      throw new Error("wrong kind");
    }
    expect(unique.constraints).toHaveLength(2);
    expect(mandatory.constraints).toHaveLength(1);
  });
});

describe("queryModel: entity detail", () => {
  it("returns fact types, roles and constraints for an entity", () => {
    const r = runQuery(model, "entity Customer");
    if (r.kind !== "entity-detail") throw new Error("wrong kind");
    expect(r.detail.entity.name).toBe("Customer");
    expect(r.detail.factTypes).toHaveLength(2);
    expect(r.detail.roles).toHaveLength(2);
    expect(r.detail.constraints).toHaveLength(2);
  });

  it("is case-insensitive on the entity name", () => {
    const r = runQuery(model, "entity customer");
    expect(r.kind).toBe("entity-detail");
  });

  it("includes direct subtypes and supertypes", () => {
    const person = runQuery(model, "entity Person");
    const manager = runQuery(model, "entity Manager");
    if (person.kind !== "entity-detail" || manager.kind !== "entity-detail") {
      throw new Error("wrong kind");
    }
    expect(person.detail.subtypes.map((e) => e.name)).toEqual(["Employee"]);
    expect(manager.detail.supertypes.map((e) => e.name)).toEqual(["Employee"]);
  });

  it("returns not-found for a missing entity", () => {
    const r = runQuery(model, "entity Nonexistent");
    expect(r.kind).toBe("not-found");
    if (r.kind !== "not-found") throw new Error("wrong kind");
    expect(r.message).toContain("Nonexistent");
  });
});

describe("queryModel: fact-type detail", () => {
  it("returns roles, readings and constraints", () => {
    const r = runQuery(model, 'fact-type "Customer places Order"');
    if (r.kind !== "fact-type-detail") throw new Error("wrong kind");
    expect(r.detail.roles).toHaveLength(2);
    expect(r.detail.readings.length).toBeGreaterThanOrEqual(1);
    expect(r.detail.constraints).toHaveLength(2);
    expect(r.detail.objectified).toBe(false);
  });

  it("returns not-found for a missing fact type", () => {
    const r = runQuery(model, 'fact-type "No Such Fact"');
    expect(r.kind).toBe("not-found");
  });
});

describe("queryModel: relationship queries", () => {
  it("fact-types-of returns the entity's fact types", () => {
    const r = runQuery(model, "fact-types-of Order");
    if (r.kind !== "fact-types") throw new Error("wrong kind");
    expect(r.factTypes).toHaveLength(2);
  });

  it("related-to returns co-participating entities", () => {
    const r = runQuery(model, "related-to Order");
    if (r.kind !== "entities") throw new Error("wrong kind");
    expect(r.entities.map((e) => e.name)).toEqual(["Customer", "Product"]);
  });

  it("constraints-of resolves a fact type name", () => {
    const r = runQuery(model, 'constraints-of "Customer places Order"');
    if (r.kind !== "constraints") throw new Error("wrong kind");
    expect(r.constraints).toHaveLength(2);
  });

  it("constraints-of resolves an entity name", () => {
    const r = runQuery(model, "constraints-of Product");
    if (r.kind !== "constraints") throw new Error("wrong kind");
    expect(r.constraints).toHaveLength(1);
  });

  it("constraints-of returns not-found for an unknown name", () => {
    const r = runQuery(model, "constraints-of Ghost");
    expect(r.kind).toBe("not-found");
  });
});

describe("queryModel: subtype hierarchy", () => {
  it("returns direct subtypes by default", () => {
    const r = runQuery(model, "subtypes-of Person");
    if (r.kind !== "entities") throw new Error("wrong kind");
    expect(r.entities.map((e) => e.name)).toEqual(["Employee"]);
  });

  it("walks the hierarchy transitively", () => {
    const subs = runQuery(model, "subtypes-of Person transitive");
    const supers = runQuery(model, "supertypes-of Manager transitive");
    if (subs.kind !== "entities" || supers.kind !== "entities") {
      throw new Error("wrong kind");
    }
    expect(subs.entities.map((e) => e.name)).toEqual(["Employee", "Manager"]);
    expect(supers.entities.map((e) => e.name)).toEqual(["Employee", "Person"]);
  });
});

describe("queryModel: mandatory-roles", () => {
  it("lists every mandatory role", () => {
    const r = runQuery(model, "mandatory-roles");
    if (r.kind !== "roles") throw new Error("wrong kind");
    expect(r.roles).toHaveLength(1);
    expect(r.roles[0]!.player).toBe("Order");
  });

  it("filters mandatory roles by entity", () => {
    const order = runQuery(model, "mandatory-roles Order");
    const customer = runQuery(model, "mandatory-roles Customer");
    if (order.kind !== "roles" || customer.kind !== "roles") {
      throw new Error("wrong kind");
    }
    expect(order.roles).toHaveLength(1);
    expect(customer.roles).toHaveLength(0);
  });

  it("returns not-found when the entity filter is unknown", () => {
    const r = runQuery(model, "mandatory-roles Ghost");
    expect(r.kind).toBe("not-found");
  });
});

describe("queryModel: path", () => {
  it("finds a multi-hop path between entities", () => {
    const r = runQuery(model, "path Customer Product");
    if (r.kind !== "path") throw new Error("wrong kind");
    expect(r.found).toBe(true);
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0]!.from).toBe("Customer");
    expect(r.steps[r.steps.length - 1]!.to).toBe("Product");
  });

  it("reports no path between disconnected entities", () => {
    const r = runQuery(model, "path Customer Person");
    if (r.kind !== "path") throw new Error("wrong kind");
    expect(r.found).toBe(false);
    expect(r.steps).toHaveLength(0);
  });

  it("treats an entity as connected to itself with zero steps", () => {
    const r = runQuery(model, "path Customer Customer");
    if (r.kind !== "path") throw new Error("wrong kind");
    expect(r.found).toBe(true);
    expect(r.steps).toHaveLength(0);
  });

  it("returns not-found when an endpoint is unknown", () => {
    const r = runQuery(model, "path Customer Ghost");
    expect(r.kind).toBe("not-found");
  });
});

describe("queryModel: model-stats", () => {
  it("returns element counts", () => {
    const r = runQuery(model, "stats");
    if (r.kind !== "stats") throw new Error("wrong kind");
    expect(r.stats).toMatchObject({
      modelName: "Shop",
      domainContext: "retail",
      entityTypes: 6,
      valueTypes: 1,
      factTypes: 3,
      constraints: 3,
      subtypeRelationships: 2,
      objectifiedFactTypes: 0,
      populations: 0,
    });
  });
});

describe("queryModel: accepts a struct directly", () => {
  it("evaluates a ModelQuery without going through the DSL", () => {
    const r: QueryResult = queryModel(model, { kind: "model-stats" });
    expect(r.kind).toBe("stats");
  });
});
