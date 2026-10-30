/**
 * The fact type Schema and the shipped JSON Schema state the same format
 * (docs/specs/effect-adoption.spec.md, 1r, R3): a copy that must agree with
 * the other until part C generates the file, which deletes this test.
 * Compared for the fact type, its role and its derivation: the fields,
 * which are required, the enumerated values and the numeric limits; and a
 * fact type's constraints are R2's internal list, which
 * `constraintSchemaDrift.test.ts` holds.
 */
import type * as SchemaAST from "effect/SchemaAST";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { InternalConstraintFile } from "../../src/decode/constraint.js";
import { FactTypeFile } from "../../src/decode/factType.js";
import { fields, limitsOf, literalsOf } from "../helpers/schemaFields.js";

type JsonObject = {
  type?: string;
  properties?: Record<string, JsonObject>;
  required?: string[];
  items?: JsonObject;
  enum?: string[];
  minItems?: number;
  minLength?: number;
  $ref?: string;
};

const defs = schema.definitions as unknown as Record<string, JsonObject>;
const deref = (node: JsonObject): JsonObject =>
  node.$ref ? defs[node.$ref.replace("#/definitions/", "")]! : node;

/** A field's numeric limits as the shipped file states them, in `limitsOf`'s shape. */
function jsonLimits(node: JsonObject): Record<string, unknown> {
  const n = deref(node);
  if (n.enum !== undefined) return {};
  switch (n.type) {
    case "array":
      return { minItems: n.minItems ?? 0, items: jsonLimits(n.items!) };
    case "string":
      return { minLength: n.minLength ?? 0 };
    default:
      return {};
  }
}

const itemOf = (ast: SchemaAST.AST) => {
  if (ast._tag !== "Arrays") throw new Error(`not a list: ${ast._tag}`);
  return ast.rest[0]!;
};

const factType = fields(FactTypeFile.ast);
const STRUCTS: [string, JsonObject, SchemaAST.AST][] = [
  ["fact_type", defs.fact_type!, FactTypeFile.ast],
  ["role", defs.role!, itemOf(factType.byName.get("roles")!)],
  ["derivation_rule_def", defs.derivation_rule_def!, factType.byName.get("derivation")!],
];

describe("the fact type Schema states what the shipped JSON Schema states", () => {
  it.each(STRUCTS)("%s: its fields, and which are required", (_, def, ast) => {
    const f = fields(ast);
    expect(f.allowed).toEqual(Object.keys(def.properties!).sort());
    expect(f.refused).toEqual([]);
    expect(f.required).toEqual([...(def.required ?? [])].sort());
  });

  it.each(STRUCTS)("%s: each field's numeric limits", (name, def, ast) => {
    const f = fields(ast);
    for (const [field, node] of Object.entries(def.properties!)) {
      // Nested structs and the constraint list are compared on their own.
      if (deref(node).type === "object" || field === "constraints") continue;
      if (deref(node).type === "array" && deref(deref(node).items!).type === "object") {
        expect([name, field, (limitsOf(f.byName.get(field)!) as { minItems: number; }).minItems])
          .toEqual([name, field, deref(node).minItems ?? 0]);
        continue;
      }
      expect([name, field, limitsOf(f.byName.get(field)!)]).toEqual([
        name,
        field,
        jsonLimits(node),
      ]);
    }
  });

  it("the derivation's enumerated values", () => {
    const d = fields(factType.byName.get("derivation")!);
    const def = defs.derivation_rule_def!.properties!;
    expect(literalsOf(d.byName.get("kind")!)).toEqual(def.kind!.enum);
    expect(literalsOf(d.byName.get("storage")!)).toEqual(def.storage!.enum);
  });

  it("a fact type's constraints are the internal list", () => {
    const def = defs.fact_type!.properties!.constraints!;
    expect(def.items!.$ref).toBe("#/definitions/internal_constraint");
    expect(itemOf(factType.byName.get("constraints")!)).toBe(InternalConstraintFile.ast);
  });
});
