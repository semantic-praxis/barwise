/**
 * The object type decoder: every problem in one pass, each naming the
 * object type and the field, and the id source as a parameter
 * (docs/specs/effect-comparison.spec.md, the plain arm of WS1).
 *
 * The decoder restates what the JSON Schema's `object_type` definition
 * says, so the loader can report a file's object type problems by element
 * and field instead of by array position. That is a must-agree copy, and
 * the first two blocks below are its drift test: the field table is checked
 * against the schema's property names, and the decoder's verdict against
 * the schema's over a corpus that varies every field, so a rule added to
 * either alone fails here.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "../../src/model/id.js";
import { createObjectType, ObjectTypeError } from "../../src/model/ObjectType.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import {
  decodeObjectType,
  OBJECT_TYPE_YAML_FIELDS,
} from "../../src/serialization/yaml/decodeObjectType.js";
import { serializeObjectType } from "../../src/serialization/yaml/objectType.js";

const schema = JSON.parse(
  readFileSync(new URL("../../schemas/orm-model.schema.json", import.meta.url), "utf8"),
) as { definitions: { object_type: { properties: Record<string, unknown>; }; }; };

/** An id source that counts its calls. */
function counter() {
  let calls = 0;
  return {
    newId: () => `minted-${++calls}`,
    get calls() {
      return calls;
    },
  };
}

const never = () => {
  throw new Error("the decoder asked for an id it did not need");
};

type Doc = Record<string, unknown>;

/** Each kind carrying every field it accepts, so every field is varied. */
const ENTITY: Doc = {
  id: "ot-entity",
  name: "Customer",
  kind: "entity",
  reference_mode: "customer_id",
  definition: "A party that buys.",
  source_context: "sales",
  aliases: ["Client"],
  independent: true,
  note: "From CRM.",
  cardinality: { min: 1, max: "unbounded" },
};

const VALUE: Doc = {
  id: "ot-value",
  name: "Rating",
  kind: "value",
  definition: "A score.",
  source_context: "reviews",
  value_constraint: {
    values: ["A", "B"],
    ranges: [{ min: "1", max: "5", min_inclusive: false, max_inclusive: true }],
  },
  data_type: { name: "decimal", length: 4, scale: 1 },
  aliases: ["Grade"],
  independent: false,
  default_value: "A",
  note: "Five-point.",
  cardinality: { min: 0, max: 3 },
};

/** Values every field is tried with, right and wrong for most of them. */
const ANY: unknown[] = [
  undefined,
  null,
  "",
  "  ",
  "x",
  0,
  -1,
  1.5,
  true,
  [],
  ["a"],
  [""],
  [1],
  {},
];

/** Values worth trying only in one field. */
const SPECIFIC: Record<string, unknown[]> = {
  kind: ["entity", "value", "other"],
  data_type: [
    { name: "text" },
    { name: "kilograms" },
    { name: "text", length: -1 },
    { name: "text", length: 2.5 },
    { name: "text", scale: 0 },
    { name: "text", colour: 1 },
    { length: 3 },
  ],
  value_constraint: [
    { values: [] },
    { values: ["a"] },
    { values: [1] },
    { ranges: [] },
    { ranges: [{}] },
    { ranges: [{ min: "1" }] },
    { ranges: [{ max: 1 }] },
    { ranges: [{ min: "1", min_inclusive: "no" }] },
    { ranges: [{ min: "1", colour: 1 }] },
    { ranges: ["1"] },
    { values: [], ranges: [{ min: "1" }] },
    { values: ["a"], ranges: [] },
    { values: ["a"], colour: 1 },
  ],
  cardinality: [
    { min: 0, max: 0 },
    { min: 2, max: 1 },
    { min: -1, max: 3 },
    { min: 0 },
    { max: 1 },
    { min: 0, max: "unbounded" },
    { min: 0, max: "many" },
    { min: 0, max: -1 },
    { min: 0.5, max: 1 },
    { min: 0, max: 1, colour: 1 },
  ],
};

/**
 * The rules only the decoder states, because JSON Schema cannot: each one
 * compares a field with another field or reads past the characters. Listed
 * so that the corpus below can say "the schema accepts this and the decoder
 * must not", and so that one of them moving into the schema is noticed.
 */
