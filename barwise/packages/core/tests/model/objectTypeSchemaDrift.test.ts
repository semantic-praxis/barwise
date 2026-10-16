/**
 * The JSON Schema's `object_type` against the decoder's schema (G3 of
 * docs/specs/effect-comparison.spec.md).
 *
 * The JSON Schema stays hand-written: it is draft-07 with an `if`/`then` on
 * `kind` and descriptions the editor shows, and what Effect generates is
 * draft 2020-12 with an `anyOf` and none of them, so generating it would
 * change what every editor and LLM caller sees. Two statements of one object
 * type, then, and this test compares them: it generates the decoder's JSON
 * Schema, reduces both to the facts a file is held to (which fields each
 * kind may carry, must carry and must not carry, and each field's type,
 * enum and minimum), and requires the differences to be exactly the ones
 * listed below. A field added to one side, an enum member dropped from
 * either, or a known difference closed without updating the list fails here.
 *
 * Keywords that are not compared, and why: `description` (prose);
 * `minLength`, `minItems` and the `anyOf` of required keys in a value
 * constraint and a range (the decoder states those rules as checks the
 * generator cannot render, and they are pinned by the D2 fixtures and the
 * decoder's own tests); `additionalProperties` (the decoder refuses unknown
 * keys through a parse option, not the schema); `maximum` (Effect's
 * safe-integer bound).
 *
 * The hand-written input types, `ObjectTypeConfig` and `OrmYamlObjectType`,
 * are held to the decoder's keys at compile time, beside their declarations.
 */
import * as Schema from "effect/Schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ObjectTypeYamlCodec } from "../../src/model/objectTypeSchema.js";

type Node = Record<string, unknown> | boolean;

const fileSchema = JSON.parse(
  readFileSync(new URL("../../schemas/orm-model.schema.json", import.meta.url), "utf8"),
) as { definitions: Record<string, Record<string, unknown>>; };

/** The comparable facts of one schema node; `"forbidden"` for a field that may not appear. */
function facts(node: Node, defs: Record<string, Record<string, unknown>>): unknown {
  if (node === false) return "forbidden";
  if (node === true) return "anything";
  if (typeof node.$ref === "string") {
    return facts(defs[node.$ref.replace("#/definitions/", "")]!, defs);
  }
  if (node.not !== undefined && Object.keys(node.not as object).length === 0) return "forbidden";
  const alternatives = (node.anyOf ?? node.oneOf) as Node[] | undefined;
  if (alternatives && node.type === undefined) {
    return { anyOf: alternatives.map((a) => facts(a, defs)).sort(byJson) };
  }
  if (node.type === "object") {
    const properties = (node.properties ?? {}) as Record<string, Node>;
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.keys(properties).sort().map((k) => [k, facts(properties[k]!, defs)]),
      ),
      required: Object.fromEntries(((node.required ?? []) as string[]).map((k) => [k, true])),
    };
  }
  if (node.type === "array") return { type: "array", items: facts(node.items as Node, defs) };
  const out: Record<string, unknown> = { type: node.type };
  const values = node.enum ?? (node.const !== undefined ? [node.const] : undefined);
  if (values !== undefined) out.enum = [...(values as unknown[])].sort();
  if (node.minimum !== undefined) out.minimum = node.minimum;
  return out;
}

const byJson = (a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b));

/**
 * The file's object type, as it reads for one kind. The `then` branch is the
 * entity variant only if `if` selects entities, and the kind enum must list
 * both kinds. Both are asserted, so a schema change that breaks either one
 * fails here instead of passing unseen.
 */
function fileVariant(kind: "entity" | "value", schema: typeof fileSchema = fileSchema) {
  const ot = schema.definitions.object_type!;
  expect((ot.if as { properties: { kind: { const: string; }; }; }).properties.kind.const).toBe(
    "entity",
  );
  expect([...(ot.properties as { kind: { enum: string[]; }; }).kind.enum].sort()).toEqual([
    "entity",
    "value",
  ]);
  const then = ot.then as { required: string[]; properties: Record<string, Node>; };
  const properties = { ...(ot.properties as Record<string, Node>) };
  let required = [...(ot.required as string[])];
  if (kind === "entity") {
    Object.assign(properties, then.properties);
    required = [...required, ...then.required];
  }
  properties.kind = { type: "string", const: kind };
  return facts({ type: "object", properties, required }, schema.definitions);
}

/** The decoder's object type, as it reads for one kind. */
function decoderVariant(kind: "entity" | "value") {
  const doc = Schema.toJsonSchemaDocument(ObjectTypeYamlCodec);
  const members = (doc.schema as { anyOf: Record<string, unknown>[]; }).anyOf;
  const member = members.find((m) =>
    (m.properties as Record<string, { enum: string[]; }>).kind.enum[0] === kind
  )!;
  return facts(member, {});
}

/** Every path at which two fact trees differ. */
function differences(a: unknown, b: unknown, path: string): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObject = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObject(a) || !isObject(b)) return [path];
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  return [...keys].sort().flatMap((k) =>
    differences(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      `${path}.${k}`,
    )
  );
}

/**
 * Where the two are meant to differ. Each entry must still be a difference:
 * one that closes fails the test until it is removed here.
 */
const KNOWN: Record<string, string> = {
  "value.properties.reference_mode":
    "the file schema allows a reference mode on a value type and the decoder refuses it, as createObjectType always did",
};

describe("the JSON Schema's object_type and the decoder's", () => {
  it.each(["entity", "value"] as const)(
    "hold a %s type to the same facts, but for the known differences",
    (kind) => {
      const found = differences(fileVariant(kind), decoderVariant(kind), kind);
      const known = Object.keys(KNOWN).filter((path) => path.startsWith(`${kind}.`));
      expect(found.sort()).toEqual(known.sort());
    },
  );

  it("sees a data type dropped from the file schema", () => {
    // The comparison is only worth having if it reaches the leaves: drop the
    // member barwise-0lf found unchecked, and the difference must name it.
    const dataType = fileSchema.definitions.data_type_def as {
      properties: { name: { enum: string[]; }; };
    };
    const original = dataType.properties.name.enum;
    dataType.properties.name.enum = original.filter((n) => n !== "other");
    try {
      expect(differences(fileVariant("value"), decoderVariant("value"), "value")).toContain(
        "value.properties.data_type.properties.name.enum",
      );
    } finally {
      dataType.properties.name.enum = original;
    }
  });
});

describe("the file schema reads as two variants only under the conditions the guard checks", () => {
  it("refuses a kind enum that drops a kind", () => {
    const edited = structuredClone(fileSchema);
    edited.definitions.object_type.properties.kind.enum = ["entity"];
    expect(() => fileVariant("value", edited)).toThrow();
  });

  it("refuses a kind enum that adds a kind", () => {
    const edited = structuredClone(fileSchema);
    edited.definitions.object_type.properties.kind.enum = ["entity", "value", "both"];
    expect(() => fileVariant("value", edited)).toThrow();
  });

  it("refuses an if that selects the wrong kind", () => {
    const edited = structuredClone(fileSchema);
    edited.definitions.object_type.if.properties.kind.const = "value";
    expect(() => fileVariant("entity", edited)).toThrow();
  });
});

describe("the required entries are compared field by field", () => {
  it("sees a required field the file schema adds to an entity", () => {
    const edited = structuredClone(fileSchema);
    edited.definitions.object_type.then.required = [
      ...edited.definitions.object_type.then.required,
      "bogus",
    ];
    const found = differences(fileVariant("entity", edited), decoderVariant("entity"), "entity");
    expect(found).toContain("entity.required.bogus");
  });
});
