/**
 * The 3.0 document decoder agrees with the reader it replaced
 * (docs/specs/effect-adoption.spec.md, 1r, R4), whole documents at a time:
 * it accepts exactly the documents the 3.0 schema and each element's
 * constructor accept, drawn from the hand-written schema, to the configs
 * the `deserialize*` functions build; every corpus document decodes so; and
 * every 3.0 malformed case is refused by the loader at its field, in one
 * pass, with nothing else wrong reported.
 */
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { DecodeError } from "../../src/decode/decoder.js";
import { type DecodedDocument, runDocumentDecode } from "../../src/decode/document.js";
import { FactType } from "../../src/model/FactType.js";
import { createObjectType } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import {
  deserializeConstraint,
  deserializeDefinition,
  deserializeDiagramLayout,
  deserializeFactInstance,
  deserializeFactType,
  deserializeObjectifiedFactType,
  deserializeObjectType,
  deserializePopulation,
  deserializeSubtypeFact,
} from "../../src/serialization/reader20.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import type { OrmYamlDocument } from "../../src/serialization/yaml/document.js";
import { fromJsonSchema } from "../helpers/jsonSchemaArbitrary.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

const validator = new SchemaValidator();
const alethic = <C extends object>(c: C) => ({ modality: "alethic", ...c });

/**
 * What the reader before R4 made of a valid 3.0 document, element by
 * element: the configs its `deserialize*` functions built, each constraint
 * with barwise-973's narrowing (the modality stated), which the decoder's
 * record carries and the loader drops again before the model.
 */
function todays(doc: OrmYamlDocument): DecodedDocument {
  const m = doc.model;
  return {
    header: {
      name: m.name,
      domainContext: m.domain_context,
      namespace: m.namespace,
      note: m.note,
    },
    objectTypes: (m.object_types ?? []).map((ot) => ({
      record: createObjectType(deserializeObjectType(ot)),
      ...(ot.preferred_identifier !== undefined
        ? { preferredIdentifier: ot.preferred_identifier }
        : {}),
    })),
    factTypes: (m.fact_types ?? []).map((ft) => {
      const { config, constraints } = deserializeFactType(ft);
      return { ...config, constraints: constraints.map(alethic) };
    }),
    constraints: (m.constraints ?? []).map((c) => alethic(deserializeConstraint(c))),
    subtypeFacts: (m.subtype_facts ?? []).map(deserializeSubtypeFact),
    objectifiedFactTypes: (m.objectified_fact_types ?? []).map(deserializeObjectifiedFactType),
    populations: (m.populations ?? []).map((p) => ({
      config: deserializePopulation(p),
      instances: p.instances.map(deserializeFactInstance),
    })),
    definitions: (m.definitions ?? []).map(deserializeDefinition),
    diagrams: (m.diagrams ?? []).map(deserializeDiagramLayout),
  } as unknown as DecodedDocument;
}

type Reading = { ok: true; configs: unknown; } | { ok: false; };

/**
 * Whether the reader before R4 accepted a document's elements: its schema,
 * then each element's own constructor, the model's name rule included.
 * References between elements, and the model's namespace as an IRI, are
 * checked by the model after decoding, on both paths, so they are not asked
 * here.
 */
function todaysReading(doc: unknown): Reading {
  if (!validator.validateModel(doc).valid) return { ok: false };
  const d = doc as OrmYamlDocument;
  try {
    new OrmModel({ name: d.model.name });
    for (const ot of d.model.object_types ?? []) createObjectType(deserializeObjectType(ot));
    for (const ft of d.model.fact_types ?? []) {
      const { config, constraints } = deserializeFactType(ft);
      new FactType({ ...config, constraints: constraints as never });
    }
  } catch {
    return { ok: false };
  }
  return { ok: true, configs: todays(d) };
}

function decodersReading(doc: unknown): Reading {
  try {
    return { ok: true, configs: runDocumentDecode(doc) };
  } catch (e) {
    if (e instanceof DecodeError) return { ok: false };
    throw e;
  }
}