function decoderOnly(doc: Doc): string | undefined {
  if (typeof doc.name === "string" && doc.name !== "" && doc.name.trim() === "") {
    return "a name that is blank once trimmed";
  }
  if (doc.kind === "value" && typeof doc.reference_mode === "string" && doc.reference_mode !== "") {
    return "a value type with a reference mode";
  }
  const c = doc.cardinality as { min?: unknown; max?: unknown; } | undefined;
  if (
    typeof c?.min === "number" && typeof c.max === "number" && Number.isInteger(c.min)
    && Number.isInteger(c.max) && c.min >= 0 && c.max >= 0 && c.max < c.min
  ) {
    return "a cardinality maximum below its minimum";
  }
  return undefined;
}

function corpus(): { label: string; doc: Doc; }[] {
  const cases: { label: string; doc: Doc; }[] = [];
  for (const base of [ENTITY, VALUE]) {
    cases.push({ label: `${base.kind} as given`, doc: base });
    for (const field of [...Object.keys(schema.definitions.object_type.properties), "colour"]) {
      // A missing id is the one place the two differ by design: the decoder
      // mints one, a file must name it. The loader tests below cover it.
      if (field === "id") continue;
      for (const v of [...ANY, ...(SPECIFIC[field] ?? [])]) {
        const doc = { ...base };
        if (v === undefined) delete doc[field];
        else doc[field] = v;
        cases.push({ label: `${base.kind} with ${field} = ${JSON.stringify(v)}`, doc });
      }
    }
  }
  return cases;
}

const validator = new SchemaValidator();
const schemaAccepts = (doc: Doc) =>
  validator.validateModel({ orm_version: "2.0", model: { name: "T", object_types: [doc] } })
    .valid;

describe("decodeObjectType agrees with the JSON Schema", () => {
  it("knows exactly the schema's object type fields", () => {
    expect(Object.values(OBJECT_TYPE_YAML_FIELDS).sort()).toEqual(
      Object.keys(schema.definitions.object_type.properties).sort(),
    );
  });

  const cases = corpus();

  it("the corpus exercises both verdicts and every decoder-only rule", () => {
    const verdicts = cases.map((c) => decodeObjectType(c.doc, never).ok);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
    expect(new Set(cases.map((c) => decoderOnly(c.doc)).filter(Boolean)).size).toBe(3);
  });

  it.each(cases)("$label", ({ doc }) => {
    const decoded = decodeObjectType(doc, never);
    if (decoderOnly(doc) !== undefined) {
      expect(decoded.ok).toBe(false);
    } else {
      expect(decoded.ok).toBe(schemaAccepts(doc));
    }
  });
});

describe("decodeObjectType", () => {
  it("decodes what the serializer writes back to the same object type", () => {
    for (const base of [ENTITY, VALUE]) {
      const first = decodeObjectType(base, never);
      expect(first.ok).toBe(true);
      if (!first.ok) continue;
      const again = decodeObjectType(serializeObjectType(first.value), never);
      expect(again).toEqual(first);
    }
  });

  it("reports every problem in one pass, each naming the object type and the field", () => {
    const result = decodeObjectType({
      id: "ot-1",
      name: "Rating",
      kind: "value",
      reference_mode: "rating_code",
      data_type: { name: "kilograms" },
      value_constraint: { values: [] },
      cardinality: { min: 5, max: 2 },
      aliases: "Grade",
      colour: "red",
    }, never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.field).sort()).toEqual([
      "aliases",
      "cardinality",
      "colour",
      "data_type",
      "reference_mode",
      "value_constraint",
    ]);
    for (const p of result.problems) {
      expect(p.objectType).toBe("Rating");
      expect(p.message).toContain('"Rating"');
    }
  });

  it("names the object type by id when the name is the problem", () => {
    const result = decodeObjectType({ id: "ot-9", name: "  ", kind: "value" }, never);
    expect(result).toEqual({
      ok: false,
      problems: [{
        objectType: "ot-9",
        field: "name",
        message: 'Value type with id "ot-9" must have a non-empty name.',
      }],
    });
  });

  it("tells an entity type to remove a value-only field, not to repair it", () => {
    const result = decodeObjectType({
      ...ENTITY,
      value_constraint: { values: [] },
      data_type: { name: "kilograms" },
    }, never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.message)).toEqual([
      'Entity type "Customer" cannot have a data type; it belongs on the value type its reference mode names.',
      'Entity type "Customer" cannot have a value constraint; it belongs on the value type its reference mode names.',
    ]);
  });

  it("reports a field the shape check refused once, not again as missing", () => {
    const result = decodeObjectType({ ...ENTITY, reference_mode: 7 }, never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.field).toBe("reference_mode");
  });

  it("refuses an entry that is not a mapping", () => {
    expect(decodeObjectType("Customer", never)).toMatchObject({
      ok: false,
      problems: [{ field: "", message: expect.stringContaining('not "Customer"') }],
    });
  });
});

