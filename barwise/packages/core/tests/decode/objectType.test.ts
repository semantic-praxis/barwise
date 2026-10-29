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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  ObjectTypeError,
  ObjectTypeFile,
  runObjectTypeDecode,
} from "../../src/decode/objectType.js";
import { createObjectType } from "../../src/model/ObjectType.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import {
  deserializeObjectType,
  type OrmYamlObjectType,
} from "../../src/serialization/yaml/objectType.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

/** What today's reader makes of one object type of a validated document. */
const todays = (doc: OrmYamlObjectType) => createObjectType(deserializeObjectType(doc));

describe("the object type decoder, against today's reader", () => {
  const objectTypes = modelCorpus().flatMap(({ file, doc }) =>
    (doc.model.object_types ?? []).map((ot) => ({ file, ot }))
  );

  it("decodes every corpus object type to today's record", () => {
    expect(objectTypes.length).toBeGreaterThan(500);
    for (const { file, ot } of objectTypes) {
      const decoded = runObjectTypeDecode(ot);
      expect([file, ot.id, decoded.record]).toEqual([file, ot.id, todays(ot)]);
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
      expect(error).toBeInstanceOf(ObjectTypeError);
      const problems = (error as ObjectTypeError).problems;
      // The case's one problem is the field it declares, named in the message
      // with the element; nothing else is wrong with the fixture.
      expect(problems.map((p) => String(p.path[0] ?? ""))).toContain(c.field);
      const atField = problems.find((p) => String(p.path[0] ?? "") === c.field)!;
      expect(atField.message).toContain(c.field);
      expect(atField.message).toContain(String(ot.name ?? ot.id).trim() || String(ot.id));
    },
  );

  it("covers every object type case", () => {
    expect(objectTypeCases.length).toBe(12);
  });
});