describe("the document decoder, against the reader it replaced", () => {
  it("accepts exactly the documents it accepted, drawn whole from the hand-written schema", () => {
    let accepted = 0;
    fc.assert(
      fc.property(fromJsonSchema(schema as never, schema as never), (doc) => {
        const before = todaysReading(doc);
        const decoded = decodersReading(doc);
        expect([JSON.stringify(doc), decoded.ok]).toEqual([JSON.stringify(doc), before.ok]);
        if (before.ok && decoded.ok) {
          accepted++;
          expect(decoded.configs).toEqual(before.configs);
        }
      }),
      { numRuns: 1000, seed: 23 },
    );
    expect(accepted).toBeGreaterThan(300);
  });

  it("decodes every corpus document to the configs it built", () => {
    const corpus = modelCorpus();
    expect(corpus.length).toBeGreaterThan(80);
    for (const { file, doc } of corpus) {
      expect([file, runDocumentDecode(doc)]).toEqual([file, todays(doc)]);
    }
  });
});

const MALFORMED = resolve(import.meta.dirname, "../fixtures/malformed/3.0");

interface Case {
  readonly file: string;
  readonly kind?: string;
  readonly field: string;
  readonly at?: string;
  readonly constraint?: number;
}

/** Where a case's element sits in the document, for its declared path. */
function elementAt(c: Case): string {
  switch (c.kind) {
    case undefined:
      return "model.object_types.0";
    case "fact_type":
      return "model.fact_types.0";
    case "constraint":
      return "model.constraints.0";
    case "header":
      return "model";
    case "subtype_fact":
      return "model.subtype_facts.0";
    case "objectified":
      return "model.objectified_fact_types.0";
    case "population":
      return "model.populations.0";
    case "definition":
      return "model.definitions.0";
    case "diagram":
      return "model.diagrams.0";
    default:
      throw new Error(`no element for case kind ${c.kind}`);
  }
}

