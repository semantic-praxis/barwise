/**
 * Tests for the query_model MCP tool.
 *
 * Verifies that the tool returns deterministic structured query results
 * and surfaces parse errors.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeQueryModel } from "../../src/tools/queryModel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

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

/** A composite key across two fact types, nested under the second. */
const roomsModel = `
orm_version: "1.0"
model:
  name: Facilities
  object_types:
    - { id: ot-room, name: Room, kind: entity, reference_mode: id }
    - { id: ot-building, name: Building, kind: entity, reference_mode: code }
    - { id: ot-nr, name: RoomNumber, kind: value }
  fact_types:
    - id: ft-in
      name: Room is in Building
      roles:
        - { id: r-1, player: ot-room, role_name: is in }
        - { id: r-2, player: ot-building, role_name: houses }
      readings: ["{0} is in {1}"]
      constraints:
        - { id: c-one-building, type: internal_uniqueness, roles: [r-1] }
    - id: ft-nr
      name: Room has RoomNumber
      roles:
        - { id: r-3, player: ot-room, role_name: has }
        - { id: r-4, player: ot-nr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: c-one-nr, type: internal_uniqueness, roles: [r-3] }
        - { id: c-room-key, type: external_uniqueness, roles: [r-2, r-4] }
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

  it("names each constraint by its own id and the fact types it applies to (orm-format-3, Open decision 9)", () => {
    const parsed = parse(executeQueryModel(roomsModel, "constraints-of Room"));
    const result = parsed.result as { constraints: Record<string, unknown>[]; };
    expect(result.constraints.map(({ id, factTypes, factTypeIds }) => ({
      id,
      factTypes,
      factTypeIds,
    }))).toEqual([
      { id: "c-one-building", factTypes: ["Room is in Building"], factTypeIds: ["ft-in"] },
      {
        id: "c-room-key",
        factTypes: ["Room is in Building", "Room has RoomNumber"],
        factTypeIds: ["ft-in", "ft-nr"],
      },
      { id: "c-one-nr", factTypes: ["Room has RoomNumber"], factTypeIds: ["ft-nr"] },
    ]);
  });

  it("gives a constraint the file leaves without an id its own derived id, not a position", () => {
    const parsed = parse(executeQueryModel(simpleModel, "constraints-of Order"));
    const refs = (parsed.result as { constraints: Record<string, unknown>[]; }).constraints;
    const ids = refs.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    // Derived from content, so a second load gives the same ids; a random
    // fill would not.
    const again = parse(executeQueryModel(simpleModel, "constraints-of Order"));
    expect((again.result as { constraints: { id: string; }[]; }).constraints.map((c) => c.id))
      .toEqual(ids);
    for (const c of refs) {
      expect(c.id).not.toMatch(/-constraint-\d+$/);
      expect(c.id).not.toBe("ft-customer-places-order");
      expect(c).not.toHaveProperty("factType");
      expect(c).not.toHaveProperty("factTypeId");
    }
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

  describe("project source", () => {
    const project = `${fixtures}/project/project.orm-project.yaml`;

    it("queries every domain when no domain is given", () => {
      const parsed = parse(executeQueryModel(project, "stats"));
      const domains = parsed.domains as Array<{ domain: string; result: unknown; }>;
      expect(domains).toHaveLength(2);
      expect(domains.map((d) => d.domain)).toEqual(["crm", "billing"]);
    });

    it("queries only the chosen domain", () => {
      const parsed = parse(executeQueryModel(project, "entities", "crm"));
      expect(parsed.domain).toBe("crm");
      expect((parsed.result as { kind: string; }).kind).toBe("entities");
      expect(parsed.domains).toBeUndefined();
    });

    it("reports an error for an unknown domain", () => {
      const parsed = parse(executeQueryModel(project, "entities", "ghost"));
      expect(parsed.error).toBeDefined();
      expect(parsed.error as string).toContain("crm, billing");
    });
  });
});
