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
 * new row to review. What this cannot see is a derived slot added with a
 * `conceptual` row: that is held by review of the table's diff
 * (pr-review/checklist.md).
 *
 * The table is only an allowlist if nothing outside it can be written: an
 * open object schema would accept a derived key no row names. So the
 * schema's closedness is checked here too, with the data-keyed maps (whose
 * keys are ids or prefixes, not property names) listed by pointer.
 */
import { describe, expect, it } from "vitest";
import table from "../../schemas/orm-model.property-classes.json" with { type: "json" };
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };

/** The classes, and where each restricted one may be used. */
const CLASSES = new Set(["conceptual", "identity", "presentation"]);
// One-directional: a slot named `id` may still be another class, but only
// these names may be `identity`, so the class cannot launder a derived slot.
const IDENTITY_NAMES = new Set(["id", "minted_from", "imports", "namespace", "orm_version"]);
// Authored diagram layout and nothing else; a rendered artifact (an SVG, a
// computed route) labelled presentation elsewhere fails.
const PRESENTATION_UNDER = ["/properties/model/properties/diagrams", "/definitions/diagram_layout"];

/**
 * Maps whose keys are data the author chooses, so they are open by design:
 * `additionalProperties` holds the value schema. Any other object schema
 * is closed.
 */
const DATA_KEYED: Record<string, string> = {
  "/properties/model/properties/imports": "prefix -> namespace IRI; the prefixes are the author's",
  "/definitions/fact_instance/properties/role_values": "role id -> value",
  "/definitions/diagram_layout/properties/positions": "element id -> position",
  "/definitions/diagram_layout/properties/orientations": "fact type id -> orientation",
};

/** Keywords whose values are data, never subschemas. */
const DATA_KEYWORDS = new Set(["default", "const", "enum", "examples"]);
/** Keywords whose values map names to subschemas. */
const NAMED_SCHEMAS = new Set(["definitions", "$defs", "patternProperties", "dependentSchemas"]);
/**
 * Keywords that constrain properties defined elsewhere rather than define
 * them. A property only `then` names is refused by the closed schema that
 * holds the `if`, so these can restate a slot but never add one.
 */
const RESTATING = new Set(["if", "then", "else", "not"]);

const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const lastSegment = (pointer: string) =>
  pointer.slice(pointer.lastIndexOf("/") + 1).replace(/~1/g, "/").replace(/~0/g, "~");

type Visit = (node: Record<string, unknown>, pointer: string, defining: boolean) => void;

/**
 * Calls `visit` on every subschema, knowing which keyword values are
 * subschemas: names under `properties` and `definitions` are names, data
 * keywords are skipped, and a boolean schema has nothing under it.
 */
function eachSchema(root: unknown, visit: Visit): void {
  const walk = (node: unknown, pointer: string, defining: boolean): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    const schemaNode = node as Record<string, unknown>;
    visit(schemaNode, pointer, defining);
    for (const [key, value] of Object.entries(schemaNode)) {
      const at = `${pointer}/${escape(key)}`;
      if (DATA_KEYWORDS.has(key)) continue;
      const inner = defining && !RESTATING.has(key);
      if (key === "properties" || NAMED_SCHEMAS.has(key)) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
        for (const [name, sub] of Object.entries(value)) walk(sub, `${at}/${escape(name)}`, inner);
      } else if (Array.isArray(value)) {
        value.forEach((child, i) => walk(child, `${at}/${i}`, inner));
      } else {
        walk(value, at, inner);
      }
    }
  };
  walk(root, "", true);
}

/**
 * Every property slot the schema defines: a name under a `properties` map
 * outside a restating keyword, whose subschema is not `false` (a `false`
 * slot forbids the property; it defines nothing).
 */
function slotsOf(root: unknown): string[] {
  const slots: string[] = [];
  eachSchema(root, (node, pointer, defining) => {
    const props = node.properties;
    if (!defining || props === null || typeof props !== "object" || Array.isArray(props)) return;
    for (const [name, sub] of Object.entries(props)) {
      if (sub !== false) slots.push(`${pointer}/properties/${escape(name)}`);
    }
  });
  return slots;
}

/**
 * Schemas that would accept a key no slot names: an object schema (one
 * declaring `properties` or `type: object`) without `additionalProperties:
 * false`, any `additionalProperties` other than `false`, and any
 * `patternProperties`, outside the data-keyed maps. An object schema that
 * declares no properties and delegates to `oneOf`/`anyOf` branches is
 * closed by its branches, which are checked themselves.
 */
