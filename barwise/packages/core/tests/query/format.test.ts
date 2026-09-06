import { describe, expect, it } from "vitest";
import { formatQueryResult } from "../../src/query/format.js";
import { runQuery } from "../../src/query/index.js";
import type { EntityDetail, FactTypeDetail, QueryResult } from "../../src/query/types.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const model = new ModelBuilder("Shop")
  .withEntityType("Customer", { referenceMode: "customer_id" })
  .withEntityType("Order", { referenceMode: "order_number" })
  .withEntityType("Product", { referenceMode: "sku" })
  .withBinaryFactType("Customer places Order", {
    role1: { player: "Customer", name: "places" },
    role2: { player: "Order", name: "is placed by" },
    uniqueness: "role2",
    mandatory: "role2",
  })
  .withBinaryFactType("Order contains Product", {
    role1: { player: "Order", name: "contains" },
    role2: { player: "Product", name: "is in" },
  })
  .build();

describe("formatQueryResult", () => {
  it("renders an entity list", () => {
    const text = formatQueryResult(runQuery(model, "entities"));
    expect(text).toContain("Object types (3)");
    expect(text).toContain("Customer");
  });

  it("renders a fact-type list", () => {
    const text = formatQueryResult(runQuery(model, "fact-types"));
    expect(text).toContain("Fact types (2)");
  });

  it("renders a constraint list", () => {
    const text = formatQueryResult(runQuery(model, "constraints"));
    expect(text).toContain("Constraints (2)");
  });

  it("renders entity detail with sections", () => {
    const text = formatQueryResult(runQuery(model, "entity Customer"));
    expect(text).toContain("Entity: Customer");
    expect(text).toContain("Fact types:");
    expect(text).toContain("Constraints:");
  });

  it("renders fact-type detail", () => {
    const text = formatQueryResult(runQuery(model, 'fact-type "Customer places Order"'));
    expect(text).toContain("Fact type: Customer places Order");
    expect(text).toContain("Arity: 2");
  });

  it("renders a found path", () => {
    const text = formatQueryResult(runQuery(model, "path Customer Product"));
    expect(text).toContain('Path from "Customer" to "Product"');
    expect(text).toContain("via");
  });

  it("renders model stats", () => {
    const text = formatQueryResult(runQuery(model, "stats"));
    expect(text).toContain("Model: Shop");
    expect(text).toContain("Fact types:");
  });

  it("renders a not-found message", () => {
    const text = formatQueryResult(runQuery(model, "entity Ghost"));
    expect(text).toContain("Ghost");
  });

  it("renders an empty role list without throwing", () => {
    const text = formatQueryResult(runQuery(model, "mandatory-roles Customer"));
    expect(text).toContain("Roles (0)");
  });

  it("shows an entity's definition in the entity list line", () => {
    const withDef = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id", definition: "Buys things" })
      .build();
    const text = formatQueryResult(runQuery(withDef, "entities"));
    expect(text).toContain("Customer (entity) -- Buys things");
  });
});

describe("formatQueryResult (synthetic fixtures)", () => {
  // These cover shapes the query engine itself doesn't produce for the
  // fixture model above (a value-typed entity-detail subject, an
  // objectified fact type, path edge cases, and empty result lists) --
  // formatQueryResult only cares about the QueryResult shape, so
  // constructing one directly is more direct than contriving a model
  // and query string to reach it.
  it("omits the reference-mode line and shows a definition for a value-typed entity detail", () => {
    const detail: EntityDetail = {
      entity: { id: "e1", name: "Email", entityKind: "value", definition: "An email address" },
      factTypes: [],
      roles: [],
      constraints: [],
      subtypes: [],
      supertypes: [],
    };
    const text = formatQueryResult({ kind: "entity-detail", detail });
    expect(text).toContain("Entity: Email (value)");
    expect(text).toContain("Definition: An email address");
    expect(text).not.toContain("Reference mode:");
  });

  it("marks an objectified fact type in fact-type detail", () => {
    const detail: FactTypeDetail = {
      factType: {
        id: "ft1",
        name: "Person marries Person",
        arity: 2,
        reading: "Person marries Person",
      },
      roles: [],
      readings: ["Person marries Person"],
      constraints: [],
      objectified: true,
    };
    const text = formatQueryResult({ kind: "fact-type-detail", detail });
    expect(text).toContain("Objectified: yes");
  });

  it("reports when no path exists between two entities", () => {
    const result: QueryResult = { kind: "path", from: "A", to: "B", found: false, steps: [] };
    expect(formatQueryResult(result)).toBe('No path found between "A" and "B".');
  });

  it("reports the same entity when a path resolves with zero steps", () => {
    const result: QueryResult = { kind: "path", from: "A", to: "A", found: true, steps: [] };
    expect(formatQueryResult(result)).toBe('"A" and "A" are the same entity.');
  });

  it("uses the singular 'step' for a one-hop path", () => {
    const result: QueryResult = {
      kind: "path",
      from: "A",
      to: "B",
      found: true,
      steps: [{
        from: "A",
        to: "B",
        factType: { id: "ft1", name: "A relates B", arity: 2, reading: "A relates B" },
      }],
    };
    const text = formatQueryResult(result);
    expect(text).toContain("(1 step):");
    expect(text).not.toContain("(1 steps)");
  });

  it("includes the domain context line in stats when present", () => {
    const result: QueryResult = {
      kind: "stats",
      stats: {
        modelName: "Shop",
        domainContext: "retail",
        entityTypes: 1,
        valueTypes: 0,
        factTypes: 0,
        constraints: 0,
        subtypeRelationships: 0,
        objectifiedFactTypes: 0,
        populations: 0,
      },
    };
    expect(formatQueryResult(result)).toContain("Context: retail");
  });

  it("omits the missing-identifier flag when the anchor has a preferred identifier", () => {
    const result: QueryResult = {
      kind: "anchors",
      anchors: [
        {
          entity: "Customer",
          referenceMode: "customer_id",
          mandatoryRoles: [],
          missingIdentifier: false,
        },
      ],
    };
    const text = formatQueryResult(result);
    expect(text).toContain("Customer");
    expect(text).not.toContain("MISSING PREFERRED IDENTIFIER");
  });

  it("reports 'Anchors: none' for an empty anchors list", () => {
    expect(formatQueryResult({ kind: "anchors", anchors: [] })).toBe("Anchors: none");
  });

  it("flags a missing preferred identifier and omits identifier types when there are none", () => {
    const result: QueryResult = {
      kind: "anchors",
      anchors: [
        {
          entity: "Ghost",
          referenceMode: "ghost_id",
          preferredIdentifier: { factType: "Ghost has GhostId", identifierTypes: [] },
          mandatoryRoles: [],
          missingIdentifier: true,
        },
      ],
    };
    const text = formatQueryResult(result);
    expect(text).toContain("Ghost  [MISSING PREFERRED IDENTIFIER]");
    expect(text).toContain("Preferred identifier: Ghost has GhostId");
    expect(text).not.toContain("Ghost has GhostId (");
  });
});