describe("the 3.0 malformed cases, through the loader", () => {
  const { cases } = JSON.parse(readFileSync(resolve(MALFORMED, "cases.json"), "utf8")) as {
    cases: Case[];
  };
  /** Loaded, as before R4, and reported by validation (R2's notes). */
  const VALIDATIONS = ["frequency-max-below-min.orm.yaml"];
  const serializer = new OrmYamlSerializer();

  it.each(
    cases.filter((c) => !VALIDATIONS.includes(c.file)).map((c) => [c.file, c] as const),
  )("%s is refused at its field, and only there", (_, c) => {
    const text = readFileSync(resolve(MALFORMED, c.file), "utf8");
    let error: unknown;
    try {
      serializer.deserialize(text);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DeserializationError);
    const errors = (error as DeserializationError).validationResult!.errors;
    // One problem, at or below the declared field: a bad reading is
    // reported at the reading.
    const declared = `/${`${elementAt(c)}.${c.at ?? c.field}`.split(".").join("/")}`;
    expect(errors.map((e) => e.path === declared || e.path.startsWith(`${declared}/`)))
      .toEqual([true]);
    expect(errors[0]!.message).toContain(c.field);
  });

  it.each(
    cases.filter((c) => c.constraint !== undefined && !VALIDATIONS.includes(c.file))
      .map((c) => [c.file] as const),
  )("%s names the fact type its constraint sits in", (file) => {
    const text = readFileSync(resolve(MALFORMED, file), "utf8");
    const factType = parse(text).model.fact_types[0].name as string;
    expect(() => serializer.deserialize(text)).toThrow(`in fact type "${factType}": `);
  });

  it('refuses in one line, with the document itself at "/", as ajv did', () => {
    let error: unknown;
    try {
      serializer.deserialize('orm_version: "3.0"\nmodel: []\n');
    } catch (e) {
      error = e;
    }
    expect((error as DeserializationError).validationResult!.errors.map((e) => e.path))
      .toEqual(["/model"]);
    try {
      serializer.deserialize("just text\n");
    } catch (e) {
      error = e;
    }
    expect((error as DeserializationError).validationResult!.errors.map((e) => e.path))
      .toEqual(["/"]);
    try {
      serializer.deserialize('orm_version: "3.0"\nmodel:\n  name: ""\n  object_types: 5\n');
    } catch (e) {
      error = e;
    }
    const refused = error as DeserializationError;
    expect(refused.validationResult!.errors).toHaveLength(2);
    expect(refused.message).not.toContain("\n");
  });

  it("labels a definition by its term, and an element by any id it states", () => {
    const doc = {
      orm_version: "3.0",
      model: {
        name: "M",
        definitions: [{ definition: "x" }, { term: "T", definition: "" }],
        populations: [{
          id: "p",
          fact_type: "f",
          instances: [{ id: "  ", role_values: { r: 1 } }],
        }],
      },
    };
    let error: unknown;
    try {
      runDocumentDecode(doc);
    } catch (e) {
      error = e;
    }
    expect((error as DecodeError).problems.map((p) => p.message)).toEqual(expect.arrayContaining([
      "Definition with no term: term is missing.",
      expect.stringMatching(/^Definition of "T": definition /),
      expect.stringMatching(/^Fact instance " {2}" in population "p": role_values\.r /),
    ]));
  });

  it("an instance's problem names its population", () => {
    const doc = {
      orm_version: "3.0",
      model: {
        name: "M",
        populations: [{
          id: "pop",
          fact_type: "f",
          instances: [{ id: "i", role_values: { r: 1 } }],
        }],
      },
    };
    expect(() => runDocumentDecode(doc)).toThrow(
      'Fact instance "i" in population "pop": role_values.r',
    );
  });

  it("a sentence that names the fact type itself names it once", () => {
    const doc = {
      orm_version: "3.0",
      model: {
        name: "M",
        object_types: [{ id: "p", name: "Person", kind: "value", data_type: { name: "text" } }],
        fact_types: [{
          id: "f",
          name: "Person exists",
          roles: [{ id: "r", player: "p", role_name: "exists" }],
          readings: ["{0} exists"],
          constraints: [{ id: "c", type: "subset", subset_roles: ["r"], superset_roles: ["r"] }],
        }],
      },
    };
    let error: unknown;
    try {
      runDocumentDecode(doc);
    } catch (e) {
      error = e;
    }
    const messages = (error as DecodeError).problems.map((p) => p.message);
    expect(messages).toEqual([
      expect.stringContaining('is listed under fact type "Person exists", but'),
    ]);
    expect(messages[0]!.split("Person exists").length).toBe(2);
  });

  it.each(VALIDATIONS)("%s loads, as before R4: its problem is validation's", (file) => {
    expect(() => serializer.deserialize(readFileSync(resolve(MALFORMED, file), "utf8"))).not
      .toThrow();
  });

  it("covers every case", () => {
    expect(cases.length).toBe(39);
  });

  it("reports every problem in one pass when a file holds several", () => {
    // Three of the cases at once: what ajv before R4 reported as a schema
    // mismatch beside the constructor's first refusal, the decoder names
    // in full.
    const parts = ["blank-name", "role-without-player", "subtype-fact-without-supertype"].map(
      (name) => parse(readFileSync(resolve(MALFORMED, `${name}.orm.yaml`), "utf8")).model,
    );
    const doc = {
      orm_version: "3.0",
      model: {
        name: "Several",
        object_types: parts.flatMap((m) => m.object_types ?? []),
        fact_types: parts[1].fact_types,
        subtype_facts: parts[2].subtype_facts,
      },
    };
    let error: unknown;
    try {
      runDocumentDecode(doc);
    } catch (e) {
      error = e;
    }
    const paths = (error as DecodeError).problems.map((p) => [...p.at, ...p.path].join("."));
    expect(paths).toEqual(expect.arrayContaining([
      expect.stringMatching(/^model\.object_types\.\d+\.name$/),
      "model.fact_types.0.roles.0.player",
      "model.subtype_facts.0.supertype",
    ]));
  });
});
