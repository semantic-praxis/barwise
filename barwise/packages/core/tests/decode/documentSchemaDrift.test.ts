/**
 * The document Schema and the shipped JSON Schema state the same format
 * (docs/specs/effect-adoption.spec.md, 1r, R4): the root, the model's
 * header and lists, and the element kinds R4 added -- subtype facts,
 * objectifications, populations and their instances, definitions and
 * diagrams. Compared field by field, with which are required, their
 * numeric limits and enumerated values, and each list's items as the
 * element Schema the earlier steps' drift tests hold. Part C, which
 * generates the file, deletes this test.
 */
import type * as SchemaAST from "effect/SchemaAST";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { ExternalConstraintFile } from "../../src/decode/constraint.js";
import { DocumentFile, NAMESPACE_FILE_PATTERN } from "../../src/decode/document.js";
import { FactTypeFile } from "../../src/decode/factType.js";
import { ObjectTypeFile } from "../../src/decode/objectType.js";
import { fields, limitsOf, literalsOf } from "../helpers/schemaFields.js";

type JsonObject = {
  type?: string;
  properties?: Record<string, JsonObject>;
  required?: string[];
  items?: JsonObject;
  additionalProperties?: JsonObject | boolean;
  enum?: string[];
  const?: string;
  pattern?: string;
  minItems?: number;
  minLength?: number;
  $ref?: string;
};

const root = schema as unknown as JsonObject & { definitions: Record<string, JsonObject>; };
const defs = root.definitions;
const deref = (node: JsonObject): JsonObject =>
  node.$ref ? defs[node.$ref.replace("#/definitions/", "")]! : node;

const itemOf = (ast: SchemaAST.AST) => {
  if (ast._tag !== "Arrays") throw new Error(`not a list: ${ast._tag}`);
  return ast.rest[0]!;
};
/** A record's value Schema: `Record(String, X)`'s X. */
const valueOf = (ast: SchemaAST.AST) => {
  if (ast._tag !== "Objects" || ast.indexSignatures.length !== 1) {
    throw new Error(`not a record: ${ast._tag}`);
  }
  return ast.indexSignatures[0]!.type;
};

/** A field's numeric limits as the shipped file states them, in `limitsOf`'s shape. */
function jsonLimits(node: JsonObject): Record<string, unknown> {
  const n = deref(node);
  if (n.enum !== undefined || n.const !== undefined) return {};
  switch (n.type) {
    case "array":
      return { minItems: n.minItems ?? 0, items: jsonLimits(n.items!) };
    case "string":
      return { minLength: n.minLength ?? 0 };
    default:
      return {};
  }
}

const document = fields(DocumentFile.ast);
const modelAst = document.byName.get("model")!;
const model = fields(modelAst);
const listItem = (name: string) => itemOf(model.byName.get(name)!);
const population = fields(listItem("populations"));
const diagram = fields(listItem("diagrams"));

/** Each struct R4 states, beside the definition it copies. */
const STRUCTS: [string, JsonObject, SchemaAST.AST][] = [
  ["model", root.properties!.model!, modelAst],
  ["subtype_fact", defs.subtype_fact!, listItem("subtype_facts")],
  ["objectified_fact_type", defs.objectified_fact_type!, listItem("objectified_fact_types")],
  ["population", defs.population!, listItem("populations")],
  ["fact_instance", defs.fact_instance!, itemOf(population.byName.get("instances")!)],
  ["definition", defs.definition!, listItem("definitions")],
  ["diagram_layout", defs.diagram_layout!, listItem("diagrams")],
  [
    "a diagram position",
    defs.diagram_layout!.properties!.positions!.additionalProperties as JsonObject,
    valueOf(diagram.byName.get("positions")!),
  ],
];

describe("the document Schema states what the shipped JSON Schema states", () => {
  it("the root: its version and its model, both required", () => {
    expect(document.allowed).toEqual(Object.keys(root.properties!).sort());
    expect(document.required).toEqual([...root.required!].sort());
    expect(literalsOf(document.byName.get("orm_version")!)).toEqual([
      root.properties!.orm_version!.const,
    ]);
  });

  it.each(STRUCTS)("%s: its fields, and which are required", (_, def, ast) => {
    const f = fields(ast);
    expect(f.allowed).toEqual(Object.keys(def.properties!).sort());
    expect(f.refused).toEqual([]);
    expect(f.required).toEqual([...(def.required ?? [])].sort());
  });

  it.each(STRUCTS)("%s: each field's numeric limits", (name, def, ast) => {
    const f = fields(ast);
    for (const [field, node] of Object.entries(def.properties!)) {
      const n = deref(node);
      // Lists of elements are each held by their own element's test.
      if (n.type === "object" || (n.type === "array" && deref(n.items!).type === "object")) {
        continue;
      }
      expect([name, field, limitsOf(f.byName.get(field)!)]).toEqual([
        name,
        field,
        jsonLimits(node),
      ]);
    }
  });

  it("each list of the model holds its element's Schema", () => {
    expect(itemOf(model.byName.get("object_types")!)).toBe(ObjectTypeFile.ast);
    expect(itemOf(model.byName.get("fact_types")!)).toBe(FactTypeFile.ast);
    expect(itemOf(model.byName.get("constraints")!)).toBe(ExternalConstraintFile.ast);
    for (const [list, def] of Object.entries(root.properties!.model!.properties!)) {
      if (deref(def).type !== "array") continue;
      expect([list, model.byName.has(list)]).toEqual([list, true]);
    }
  });

  it("the namespace's pattern, and a diagram's orientations", () => {
    expect(NAMESPACE_FILE_PATTERN.source).toBe(
      root.properties!.model!.properties!.namespace!.pattern,
    );
    const orientations = valueOf(diagram.byName.get("orientations")!);
    const def = defs.diagram_layout!.properties!.orientations!.additionalProperties as JsonObject;
    expect(literalsOf(orientations)).toEqual(def.enum);
  });
});
