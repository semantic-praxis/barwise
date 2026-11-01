/**
 * A 3.x fragment that names its base's elements by the ids the base's 3.x
 * file states (barwise-957's case, through the load): both are replayed
 * into 4.0's ids at load (iri-identity WS6), the base's elements under new
 * ids and the fragment's references, which it does not define, as written.
 * Diff and merge read such a reference through the base's map back.
 */
import { describe, expect, it } from "vitest";
import { diffModels, MERGE_DIFF_OPTIONS, mergeAndValidate } from "../../src/diff/index.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const serializer = new OrmYamlSerializer();

const PLACES = `    - id: ft-places
      name: Customer places Order
      roles:
        - { id: r-places, player: ot-cust, role_name: places }
        - { id: r-placed, player: ot-order, role_name: placed by }
      readings: ["{0} places {1}"]
      constraints:
        - { id: c-uq, type: internal_uniqueness, roles: [r-placed] }
`;
const BASE = `orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-cust, name: Customer, kind: entity, reference_mode: nr }
    - { id: ot-order, name: Order, kind: entity, reference_mode: nr }
  fact_types:
${PLACES}`;
const fragment = (extra = "") =>
  `orm_version: "3.0"
model:
  name: Shop
  fact_types:
${PLACES}${extra}`;

const load = (base: string, frag: string) => ({
  base: serializer.deserialize(base),
  incoming: serializer.deserialize(frag, { lenient: true }),
});

describe("a 3.x fragment over a 3.x base, both replayed at load", () => {
  it("diffs a fact type it restates as unchanged", () => {
    const { base, incoming } = load(BASE, fragment());
    // The base's object types, which a fragment does not restate, read as
    // removed; the fact type reads as it is, its players the base's.
    const deltas = diffModels(base, incoming, MERGE_DIFF_OPTIONS).deltas;
    expect(deltas.filter((d) => d.elementType === "fact_type").map((d) => d.kind)).toEqual([
      "unchanged",
    ]);
  });

  it("merges a fact type it adds over the base's object types", () => {
    const { base, incoming } = load(
      BASE,
      fragment(`    - id: ft-ships
      name: Order ships to Customer
      roles:
        - { id: r-ships, player: ot-order, role_name: ships to }
        - { id: r-shipped, player: ot-cust, role_name: receives }
      readings: ["{0} ships to {1}"]
`),
    );
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    // A fragment merge takes what it adds or changes, never a removal.
    const accepted = new Set(
      diff.deltas.flatMap((d, i) => (d.kind === "added" || d.kind === "modified" ? [i] : [])),
    );
    const result = mergeAndValidate(base, incoming, diff, accepted);
    expect(result.diagnostics).toEqual([]);
    expect(result.isValid).toBe(true);
    const ships = result.model!.getFactTypeByName("Order ships to Customer")!;
    expect(ships.roles.map((r) => r.playerId)).toEqual(["Order", "Customer"]);
  });
});
