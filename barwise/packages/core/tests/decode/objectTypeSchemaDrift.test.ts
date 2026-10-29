/**
 * The object type Schema and the shipped JSON Schema state the same format
 * (docs/specs/effect-adoption.spec.md, 1r): each is a copy that must agree
 * with the other until part C generates the file from the Schema, which
 * deletes this test. Compared per variant and per nested definition: the
 * fields, which are required, which are refused, and the enumerated values.
 */
import type * as SchemaAST from "effect/SchemaAST";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { ObjectTypeFile } from "../../src/decode/objectType.js";

type JsonObject = {
  properties?: Record<string, unknown>;
  required?: string[];
  then?: { required?: string[]; properties?: Record<string, unknown>; };
  else?: { properties?: Record<string, unknown>; };
  $ref?: string;
};

const defs = schema.definitions as Record<string, JsonObject>;
const deref = (node: unknown): JsonObject => {
  const ref = (node as JsonObject).$ref;
  return ref ? defs[ref.replace("#/definitions/", "")]! : (node as JsonObject);
};

/** A struct's fields as the Schema states them. */
function fields(ast: SchemaAST.AST) {
  if (ast._tag !== "Objects") throw new Error(`not a struct: ${ast._tag}`);
  const all = ast.propertySignatures.map((ps) => ({
    name: String(ps.name),
    type: ps.type,
    optional: ps.type.context?.isOptional === true,
  }));
  return {
    allowed: all.filter((f) => f.type._tag !== "Never").map((f) => f.name).sort(),
    refused: all.filter((f) => f.type._tag === "Never").map((f) => f.name).sort(),
    required: all.filter((f) => !f.optional).map((f) => f.name).sort(),
    byName: new Map(all.map((f) => [f.name, f.type])),
  };
}

const variant = (kind: string) =>
  (ObjectTypeFile.ast.types as readonly SchemaAST.AST[]).find((m) =>
    m._tag === "Objects"
    && m.propertySignatures.some((ps) =>
      ps.name === "kind" && (ps.type as SchemaAST.Literal).literal === kind
    )
  )!;

const unwrap = (ast: SchemaAST.AST): SchemaAST.AST => (ast._tag === "Arrays" ? ast.rest[0]! : ast);

const objectType = defs.object_type!;
const props = Object.keys(objectType.properties!).sort();

describe("the object type Schema states what the shipped JSON Schema states", () => {
  it("an entity type's fields", () => {
    const f = fields(variant("entity"));
    const refusedByFile = Object.entries(objectType.then!.properties!)
      .filter(([, v]) => v === false).map(([k]) => k).sort();
    expect(f.allowed).toEqual(props.filter((p) => !refusedByFile.includes(p)));
    expect(f.refused).toEqual(refusedByFile);
    expect(f.required).toEqual([...objectType.required!, ...objectType.then!.required!].sort());
  });

  it("a value type's fields", () => {
    const f = fields(variant("value"));
    const refusedByFile = Object.entries(objectType.else!.properties!)
      .filter(([, v]) => v === false).map(([k]) => k);
    // The file schema allows a value type's reference mode and the
    // constructor refuses it; the Schema refuses it where the file is read.
    const refusedByConstructor = ["reference_mode"];
    expect(f.refused).toEqual([...refusedByFile, ...refusedByConstructor].sort());
    expect(f.allowed).toEqual(props.filter((p) => !f.refused.includes(p)));
    expect(f.required).toEqual([...objectType.required!].sort());
  });

  it("the nested definitions' fields", () => {
    const value = fields(variant("value"));
    const entity = fields(variant("entity"));
    const nested: [string, SchemaAST.AST][] = [
      ["data_type_def", value.byName.get("data_type")!],
      ["value_constraint_def", value.byName.get("value_constraint")!],
      ["cardinality_range_def", entity.byName.get("cardinality")!],
      [
        "value_range_def",
        unwrap(fields(value.byName.get("value_constraint")!).byName.get("ranges")!),
      ],
    ];
    for (const [name, ast] of nested) {
      const def = defs[name]!;
      const f = fields(ast);
      expect([name, f.allowed]).toEqual([name, Object.keys(def.properties!).sort()]);
      expect([name, f.required]).toEqual([name, [...(def.required ?? [])].sort()]);
    }
  });

  it("the enumerated values", () => {
    const kinds = (ObjectTypeFile.ast.types as readonly SchemaAST.AST[]).map((m) =>
      String((fields(m).byName.get("kind") as SchemaAST.Literal).literal)
    );
    expect(kinds.sort()).toEqual(
      [...(objectType.properties!.kind as { enum: string[]; }).enum].sort(),
    );
    const dataTypeName = fields(fields(variant("value")).byName.get("data_type")!).byName.get(
      "name",
    )!;
    const literals = (dataTypeName as SchemaAST.Union).types.map((t) =>
      String((t as SchemaAST.Literal).literal)
    );
    expect(literals).toEqual(
      (deref(defs.data_type_def!).properties!.name as { enum: string[]; }).enum,
    );
  });
});
