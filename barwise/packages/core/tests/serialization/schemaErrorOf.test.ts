/**
 * `schemaErrorOf` with a subject: the message names the element and then the
 * field below it at fault, so a rule about one field never reads as a rule
 * about the whole element.
 */
import type { ErrorObject } from "ajv";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import { decodeConstraints } from "../../src/model/constraintDecoder.js";
import { schemaErrorOf } from "../../src/serialization/SchemaValidator.js";

const SUBJECT = 'Constraint "c-1" in Fact type "F"';
const PREFIX = "/model/fact_types/0/constraints/0";

function error(over: Partial<ErrorObject>): ErrorObject {
  return { instancePath: "", schemaPath: "#", keyword: "type", params: {}, ...over };
}

describe("schemaErrorOf with a subject", () => {
  it("names the field below the subject", () => {
    const e = schemaErrorOf(
      error({ instancePath: "/values/0", keyword: "type", message: "must be string" }),
      {},
      PREFIX,
      SUBJECT,
    );
    expect(e.path).toBe(`${PREFIX}/values/0`);
    expect(e.message).toBe(`${SUBJECT} has an invalid values.0: must be string.`);
  });

  it("names an unknown key, nested ones by their path", () => {
    const e = schemaErrorOf(
      error({
        instancePath: "/ranges/0",
        keyword: "additionalProperties",
        params: { additionalProperty: "foo" },
        message: "must NOT have additional properties",
      }),
      {},
      PREFIX,
      SUBJECT,
    );
    expect(e.message).toBe(`${SUBJECT} has an unknown field "ranges.0.foo".`);
    expect(e.rule).toEqual({ keyword: "additionalProperties", additionalProperty: "foo" });
  });

  it("says a forbidden field is the field, not the element", () => {
    const e = schemaErrorOf(
      error({ instancePath: "/role", keyword: "false schema", message: "boolean schema is false" }),
      {},
      PREFIX,
      SUBJECT,
    );
    expect(e.message).toBe(`${SUBJECT} has a field "role" that is not allowed here.`);
  });

  it("names a missing key below the subject by its path", () => {
    const e = schemaErrorOf(
      error({
        instancePath: "/ranges/0",
        keyword: "required",
        params: { missingProperty: "min" },
        message: "must have required property 'min'",
      }),
      {},
      PREFIX,
      SUBJECT,
    );
    expect(e.message).toBe(`${SUBJECT} is missing "ranges.0.min".`);
  });

  it("names a missing key at the subject as the decoder does", () => {
    const e = schemaErrorOf(
      error({
        keyword: "required",
        params: { missingProperty: "role" },
        message: "must have required property 'role'",
      }),
      {},
      PREFIX,
      SUBJECT,
    );
    expect(e.message).toBe(`${SUBJECT} is missing "role".`);
  });
});

describe("one rule, one sentence, whichever side reports it", () => {
  it("words a range with neither bound as the decoder does", () => {
    const [result] = Effect.runSync(
      decodeConstraints(
        [{ id: "c-1", type: "value_constraint", ranges: [{}] }],
        'Fact type "F"',
        () => "x",
      ),
    );
    if (result === undefined || !Result.isFailure(result)) throw new Error("expected a failure");
    const fromDecoder = result.failure.problems.find((p) => p.path.join("/") === "ranges/0")!;
    const fromSchema = schemaErrorOf(
      error({
        instancePath: "/ranges/0",
        keyword: "anyOf",
        params: { anyOfKeys: ["min", "max"] },
        message: "must match a schema in anyOf",
      }),
      {},
      PREFIX,
      result.failure.subject,
    );
    expect(fromSchema.message).toBe(fromDecoder.message);
  });
});
