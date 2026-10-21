/**
 * Tests for the `anchors` query: each entity type's identification scheme,
 * preferred-identifier uniqueness, and mandatory roles, with a flag for
 * entities that have no identifier at all.
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { formatQueryResult } from "../../src/query/format.js";
import { runQuery } from "../../src/query/index.js";
import { parseQuery } from "../../src/query/parse.js";
import type { EntityAnchors, QueryResult } from "../../src/query/types.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/** A Customer with a fully-formed preferred identifier. */
function identifiedModel(): OrmModel {
  return new ModelBuilder("M")
    .withEntityType("Customer", { referenceMode: "customer_id" })
    .withValueType("CustomerId")
    .withBinaryFactType("Customer has CustomerId", {
      role1: { player: "Customer", name: "has" },
      role2: { player: "CustomerId", name: "identifies" },
      uniqueness: "both",
      mandatory: "role1",
      isPreferred: true,
    })
    .build();
}

/**
 * The importers' convention: the preferred flag on the value's role. The
 * anchor used to require the flag on a role the entity plays, so an
 * imported model reported every entity as having no identifier.
 */
function importedModel(): OrmModel {
  return new ModelBuilder("M")
    .withEntityType("Customer", { referenceMode: "customer_id" })
    .withValueType("CustomerId")
    .withBinaryFactType("CustomerId identifies Customer", {
      role1: { player: "CustomerId", name: "identifies" },
      role2: { player: "Customer", name: "has" },
      uniqueness: "both",
      isPreferred: true,
    })
    .build();
}

function anchorsOf(result: QueryResult): readonly EntityAnchors[] {
  if (result.kind !== "anchors") throw new Error(`expected anchors, got ${result.kind}`);
  return result.anchors;
}

describe("query parse: anchors", () => {
  it("parses with and without an entity", () => {
    expect(parseQuery("anchors")).toEqual({ kind: "anchors" });
    expect(parseQuery("anchors Customer")).toEqual({ kind: "anchors", entity: "Customer" });
  });
});

describe("queryModel: anchors", () => {
  it("reports the reference mode, preferred identifier, and mandatory roles", () => {
    const anchors = anchorsOf(runQuery(identifiedModel(), "anchors Customer"));
    expect(anchors).toHaveLength(1);
    const a = anchors[0]!;
    expect(a.entity).toBe("Customer");
    expect(a.referenceMode).toBe("customer_id");
    expect(a.preferredIdentifier).toEqual({
      factType: "Customer has CustomerId",
      identifierTypes: ["CustomerId"],
    });
    expect(a.mandatoryRoles).toEqual(["Customer has CustomerId"]);
    expect(a.missingIdentifier).toBe(false);
  });

  it("finds the identifier when the flag is on the value's role, as importers put it", () => {
    const [a] = anchorsOf(runQuery(importedModel(), "anchors Customer"));
    expect(a!.preferredIdentifier).toEqual({
      factType: "CustomerId identifies Customer",
      identifierTypes: ["CustomerId"],
    });
    expect(a!.missingIdentifier).toBe(false);
  });

  it("names only the covered roles' players for an objectified type", () => {
    // Signing objectifies a ternary and is identified by the uniqueness
    // over two of its roles; the third role's player identifies nothing.
    const model = new OrmModel({ name: "M" });
    for (
      const [id, name] of [["ot-c", "Customer"], ["ot-o", "Organization"], [
        "ot-a",
        "Agreement",
      ], ["ot-s", "Signing"]] as const
    ) {
      model.addObjectType({ id, name, kind: "entity", referenceMode: "id" });
    }
    model.addFactType({
      id: "ft-sign",
      name: "Customer signs Agreement for Organization",
      roles: [
        { id: "r-c", name: "signs", playerId: "ot-c" },
        { id: "r-a", name: "is signed", playerId: "ot-a" },
        { id: "r-o", name: "for", playerId: "ot-o" },
      ],
      readings: ["{0} signs {1} for {2}"],
      constraints: [{
        id: "u",
        type: "internal_uniqueness",
        roleIds: ["r-c", "r-a"],
        isPreferred: true,
      }],
    });
    model.addObjectifiedFactType({ id: "oft", factTypeId: "ft-sign", objectTypeId: "ot-s" });
    const [a] = anchorsOf(runQuery(model, "anchors Signing"));
    expect(a!.preferredIdentifier?.identifierTypes).toEqual(["Customer", "Agreement"]);
  });

  it("lists every entity type (and only entity types) for the bare query", () => {
    const anchors = anchorsOf(runQuery(identifiedModel(), "anchors"));
    expect(anchors.map((a) => a.entity)).toEqual(["Customer"]);
  });

  it("returns multiple entities sorted by name regardless of creation order", () => {
    const model = new ModelBuilder("M")
      .withEntityType("Zebra", { referenceMode: "zebra_id" })
      .withEntityType("Apple", { referenceMode: "apple_id" })
      .withEntityType("Mango", { referenceMode: "mango_id" })
      .build();
    const anchors = anchorsOf(runQuery(model, "anchors"));
    expect(anchors.map((a) => a.entity)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("flags an entity whose identification is not formalized (no preferred id)", () => {
    const model = new ModelBuilder("M")
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();
    const a = anchorsOf(runQuery(model, "anchors Order"))[0]!;
    expect(a.missingIdentifier).toBe(true);
    expect(a.referenceMode).toBe("order_number");
    expect(a.preferredIdentifier).toBeUndefined();
    expect(a.mandatoryRoles).toEqual([]);
  });

  it("returns not-found for a value type", () => {
    const result = runQuery(identifiedModel(), "anchors CustomerId");
    expect(result.kind).toBe("not-found");
  });

  it("returns not-found for an unknown entity", () => {
    const result = runQuery(identifiedModel(), "anchors Ghost");
    expect(result.kind).toBe("not-found");
  });
});

describe("formatQueryResult: anchors", () => {
  it("marks a missing preferred identifier in the text rendering", () => {
    const model = new ModelBuilder("M")
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();
    const text = formatQueryResult(runQuery(model, "anchors"));
    expect(text).toContain("Order");
    expect(text).toContain("MISSING PREFERRED IDENTIFIER");
  });

  it("renders the preferred identifier and mandatory roles", () => {
    const text = formatQueryResult(runQuery(identifiedModel(), "anchors Customer"));
    expect(text).toContain("Reference mode: customer_id");
    expect(text).toContain("Preferred identifier: Customer has CustomerId (CustomerId)");
    expect(text).toContain("Mandatory in: Customer has CustomerId");
  });
});
