/**
 * The constraint YAML codec (docs/specs/effect-adoption.spec.md, WS1).
 *
 * P1 and P2 are self-consistency: every derived record encodes, and reading
 * the encoding gives the record back. P3 is the independent check: every
 * encoded constraint passes the hand-written JSON Schema, inside the smallest
 * valid document. The corpus check is S1 for constraints: every constraint in
 * this repository's model files reads to the same record through the codec
 * as through today's hand-written reader, once barwise-973's narrowing
 * (modality always present) is applied.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { Constraint } from "../../src/model/Constraint.js";
import { ConstraintSchema, ConstraintYamlCodec } from "../../src/model/constraintSchema.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import {
  deserializeConstraint,
  type OrmYamlConstraint,
  serializeConstraint,
} from "../../src/serialization/yaml/constraint.js";

const SEED = 1;
const RUNS = 1000;

const records = Effect.runSync(
  Arbitrary.sampleEffect(Arbitrary.schema(ConstraintSchema), { count: RUNS, seed: SEED }),
);
const encode = Schema.encodeSync(ConstraintYamlCodec);
const decode = Schema.decodeUnknownSync(ConstraintYamlCodec);

/** The smallest valid document that holds one constraint. */
function documentWith(constraint: unknown) {
  return {
    orm_version: "2.0",
    model: {
      name: "M",
      object_types: [{ id: "ot-1", name: "Thing", kind: "entity", reference_mode: "id" }],
      fact_types: [{
        id: "ft-1",
        name: "Thing exists",
        roles: [{ id: "r-1", player: "ot-1", role_name: "exists" }],
        readings: ["{0} exists"],
        constraints: [constraint],
      }],
    },
  };
}

describe("ConstraintYamlCodec over derived records", () => {
  it("derives over the union with the file format's rules stated (M1), reaching all 16 kinds", () => {
    expect(records).toHaveLength(RUNS);
    expect(new Set(records.map((r) => r.type)).size).toBe(16);
  });

  it("encodes every record, and reads each encoding back to it (P1, P2)", () => {
    for (const record of records) {
      expect(decode(encode(record))).toEqual(record);
    }
  });

  // The codec's writer copies serializeConstraint, which is what writes
  // files. Held to it here, so P3 above measures the real writer too.
  it("writes what serializeConstraint writes, for every record", () => {
    const differ = records.filter((record) =>
      !isDeepStrictEqual({ ...serializeConstraint(record as Constraint) }, { ...encode(record) })
    );
    expect(
      differ.slice(0, 3).map((record) => ({
        record,
        serializer: serializeConstraint(record as Constraint),
        codec: encode(record),
      })),
    ).toEqual([]);
  });

  it("writes only constraints the hand-written JSON Schema accepts (P3)", () => {
    const validator = new SchemaValidator();
    const refused = records
      .map((record) => ({ record, result: validator.validateModel(documentWith(encode(record))) }))
      .filter(({ result }) => !result.valid);
    expect(refused.slice(0, 3).map(({ record, result }) => ({ record, errors: result.errors })))
      .toEqual([]);
  });
});

/**
 * Every tracked `.orm.yaml` under `dir`. Tracked, not walked: a walk of the
 * disk raced the CLI tests, which create and delete scratch directories in
 * parallel under turbo (ENOENT on a directory listed a moment earlier), and
 * it read whatever a working tree happened to hold rather than the repository.
 */
function modelFiles(dir: string): string[] {
  return execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.orm.yaml"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => f !== "")
    .map((f) => join(dir, f));
}

describe("a frequency giving both role and roles", () => {
  // The JSON Schema allows the pair and main's loader keeps `roles`; the
  // codec does the same, so S1 compares like with like. The drop itself is a
  // file-format defect, barwise-plc: when that lands, this test flips.
  it("reads roles and drops role, as main's loader does", () => {
    const fc = { type: "frequency", id: "c-1", role: "r-1", roles: ["r-2"], min: 1, max: 2 };
    expect(new SchemaValidator().validateModel(documentWith(fc)).valid).toBe(true);
    const today = deserializeConstraint(fc as OrmYamlConstraint);
    expect(today).toMatchObject({ roleIds: ["r-2"] });
    expect(decode(fc)).toEqual({ ...today, modality: "alethic" });
  });
});

describe("ConstraintYamlCodec over this repository's model files (S1)", () => {
  // Files the loader accepts today, version migration included. The S4
  // malformed fixtures are malformed by design, some in ways the JSON Schema
  // cannot see (max below min), so they are left to the S4 scorer.
  const root = fileURLToPath(new URL("../../../..", import.meta.url));
  const loads = (text: string) => {
    try {
      new OrmYamlSerializer().deserialize(text);
      return true;
    } catch {
      return false;
    }
  };
  const constraints = modelFiles(root).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    if (file.includes("/fixtures/malformed/") || !loads(text)) return [];
    const doc = parse(text) as {
      model?: { fact_types?: { constraints?: OrmYamlConstraint[]; }[]; };
    } | null;
    return (doc?.model?.fact_types ?? []).flatMap((ft) => ft.constraints ?? [])
      .map((c, i) => ({ file, c, i }));
  });

  // On 2026-10-16: 77 of 113 files load, holding 3,074 constraints of 12
  // kinds. No model here uses cardinality or the three join kinds; those rest
  // on P2 and P3 above and on the S2 layout fixtures, not on this corpus.
  it("finds constraints to read", () => {
    expect(constraints.length).toBeGreaterThan(3000);
    expect(new Set(constraints.map(({ c }) => c.type)).size).toBeGreaterThanOrEqual(12);
  });

  it("reads every one to the record today's reader gives, modality made explicit", () => {
    const differ = constraints.flatMap(({ file, c, i }) => {
      // The loader fills a missing id before decoding (decision 8), and, as
      // today's reader does, treats an empty one as missing.
      const withId = { ...c, id: (c as { id?: string; }).id || `filled-${i}` };
      const today = deserializeConstraint(withId as OrmYamlConstraint);
      const expected = { ...today, modality: today.modality ?? "alethic" };
      let actual: unknown;
      try {
        actual = decode(withId);
      } catch (e) {
        actual = (e as Error).message;
      }
      return isDeepStrictEqual(actual, expected) ? [] : [{ file, c, actual, expected }];
    });
    expect(differ.slice(0, 3)).toEqual([]);
  });
});
