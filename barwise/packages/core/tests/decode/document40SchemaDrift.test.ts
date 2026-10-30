/**
 * The 4.0 decoders and `schemas/orm-model-4.0.schema.json` state the same
 * format (iri-identity WS6, 6b-2b-1): each element's fields and which are
 * required, every constraint kind's, the id patterns (`model/name.ts`
 * states them once; the file must hold the same sources), and, because a
 * pattern inside an Effect filter cannot be read back, a corpus of
 * documents both must accept or refuse alike.
 */
import Ajv from "ajv";
import type * as SchemaAST from "effect/SchemaAST";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/orm-model-4.0.schema.json" with { type: "json" };
import { constraintKindFiles } from "../../src/decode/constraint.js";
import { DecodeError } from "../../src/decode/decoder.js";
import { Document40File, runDocument40Decode } from "../../src/decode/document40.js";
import { IDS_40 } from "../../src/decode/ids.js";
import {
  INSTANCE_ID_PATTERN,
  LOCAL_NAME_PATTERN,
  REFERENCE_PATTERN,
  ROLE_ID_PATTERN,
} from "../../src/model/name.js";
import { fields } from "../helpers/schemaFields.js";

type JsonObject = {
  type?: string;
  properties?: Record<string, JsonObject>;
  required?: string[];
  items?: JsonObject;
  oneOf?: JsonObject[];
  const?: string;
  pattern?: string;
  $ref?: string;
};

const root = schema as unknown as JsonObject & { definitions: Record<string, JsonObject>; };
const defs = root.definitions;

const itemOf = (ast: SchemaAST.AST) => {
  if (ast._tag !== "Arrays") throw new Error(`not a list: ${ast._tag}`);
  return ast.rest[0]!;
};

const document = fields(Document40File.ast);
const model = fields(document.byName.get("model")!);
const listItem = (name: string) => itemOf(model.byName.get(name)!);
const population = fields(listItem("populations"));
const factType = fields(listItem("fact_types"));

const STRUCTS: [string, JsonObject, SchemaAST.AST][] = [
  ["model", root.properties!.model!, document.byName.get("model")!],
  ["fact_type", defs.fact_type!, listItem("fact_types")],
  ["role", defs.role!, itemOf(factType.byName.get("roles")!)],
  ["subtype_fact", defs.subtype_fact!, listItem("subtype_facts")],
  ["objectified_fact_type", defs.objectified_fact_type!, listItem("objectified_fact_types")],
  ["population", defs.population!, listItem("populations")],
  ["fact_instance", defs.fact_instance!, itemOf(population.byName.get("instances")!)],
  ["diagram_layout", defs.diagram_layout!, listItem("diagrams")],
];

const kinds = constraintKindFiles(IDS_40);
const VARIANTS: [string, JsonObject][] = [
  ...defs.internal_constraint!.oneOf!,
  ...defs.external_constraint!.oneOf!,
].map((v) => [v.properties!.type!.const!, v]);

describe("the 4.0 decoders state what orm-model-4.0.schema.json states", () => {
  it("the root: its version and its model", () => {
    expect(document.allowed).toEqual(Object.keys(root.properties!).sort());
    expect(document.required).toEqual([...root.required!].sort());
  });

  it.each(STRUCTS)("%s: its fields, and which are required", (_, def, ast) => {
    const f = fields(ast);
    expect(f.allowed).toEqual(Object.keys(def.properties!).sort());
    expect(f.required).toEqual([...(def.required ?? [])].sort());
  });

  it.each(VARIANTS)("the %s constraint: its fields, and which are required", (kind, def) => {
    const f = fields(kinds[kind as keyof typeof kinds].ast);
    expect(f.allowed).toEqual(Object.keys(def.properties!).sort());
    expect(f.required).toEqual([...(def.required ?? [])].sort());
  });

  it("the id patterns are model/name.ts's", () => {
    expect(defs.local_name!.pattern).toBe(LOCAL_NAME_PATTERN.source);
    expect(defs.reference!.pattern).toBe(REFERENCE_PATTERN.source);
    expect(defs.role_id!.pattern).toBe(ROLE_ID_PATTERN.source);
    expect(defs.population_id!.pattern).toBe(ROLE_ID_PATTERN.source);
    expect(defs.instance_id!.pattern).toBe(INSTANCE_ID_PATTERN.source);
  });
});

