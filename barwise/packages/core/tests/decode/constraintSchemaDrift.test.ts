/**
 * The constraint Schemas and the shipped JSON Schema state the same format
 * (docs/specs/effect-adoption.spec.md, 1r, R2): each is a copy that must
 * agree with the other until part C generates the file from the Schemas,
 * which deletes this test. Compared kind by kind -- the fields, which are
 * required, and the enumerated values -- for the nested definitions a
 * constraint holds, and for the two lists, which kinds each accepts.
 */
import type * as SchemaAST from "effect/SchemaAST";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import {
  CONSTRAINT_KIND_FILES,
  ExternalConstraintFile,
  InternalConstraintFile,
} from "../../src/decode/constraint.js";
import { markOf } from "../../src/decode/harness.js";
import { fields, limitsOf, literalsOf } from "../helpers/schemaFields.js";

type JsonObject = {
  type?: string;
  properties?: Record<string, JsonObject & { const?: string; enum?: string[]; }>;
  required?: string[];
  oneOf?: JsonObject[];
  items?: JsonObject;
  enum?: string[];
  const?: string;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  $ref?: string;
};

const defs = schema.definitions as unknown as Record<string, JsonObject>;
const deref = (node: JsonObject): JsonObject =>
  node.$ref ? defs[node.$ref.replace("#/definitions/", "")]! : node;

/** Each kind's branch of the shipped file's two constraint lists. */
const branches = new Map(
  ["internal_constraint", "external_constraint"].flatMap((list) =>
    defs[list]!.oneOf!.map((branch) => [branch.properties!.type!.const!, branch] as const)
  ),
);

type Kind = keyof typeof CONSTRAINT_KIND_FILES;
const KINDS = Object.keys(CONSTRAINT_KIND_FILES) as Kind[];
const kindAst = (k: Kind) => CONSTRAINT_KIND_FILES[k].ast;

/** A field's numeric limits as the shipped file states them, in `limitsOf`'s shape. */
function jsonLimits(node: JsonObject): Record<string, unknown> {
  const n = deref(node);
  if (n.enum !== undefined || n.const !== undefined) return {};
  if (n.oneOf) {
    const integer = n.oneOf.find((b) => b.type === "integer");
    return integer ? jsonLimits(integer) : {};
  }
  switch (n.type) {
    case "array":
      return { minItems: n.minItems ?? 0, items: jsonLimits(n.items!) };
    case "string":
      return { minLength: n.minLength ?? 0 };
    case "integer":
      return { minimum: n.minimum };
    default:
      return {};
  }
}

/** The kinds a list's Schema accepts: every member not refused by placement. */
function accepted(list: SchemaAST.AST): string[] {
  if (list._tag !== "Union") throw new Error(`not a union: ${list._tag}`);
  return list.types
    .filter((m) => !(m.checks ?? []).some((c) => markOf(c)?.id === "constraint-placement"))
    .map((m) => literalsOf(fields(m).byName.get("type")!)[0]!)
    .sort();
}

describe("the constraint Schemas state what the shipped JSON Schema states", () => {
  it("one kind for each branch of the two lists, and no other", () => {
    expect([...KINDS].sort()).toEqual([...branches.keys()].sort());
  });

  it.each(KINDS.map((k) => [k] as const))("%s: its fields, and which are required", (k) => {
    const f = fields(kindAst(k));
    const branch = branches.get(k)!;
    expect(f.allowed).toEqual(Object.keys(branch.properties!).sort());
    expect(f.refused).toEqual([]);
    expect(f.required).toEqual([...branch.required!].sort());
  });

  it("which kinds each list accepts", () => {
    const consts = (list: string) =>
      defs[list]!.oneOf!.map((b) => b.properties!.type!.const!).sort();
    expect(accepted(InternalConstraintFile.ast)).toEqual(consts("internal_constraint"));
    expect(accepted(ExternalConstraintFile.ast)).toEqual(consts("external_constraint"));
  });

  it("the enumerated values", () => {
    for (const k of KINDS) {
      const branch = branches.get(k)!;
      const f = fields(kindAst(k));
      expect([k, literalsOf(f.byName.get("modality")!)]).toEqual([
        k,
        branch.properties!.modality!.enum,
      ]);
      for (const field of ["ring_type", "operator"]) {
        if (!f.byName.has(field)) continue;
        expect([k, field, literalsOf(f.byName.get(field)!)]).toEqual([
          k,
          field,
          deref(branch.properties![field]!).enum,
        ]);
      }
    }
  });

  it.each(KINDS.map((k) => [k] as const))("%s: each field's numeric limits", (k) => {
    const f = fields(kindAst(k));
    for (const [name, def] of Object.entries(branches.get(k)!.properties!)) {
      expect([k, name, limitsOf(f.byName.get(name)!)]).toEqual([k, name, jsonLimits(def)]);
    }
  });

  it("the nested definitions' numeric limits", () => {
    const operand = fields(kindAst("join_ring")).byName.get("operand")!;
    const path = fields(operand).byName.get("path")!;
    const step = (fields(path).byName.get("steps")! as SchemaAST.Arrays).rest[0]!;
    const nested: [string, JsonObject, SchemaAST.AST][] = [
      ["join_operand_def", defs.join_operand_def!, operand],
      ["role_path_def", defs.role_path_def!, path],
      ["role_path_def steps", defs.role_path_def!.properties!.steps!.items!, step],
    ];
    for (const [name, def, ast] of nested) {
      const f = fields(ast);
      for (const [field, node] of Object.entries(def.properties!)) {
        if (deref(node).type === "object") continue;
        expect([name, field, limitsOf(f.byName.get(field)!)]).toEqual([
          name,
          field,
          jsonLimits(node),
        ]);
      }
    }
  });

  it("the nested definitions' fields", () => {
    const operand = fields(kindAst("join_ring")).byName.get("operand")!;
    const path = fields(operand).byName.get("path")!;
    const steps = fields(path).byName.get("steps")!;
    const ranges = fields(kindAst("value_constraint")).byName.get("ranges")!;
    const itemOf = (ast: SchemaAST.AST) => {
      if (ast._tag !== "Arrays") throw new Error(`not a list: ${ast._tag}`);
      return ast.rest[0]!;
    };
    const nested: [string, JsonObject, SchemaAST.AST][] = [
      ["join_operand_def", defs.join_operand_def!, operand],
      ["role_path_def", defs.role_path_def!, path],
      ["role_path_def steps", defs.role_path_def!.properties!.steps!.items!, itemOf(steps)],
      ["value_range_def", defs.value_range_def!, itemOf(ranges)],
    ];
    for (const [name, def, ast] of nested) {
      const f = fields(ast);
      expect([name, f.allowed]).toEqual([name, Object.keys(def.properties!).sort()]);
      expect([name, f.required]).toEqual([name, [...(def.required ?? [])].sort()]);
    }
    // Every operand-bearing kind holds the one operand Schema.
    for (const [k, field] of [["join_subset", "subset"], ["join_subset", "superset"]] as const) {
      expect([k, field, fields(kindAst(k)).byName.get(field)]).toEqual([k, field, operand]);
    }
    for (const k of ["join_equality", "join_exclusion"] as const) {
      expect([k, itemOf(fields(kindAst(k)).byName.get("operands")!)]).toEqual([k, operand]);
    }
  });
});
