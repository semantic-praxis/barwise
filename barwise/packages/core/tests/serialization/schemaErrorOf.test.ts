/**
 * `schemaErrorOf` with a subject: the message names the element and then the
 * field below it at fault, so a rule about one field never reads as a rule
 * about the whole element.
 */
import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
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

  it("states a rule on the element itself plainly", () => {
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
    expect(e.message).toBe(`${SUBJECT} must have required property 'role'.`);
  });
});
