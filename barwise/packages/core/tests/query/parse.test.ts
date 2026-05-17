import { describe, expect, it } from "vitest";
import { parseQuery, tokenizeQuery } from "../../src/query/parse.js";
import { QueryParseError } from "../../src/query/types.js";

describe("tokenizeQuery", () => {
  it("splits on whitespace", () => {
    expect(tokenizeQuery("entity Customer")).toEqual(["entity", "Customer"]);
  });

  it("treats double-quoted spans as one token", () => {
    expect(tokenizeQuery('fact-type "Customer places Order"')).toEqual([
      "fact-type",
      "Customer places Order",
    ]);
  });

  it("collapses repeated whitespace", () => {
    expect(tokenizeQuery("  entity   Customer  ")).toEqual(["entity", "Customer"]);
  });

  it("preserves an empty quoted token", () => {
    expect(tokenizeQuery('entity ""')).toEqual(["entity", ""]);
  });

  it("throws on an unbalanced quote", () => {
    expect(() => tokenizeQuery('entity "Customer')).toThrow(QueryParseError);
  });
});

describe("parseQuery", () => {
  it("parses the bare list commands", () => {
    expect(parseQuery("entities")).toEqual({ kind: "list-entities" });
    expect(parseQuery("fact-types")).toEqual({ kind: "list-fact-types" });
    expect(parseQuery("constraints")).toEqual({ kind: "list-constraints" });
    expect(parseQuery("stats")).toEqual({ kind: "model-stats" });
  });

  it("parses an entity-kind filter", () => {
    expect(parseQuery("entities value")).toEqual({
      kind: "list-entities",
      entityKind: "value",
    });
    expect(parseQuery("entities entity")).toEqual({
      kind: "list-entities",
      entityKind: "entity",
    });
  });

  it("rejects an invalid entity-kind filter", () => {
    expect(() => parseQuery("entities widget")).toThrow(QueryParseError);
  });

  it("parses a fact-type arity filter", () => {
    expect(parseQuery("fact-types 3")).toEqual({ kind: "list-fact-types", arity: 3 });
  });

  it("rejects a non-positive-integer arity", () => {
    expect(() => parseQuery("fact-types 0")).toThrow(QueryParseError);
    expect(() => parseQuery("fact-types two")).toThrow(QueryParseError);
  });

  it("parses a constraint-type filter", () => {
    expect(parseQuery("constraints mandatory")).toEqual({
      kind: "list-constraints",
      constraintType: "mandatory",
    });
  });

  it("parses entity and fact-type lookups, including quoted names", () => {
    expect(parseQuery("entity Customer")).toEqual({ kind: "entity", name: "Customer" });
    expect(parseQuery('fact-type "Customer places Order"')).toEqual({
      kind: "fact-type",
      name: "Customer places Order",
    });
  });

  it("parses relationship queries", () => {
    expect(parseQuery("fact-types-of Customer")).toEqual({
      kind: "fact-types-of",
      entity: "Customer",
    });
    expect(parseQuery("related-to Customer")).toEqual({
      kind: "related-entities",
      entity: "Customer",
    });
    expect(parseQuery("constraints-of Customer")).toEqual({
      kind: "constraints-of",
      name: "Customer",
    });
  });

  it("parses subtype queries with an optional transitive flag", () => {
    expect(parseQuery("subtypes-of Person")).toEqual({
      kind: "subtypes-of",
      entity: "Person",
      transitive: false,
    });
    expect(parseQuery("subtypes-of Person transitive")).toEqual({
      kind: "subtypes-of",
      entity: "Person",
      transitive: true,
    });
    expect(parseQuery("supertypes-of Manager transitive")).toEqual({
      kind: "supertypes-of",
      entity: "Manager",
      transitive: true,
    });
  });

  it("rejects an unknown second argument to subtypes-of", () => {
    expect(() => parseQuery("subtypes-of Person deep")).toThrow(QueryParseError);
  });

  it("parses mandatory-roles with and without an entity", () => {
    expect(parseQuery("mandatory-roles")).toEqual({ kind: "mandatory-roles" });
    expect(parseQuery("mandatory-roles Order")).toEqual({
      kind: "mandatory-roles",
      entity: "Order",
    });
  });

  it("parses path queries", () => {
    expect(parseQuery("path Customer Product")).toEqual({
      kind: "path",
      from: "Customer",
      to: "Product",
    });
  });

  it("rejects path with fewer than two arguments", () => {
    expect(() => parseQuery("path Customer")).toThrow(QueryParseError);
  });

  it("rejects an empty query", () => {
    expect(() => parseQuery("   ")).toThrow(QueryParseError);
  });

  it("rejects an unknown command", () => {
    expect(() => parseQuery("explode Customer")).toThrow(QueryParseError);
  });

  it("rejects a command missing a required argument", () => {
    expect(() => parseQuery("entity")).toThrow(QueryParseError);
    expect(() => parseQuery("fact-types-of")).toThrow(QueryParseError);
  });

  it("is case-insensitive on the command keyword", () => {
    expect(parseQuery("ENTITY Customer")).toEqual({ kind: "entity", name: "Customer" });
  });
});
