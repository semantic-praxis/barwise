/**
 * The object type decoder agrees with today's reader before it is on the
 * load path (docs/specs/effect-adoption.spec.md, 1r, R1): every corpus
 * object type decodes to the record `createObjectType` builds from
 * `deserializeObjectType`, every derived value is one today's schema and
 * constructor accept, and every 3.0 malformed object type case is refused
 * at its field.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { DecodeError } from "../../src/decode/decoder.js";
import { ObjectTypeFile, runObjectTypeDecode } from "../../src/decode/objectType.js";
import { createObjectType } from "../../src/model/ObjectType.js";
import { deserializeObjectType } from "../../src/serialization/reader20.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import type { OrmYamlObjectType } from "../../src/serialization/yaml/objectType.js";
import { fromJsonSchema } from "../helpers/jsonSchemaArbitrary.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

/** What today's reader makes of one object type of a validated document. */
const todays = (doc: OrmYamlObjectType) => createObjectType(deserializeObjectType(doc));

/** Whether today's reader accepts one object type, and the record it builds. */
function todaysReading(value: unknown): { ok: true; record: unknown; } | { ok: false; } {
  const doc = { orm_version: "3.0", model: { name: "M", object_types: [value] } };
  if (!validator.validateModel(doc).valid) return { ok: false };
  try {
    return { ok: true, record: todays(value as OrmYamlObjectType) };
  } catch {
    return { ok: false };
  }
}

function decodersReading(value: unknown): { ok: true; record: unknown; } | { ok: false; } {
  try {
    return { ok: true, record: runObjectTypeDecode(value).record };
  } catch (e) {
    if (e instanceof DecodeError) return { ok: false };
    throw e;
  }
}

const validator = new SchemaValidator();

describe("the object type decoder, against today's reader", () => {
  it("accepts exactly what today's reader accepts, drawn from the hand-written schema", () => {
    // Both directions, from an answer key the Schema under test did not
    // write: a decoder that refused an empty definition, or an integer
    // above 2^53, would pass every test that draws from the Schema itself.
    const objectType = (schema as { definitions: Record<string, object>; }).definitions
      .object_type!;
    let accepted = 0;
    fc.assert(
      fc.property(
        fromJsonSchema(schema as Record<string, unknown>, objectType as Record<string, unknown>),
        (value) => {
          const today = todaysReading(value);
          const decoded = decodersReading(value);
          expect([JSON.stringify(value), decoded.ok]).toEqual([JSON.stringify(value), today.ok]);
          if (today.ok && decoded.ok) {
            accepted++;
            expect(decoded.record).toEqual(today.record);
          }
        },
      ),
      { numRuns: 3000, seed: 11 },
    );
    // Not vacuous: a fair share of the drawn values are valid.
    expect(accepted).toBeGreaterThan(1600);
  });

  const objectTypes = modelCorpus().flatMap(({ file, doc }) =>
    (doc.model.object_types ?? []).map((ot) => ({ file, ot }))
  );

  it("decodes every corpus object type to today's record", () => {
    expect(objectTypes.length).toBeGreaterThan(500);
    for (const { file, ot } of objectTypes) {
      const decoded = runObjectTypeDecode(ot);
      // toEqual, not toStrictEqual, on purpose: today's record carries a
      // data type's absent sizes as keys holding undefined ({ name,
      // length: undefined }), which the decoder leaves out. No reader
      // distinguishes them (the writer tests each with !== undefined).
      expect([file, ot.id, decoded.record]).toEqual([file, ot.id, todays(ot)]);
      expect([file, ot.id, Object.isFrozen(decoded.record)]).toEqual([file, ot.id, true]);
      expect([file, ot.id, decoded.preferredIdentifier]).toEqual([
        file,
        ot.id,
        ot.preferred_identifier,
      ]);
    }
  });

  it("decodes only what today's schema and constructor accept, to the same record", () => {
    // The independent check: an answer key the Schema under test did not
    // write. Derived values are the decoded type, which here is the file's.
    const values = Effect.runSync(
      Arbitrary.sampleEffect(Arbitrary.schema(ObjectTypeFile), { count: 500, seed: 1 }),
    );
    const validator = new SchemaValidator();
    for (const value of values) {
      const doc = { orm_version: "3.0", model: { name: "M", object_types: [value] } };
      expect(validator.validateModel(doc).errors).toEqual([]);
      expect(runObjectTypeDecode(value).record).toEqual(todays(value as OrmYamlObjectType));
    }
  });
});

const MALFORMED = resolve(import.meta.dirname, "../fixtures/malformed/3.0");

describe("the 3.0 malformed object type cases", () => {
  const { cases } = JSON.parse(readFileSync(resolve(MALFORMED, "cases.json"), "utf8")) as {
    cases: { file: string; kind?: string; field: string; }[];
  };
  const objectTypeCases = cases.filter((c) => c.kind === undefined);

  it.each(objectTypeCases.map((c) => [c.file, c] as const))(
    "%s is refused at its field",
    (_, c) => {
      const [ot] = parse(readFileSync(resolve(MALFORMED, c.file), "utf8")).model.object_types;
      let error: unknown;
      try {
        runObjectTypeDecode(ot);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(DecodeError);
      const problems = (error as DecodeError).problems;
      // The case's one problem is the field it declares, named in the message
      // with the element; nothing else is wrong with the fixture.
      // Every problem is at the declared field: a fixture holds one problem,
      // so a second, spurious report fails here.
      expect(problems.map((p) => String(p.path[0] ?? ""))).toEqual(problems.map(() => c.field));
      const atField = problems.find((p) => String(p.path[0] ?? "") === c.field)!;
      expect(atField.message).toContain(c.field);
      expect(atField.message).toContain(String(ot.name ?? ot.id).trim() || String(ot.id));
    },
  );

  it("covers every object type case", () => {
    expect(objectTypeCases.length).toBe(12);
  });
});

describe("an object type that is not a mapping", () => {
  it.each([[null], ["x"], [[1]], [3]])("%j is refused as not a mapping, once", (value) => {
    let error: unknown;
    try {
      runObjectTypeDecode(value);
    } catch (e) {
      error = e;
    }
    const problems = (error as DecodeError).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toBe("Object type must be a mapping of fields.");
  });
});