describe("the id source", () => {
  afterEach(() => setIdGenerator(undefined));

  it("is called once, for an entry with no id", () => {
    const ids = counter();
    const { id: _id, ...noId } = VALUE;
    const result = decodeObjectType(noId, ids.newId);
    expect(result).toMatchObject({ ok: true, value: { id: "minted-1" } });
    expect(ids.calls).toBe(1);
  });

  it("is not called for an entry that names its id", () => {
    const ids = counter();
    expect(decodeObjectType(ENTITY, ids.newId)).toMatchObject({
      ok: true,
      value: { id: "ot-entity" },
    });
    expect(ids.calls).toBe(0);
  });

  it("is not called for an entry that fails to decode", () => {
    const ids = counter();
    expect(decodeObjectType({ name: "Customer", kind: "entity" }, ids.newId).ok).toBe(false);
    expect(ids.calls).toBe(0);
  });

  it("is the only one: the installed generator is never read", () => {
    const installed = counter();
    setIdGenerator(installed.newId);
    const given = counter();
    const { id: _id, ...noId } = ENTITY;

    decodeObjectType(noId, given.newId);
    createObjectType({ name: "Rating", kind: "value" }, given.newId);

    expect(given.calls).toBe(2);
    expect(installed.calls).toBe(0);
  });
});

describe("createObjectType", () => {
  it("throws every problem, not the first", () => {
    let error: unknown;
    try {
      createObjectType({
        name: "Size",
        kind: "value",
        referenceMode: "size_code",
        valueConstraint: { values: [] },
        cardinality: { min: 5, max: 2 },
      }, never);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ObjectTypeError);
    expect((error as ObjectTypeError).problems.map((p) => p.field)).toEqual([
      "referenceMode",
      "valueConstraint",
      "cardinality",
    ]);
    expect((error as ObjectTypeError).message.split("\n")).toHaveLength(3);
  });

  it("applies the decoder's rules, with the same words", () => {
    const fromCode = (() => {
      try {
        createObjectType({ id: "ot-1", name: "Size", kind: "value", referenceMode: "s" }, never);
      } catch (e) {
        return (e as ObjectTypeError).problems.map((p) => p.message);
      }
    })();
    const fromFile = decodeObjectType(
      { id: "ot-1", name: "Size", kind: "value", reference_mode: "s" },
      never,
    );
    expect(fromFile.ok).toBe(false);
    if (fromFile.ok) return;
    expect(fromFile.problems.map((p) => p.message)).toEqual(fromCode);
  });
});

describe("OrmYamlSerializer.deserialize", () => {
  const serializer = new OrmYamlSerializer();

  function refusal(yaml: string): DeserializationError {
    try {
      serializer.deserialize(yaml);
    } catch (e) {
      expect(e).toBeInstanceOf(DeserializationError);
      return e as DeserializationError;
    }
    throw new Error("the document loaded");
  }

  it("refuses an object type with no id, naming it and the field", () => {
    const err = refusal(`orm_version: "2.0"
model:
  name: M
  object_types:
    - name: Customer
      kind: entity
      reference_mode: customer_id
`);
    expect(err.validationResult!.errors).toEqual([
      { path: "/model/object_types/0/id", message: 'Object type "Customer" must have an id.' },
    ]);
  });

  it("reports object type problems beside the schema's other errors, each once", () => {
    const err = refusal(`orm_version: "2.0"
model:
  name: M
  object_types:
    - id: ot-1
      name: Size
      kind: value
      cardinality: { min: 5, max: 2 }
      colour: red
  fact_types: 3
`);
    expect(err.validationResult!.errors.map((e) => e.path)).toEqual([
      "/model/fact_types",
      "/model/object_types/0/colour",
      "/model/object_types/0/cardinality",
    ]);
  });
});
