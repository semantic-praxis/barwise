/**
 * Tests for the query_model MCP tool.
 *
 * Verifies that the tool returns deterministic structured query results
 * and surfaces parse errors.
 */

import { describe, expect, it } from "vitest";
import { executeQueryModel } from "../../src/tools/queryModel.js";

const simpleModel = `
orm_version: "1.0"
model:
  name: Test Model
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: cust_id
      definition: A person who buys products
    - id: ot-order
      name: Order
      kind: entity
      reference_mode: order_num
  fact_types:
    - id: ft-customer-places-order
      name: Customer places Order
      roles:
        - id: r-cust-places
          player: ot-customer
          role_name: places
        - id: r-order-placed-by
          player: ot-order
          role_name: is placed by
      readings:
        - "{0} places {1}"
      constraints:
        - type: internal_uniqueness
          roles: [r-order-placed-by]
        - type: mandatory
          role: r-order-placed-by
`;

function parse(result: { content: Array<{ text: string; }>; }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text);
}

describe("query_model tool", () => {
  it("lists entities", () => {
    const parsed = parse(executeQueryModel(simpleModel, "entities"));
    expect((parsed.result as { kind: string; }).kind).toBe("entities");
    expect((parsed.result as { entities: unknown[]; }).entities).toHaveLength(2);
  });

  it("describes a single entity", () => {
    const parsed = parse(executeQueryModel(simpleModel, "entity Customer"));
    const result = parsed.result as { kind: string; detail: { entity: { name: string; }; }; };
    expect(result.kind).toBe("entity-detail");
    expect(result.detail.entity.name).toBe("Customer");
  });

  it("returns fact types an entity participates in", () => {
    const parsed = parse(executeQueryModel(simpleModel, "fact-types-of Customer"));
    const result = parsed.result as { kind: string; factTypes: unknown[]; };
    expect(result.kind).toBe("fact-types");
    expect(result.factTypes).toHaveLength(1);
  });

  it("returns model statistics", () => {
    const parsed = parse(executeQueryModel(simpleModel, "stats"));
    const result = parsed.result as { kind: string; stats: { factTypes: number; }; };
    expect(result.kind).toBe("stats");
    expect(result.stats.factTypes).toBe(1);
  });

  it("includes a human-readable text rendering", () => {
    const parsed = parse(executeQueryModel(simpleModel, "stats"));
    expect(typeof parsed.text).toBe("string");
    expect(parsed.text as string).toContain("Test Model");
  });

  it("returns a not-found result for a missing entity", () => {
    const parsed = parse(executeQueryModel(simpleModel, "entity Ghost"));
    expect((parsed.result as { kind: string; }).kind).toBe("not-found");
  });

  it("surfaces a parse error for an invalid query", () => {
    const parsed = parse(executeQueryModel(simpleModel, "bogus query"));
    expect(parsed.error).toBeDefined();
    expect(parsed.hint).toBeDefined();
  });

  it("reports an error for an invalid model source", () => {
    const parsed = parse(executeQueryModel("not: valid: orm", "entities"));
    expect(parsed.error).toBeDefined();
  });
});