function openSchemas(root: unknown, dataKeyed: Readonly<Record<string, string>>): string[] {
  const open: string[] = [];
  eachSchema(root, (node, pointer, defining) => {
    if ("patternProperties" in node) open.push(`${pointer}/patternProperties`);
    if (pointer in dataKeyed) return;
    const ap = node.additionalProperties;
    if (ap !== undefined && ap !== false) open.push(`${pointer}/additionalProperties`);
    const types = Array.isArray(node.type) ? node.type : [node.type];
    const objectShaped = "properties" in node || types.includes("object");
    const delegated = !("properties" in node) && ("oneOf" in node || "anyOf" in node);
    if (defining && objectShaped && !delegated && ap === undefined) open.push(pointer || "/");
  });
  return open;
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

/** Rows whose class is unknown or used where the ADR does not allow it. */
function misclassed(rows: Readonly<Record<string, string>>): string[] {
  return Object.entries(rows)
    .filter(([pointer, cls]) =>
      !CLASSES.has(cls)
      || (cls === "identity" && !IDENTITY_NAMES.has(lastSegment(pointer)))
      || (cls === "presentation"
        && !PRESENTATION_UNDER.some((at) => pointer === at || pointer.startsWith(`${at}/`)))
    )
    .map(([pointer, cls]) => `${pointer}: ${cls}`);
}

const rows = table.slots as Record<string, string>;

describe("the walk over a schema", () => {
  it("finds a slot under every place a defining subschema can sit, and none elsewhere", () => {
    // Parsed, as the schema is: an object literal with a `then` key is a
    // thenable, which an `await` would try to call.
    const synthetic: unknown = JSON.parse(`{
      "properties": { "a": { "type": "object", "properties": { "b": {} } } },
      "definitions": {
        "d": {
          "oneOf": [{ "properties": { "c": {} } }],
          "anyOf": [{ "properties": { "e": {} } }],
          "allOf": [{ "properties": { "f": {} } }],
          "if": { "properties": { "g": {} } },
          "then": { "properties": { "h": {}, "deep": { "properties": { "h2": {} } } } },
          "else": { "properties": { "i": {} } },
          "not": { "properties": { "n": {} } }
        },
        "list": { "items": { "properties": { "j": {} } } },
        "open": { "additionalProperties": { "properties": { "k": {} } } },
        "odd": { "properties": { "properties": { "properties": { "l": {} } }, "a/b": {} } },
        "properties": { "properties": { "m": {} } },
        "forbids": { "properties": { "gone": false, "kept": {} } },
        "data": {
          "default": { "properties": { "x1": {} } },
          "const": { "properties": { "x2": {} } },
          "enum": [{ "properties": { "x3": {} } }],
          "examples": [{ "properties": { "x4": {} } }]
        }
      }
    }`);
    expect(slotsOf(synthetic)).toEqual([
      "/properties/a",
      "/properties/a/properties/b",
      "/definitions/d/oneOf/0/properties/c",
      "/definitions/d/anyOf/0/properties/e",
      "/definitions/d/allOf/0/properties/f",
      "/definitions/list/items/properties/j",
      "/definitions/open/additionalProperties/properties/k",
      // A property named "properties" is a slot; "a/b" escapes to a~1b.
      "/definitions/odd/properties/properties",
      "/definitions/odd/properties/a~1b",
      "/definitions/odd/properties/properties/properties/l",
      // A definition named "properties" is a name, not the keyword.
      "/definitions/properties/properties/m",
      "/definitions/forbids/properties/kept",
    ]);
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

  it("allows identity only for identity names, one way, and presentation only under the layout", () => {
    expect(misclassed({
      "/definitions/x/properties/id": "conceptual",
      "/definitions/x/properties/minted_from": "identity",
      "/definitions/x/properties/svg": "identity",
      "/definitions/diagram_layout/properties/positions": "presentation",
      "/properties/model/properties/diagrams": "presentation",
      "/definitions/x/properties/rendered_svg": "presentation",
      "/definitions/diagram_layout_copy/properties/a": "presentation",
      "/definitions/x/properties/ddl": "derived",
    })).toEqual([
      "/definitions/x/properties/svg: identity",
      "/definitions/x/properties/rendered_svg: presentation",
      "/definitions/diagram_layout_copy/properties/a: presentation",
      "/definitions/x/properties/ddl: derived",
    ]);
  });

  it("reports an open object, an open additionalProperties and patternProperties", () => {
    const synthetic: unknown = JSON.parse(`{
      "type": "object", "additionalProperties": false,
      "properties": {
        "closed": { "type": "object", "additionalProperties": false, "properties": { "a": {} } },
        "unstated": { "type": "object", "properties": { "b": {} } },
        "bare": { "type": "object" },
        "loose": { "additionalProperties": true },
        "pattern": { "type": "object", "additionalProperties": false, "patternProperties": { "^x-": {} } },
        "keyed": { "type": "object", "additionalProperties": { "type": "string" } },
        "branches": { "type": "object", "oneOf": [{ "additionalProperties": false, "properties": { "c": {} } }] },
        "restated": { "type": "object", "additionalProperties": false, "properties": { "d": {} },
          "if": { "properties": { "d": { "const": 1 } } } }
      }
    }`);
    expect(openSchemas(synthetic, { "/properties/keyed": "id -> value" })).toEqual([
      "/properties/unstated",
      "/properties/bare",
      "/properties/loose/additionalProperties",
      "/properties/pattern/patternProperties",
    ]);
  });
});

describe("orm-model.property-classes.json classifies every property the schema defines", () => {
  const slots = slotsOf(schema);

  it("has a class for every slot and a slot for every row [adr:metamodel-evolution-policy#recompute-derived]", () => {
    expect(compareTable(slots, rows)).toEqual({ unclassified: [], orphaned: [] });
  });

  it("uses only the three classes, identity only for identity names and presentation only for diagram layout [adr:metamodel-evolution-policy#recompute-derived]", () => {
    expect(misclassed(rows)).toEqual([]);
  });

  it("is closed outside the data-keyed maps, so no key can be written that the table does not name [adr:metamodel-evolution-policy#recompute-derived]", () => {
    expect(openSchemas(schema, DATA_KEYED)).toEqual([]);
    // Each exception is a real open map, so the list cannot outlive one.
    const stale = Object.keys(DATA_KEYED).filter((pointer) => {
      const node = pointer.split("/").slice(1).reduce<unknown>(
        (at, key) =>
          (at as Record<string, unknown> | undefined)
            ?.[key.replace(/~1/g, "/").replace(/~0/g, "~")],
        schema,
      ) as Record<string, unknown> | undefined;
      return node === undefined || typeof node.additionalProperties !== "object";
    });
    expect(stale).toEqual([]);
  });
});
