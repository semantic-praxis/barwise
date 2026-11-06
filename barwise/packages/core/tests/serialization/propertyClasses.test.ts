/**
 * The schema defines no property for relational mapping, DDL or other
 * rendered output (docs/adr/metamodel-evolution-policy.md#recompute-derived).
 * A name list of derived properties (`tables`, `ddl`) would miss one under a
 * new name, so the check is an allowlist: every property slot the schema
 * defines has a reviewed class in `schemas/orm-model.property-classes.json`,
 * and a slot without one fails here until someone classifies it.
 *
 * Slots are keyed by full JSON pointer, not by name, so reusing a name that
 * is classified elsewhere (`expression`, `name`) in a new place is still a
 * new row to review. The writer side needs no second check: every map an
 * output object passes through is closed (`additionalProperties: false`),
 * and writer40.test.ts validates the writer's output against the schema.
 */
import { describe, expect, it } from "vitest";
import table from "../../schemas/orm-model.property-classes.json" with { type: "json" };
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };

const CLASSES = new Set(["conceptual", "identity", "presentation"]);
const IDENTITY_NAMES = new Set(["id", "minted_from", "imports", "namespace", "orm_version"]);

const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const lastSegment = (pointer: string) =>
  pointer.slice(pointer.lastIndexOf("/") + 1).replace(/~1/g, "/").replace(/~0/g, "~");

/**
 * Every `properties` map at any depth and every slot in it. The walk
 * descends through every key rather than a list of schema keywords, so a
 * map under a keyword nobody thought to list (`patternProperties`, a new
 * `anyOf`) is still reached. Inside a map the keys are property names, not
 * keywords: a property named `properties` is a slot, and its subschema is
 * walked like any other.
 */
function walkProperties(root: unknown): { maps: string[]; slots: string[]; } {
  const maps: string[] = [];
  const slots: string[] = [];
  const walk = (node: unknown, pointer: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${pointer}/${i}`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const at = `${pointer}/${escape(key)}`;
      if (
        key === "properties" && value !== null && typeof value === "object" && !Array.isArray(value)
      ) {
        maps.push(at);
        for (const [name, sub] of Object.entries(value)) {
          slots.push(`${at}/${escape(name)}`);
          walk(sub, `${at}/${escape(name)}`);
        }
      } else {
        walk(value, at);
      }
    }
  };
  walk(root, "");
  return { maps, slots };
}

/** Slots the table lacks, and rows naming no slot the schema defines. */
function compareTable(
  slots: readonly string[],
  rows: Readonly<Record<string, string>>,
): { unclassified: string[]; orphaned: string[]; } {
  const defined = new Set(slots);
  return {
    unclassified: slots.filter((slot) => !(slot in rows)),
    orphaned: Object.keys(rows).filter((row) => !defined.has(row)),
  };
}

const rows = table.slots as Record<string, string>;

describe("the walk over properties maps", () => {
  it("reaches a map under every place a subschema can sit", () => {
    const synthetic = {
      properties: { a: { type: "object", properties: { b: {} } } },
      definitions: {
        d: {
          oneOf: [{ properties: { c: {} } }],
          anyOf: [{ properties: { e: {} } }],
          allOf: [{ properties: { f: {} } }],
          // Parsed, as the schema is: an object literal with a `then` key
          // is a thenable, which an `await` would try to call.
          ...JSON.parse(
            `{"if": {"properties": {"g": {}}}, "then": {"properties": {"h": {}}}, "else": {"properties": {"i": {}}}}`,
          ),
        },
        list: { items: { properties: { j: {} } } },
        open: { additionalProperties: { properties: { k: {} } } },
        // A property named "properties" is a slot; "a/b" escapes to a~1b.
        odd: { properties: { properties: { properties: { l: {} } }, "a/b": {} } },
      },
    };
    const { maps, slots } = walkProperties(synthetic);
    expect(slots).toEqual([
      "/properties/a",
      "/properties/a/properties/b",
      "/definitions/d/oneOf/0/properties/c",
      "/definitions/d/anyOf/0/properties/e",
      "/definitions/d/allOf/0/properties/f",
      "/definitions/d/if/properties/g",
      "/definitions/d/then/properties/h",
      "/definitions/d/else/properties/i",
      "/definitions/list/items/properties/j",
      "/definitions/open/additionalProperties/properties/k",
      "/definitions/odd/properties/properties",
      "/definitions/odd/properties/properties/properties/l",
      "/definitions/odd/properties/a~1b",
    ]);
    expect(maps).toHaveLength(12);
  });

  it("reports a slot the table lacks and a row with no slot", () => {
    expect(
      compareTable(["/properties/a", "/properties/b"], {
        "/properties/a": "conceptual",
        "/properties/z": "identity",
      }),
    )
      .toEqual({ unclassified: ["/properties/b"], orphaned: ["/properties/z"] });
  });
});

describe("orm-model.property-classes.json classifies every property the schema defines", () => {
  const { maps, slots } = walkProperties(schema);

  it("walks the whole schema: 40 maps, 194 slots", () => {
    // A walker that stops early would find fewer slots and agree with a
    // shorter table. A schema change that adds or removes a map or slot
    // updates these two numbers in the same commit as the table.
    expect(maps).toHaveLength(40);
    expect(slots).toHaveLength(194);
  });

  it("has a class for every slot and a slot for every row [adr:metamodel-evolution-policy#recompute-derived]", () => {
    expect(compareTable(slots, rows)).toEqual({ unclassified: [], orphaned: [] });
  });

  it("uses only the three classes, and identity only for the identity names [adr:metamodel-evolution-policy#recompute-derived]", () => {
    const misclassed = Object.entries(rows).filter(([pointer, cls]) =>
      !CLASSES.has(cls) || (cls === "identity") !== IDENTITY_NAMES.has(lastSegment(pointer))
    );
    expect(misclassed).toEqual([]);
  });
});