/** A small valid 4.0 document, built fresh for each case to change. */
function base(): Record<string, any> {
  return {
    orm_version: "4.0",
    model: {
      name: "M",
      imports: { crm: "Crm" },
      object_types: [
        { id: "Person", name: "Person", kind: "entity", reference_mode: "nr" },
        { id: "crm:Customer", name: "Customer", kind: "entity", reference_mode: "id" },
      ],
      fact_types: [{
        id: "Person_smokes",
        name: "Person smokes",
        roles: [{ id: "Person_smokes.smokes", player: "Person", role_name: "smokes" }],
        readings: ["{0} smokes"],
        constraints: [{ type: "mandatory", role: "Person_smokes.smokes" }],
      }],
      subtype_facts: [{ subtype: "crm:Customer", supertype: "Person" }],
      populations: [{
        id: "Person_smokes.population",
        fact_type: "Person_smokes",
        instances: [{
          id: "Person_smokes.population.1",
          role_values: { "Person_smokes.smokes": "p1" },
        }],
      }],
      diagrams: [{ name: "Main", elements: ["Person", "crm:Customer"] }],
    },
  };
}

/** A join ring over one hop, its step's roles and root as given. */
const joinRing = (role: string, root = "Person") => ({
  type: "join_ring",
  operand: { path: { root, steps: [{ entry: role, exit: role }] }, projection: [0, 1] },
  ring_type: "irreflexive",
});

const CASES: [string, (d: Record<string, any>) => void, boolean][] = [
  ["the base document", () => {}, true],
  ["a stated constraint id", (d) => (d.model.fact_types[0].constraints[0].id = "Each_P"), true],
  ["minted_from beside an id", (d) => {
    Object.assign(d.model.fact_types[0].constraints[0], { id: "Each_P", minted_from: "k" });
  }, true],
  ["minted_from with no id", (d) => (d.model.subtype_facts[0].minted_from = "k"), false],
  ["a UUID role id", (d) => {
    d.model.fact_types[0].roles[0].id = "0193c8e2-6f4b-7c3a-9d1e-2b4f6a8c0e12";
  }, false],
  ["a role id of three parts", (d) => (d.model.fact_types[0].roles[0].id = "a.b.c"), false],
  ["a fact type id with a dot", (d) => (d.model.fact_types[0].id = "Person.smokes"), false],
  ["a space in an object type id", (d) => (d.model.object_types[0].id = "Per son"), false],
  ["an alias on a fact type id", (d) => (d.model.fact_types[0].id = "crm:Smokes"), false],
  ["two aliases", (d) => (d.model.subtype_facts[0].subtype = "a:b:c"), false],
  ["a no-break space in an id", (d) => (d.model.object_types[0].id = "Per\u00A0son"), false],
  ["a lower-case escape", (d) => (d.model.object_types[0].id = "v1%2e2"), false],
  ["a population id of one part", (d) => (d.model.populations[0].id = "pop"), false],
  ["an instance id of two parts", (d) => {
    d.model.populations[0].instances[0].id = "Person_smokes.1";
  }, false],
  ["a value keyed by a non-role id", (d) => {
    d.model.populations[0].instances[0].role_values = { smokes: "p1" };
  }, false],
  ["an alias that is not a local name", (d) => (d.model.imports = { "c rm": "Crm" }), false],
  ["a diagram element with a dot", (d) => (d.model.diagrams[0].elements = ["a.b"]), false],
  ["a constraint role that is no role id", (d) => {
    d.model.fact_types[0].constraints[0].role = "smokes";
  }, false],
  [
    "a join path over role ids",
    (d) => (d.model.constraints = [joinRing("Person_smokes.smokes")]),
    true,
  ],
  ["a join path step with a UUID role", (d) => {
    d.model.constraints = [joinRing("0193c8e2-6f4b-7c3a-9d1e-2b4f6a8c0e12")];
  }, false],
  ["a join path rooted at no local name", (d) => {
    d.model.constraints = [joinRing("Person_smokes.smokes", "Per son")];
  }, false],
  ["orm_version 3.0", (d) => (d.orm_version = "3.0"), false],
];

describe("the 4.0 JSON Schema and decoders accept and refuse alike", () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  it.each(CASES)("%s", (_, change, valid) => {
    const doc = base();
    change(doc);
    let decoded = true;
    try {
      runDocument40Decode(doc);
    } catch (err) {
      if (!(err instanceof DecodeError)) throw err;
      decoded = false;
    }
    expect({ schema: validate(doc), decoder: decoded }).toEqual({ schema: valid, decoder: valid });
  });
});
