/**
 * The JSON Schema generator draws values today's schema mostly accepts, for
 * the shapes the decoders are held to: object types now, constraints in R2
 * (docs/specs/effect-adoption.spec.md, 1r; second review of R1, which found
 * it drawing only `{}` for a constraint).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import { fromJsonSchema } from "./jsonSchemaArbitrary.js";

const root = schema as unknown as Record<string, unknown>;
const defs = (schema as unknown as { definitions: Record<string, Record<string, unknown>>; })
  .definitions;
const validator = new SchemaValidator();

const FACT_TYPE = {
  id: "ft",
  name: "F",
  roles: [
    { id: "r1", player: "ot", role_name: "a" },
    { id: "r2", player: "ot", role_name: "b" },
  ],
  readings: ["{0} f {1}"],
};

/** The smallest document around one value of each shape. */
const wrap: Record<string, (v: unknown) => unknown> = {
  object_type: (v) => ({ model: { name: "M", object_types: [v] } }),
  internal_constraint: (v) => ({
    model: { name: "M", fact_types: [{ ...FACT_TYPE, constraints: [v] }] },
  }),
  external_constraint: (v) => ({ model: { name: "M", constraints: [v] } }),
};

describe("values drawn from the hand-written schema", () => {
  it.each(Object.keys(wrap))("%s: varied, and mostly valid", (name) => {
    const values = fc.sample(fromJsonSchema(root, defs[name]!), { numRuns: 400, seed: 5 });
    const valid = values.filter((v) =>
      validator.validateModel({ orm_version: "3.0", ...(wrap[name]!(v) as object) }).valid
    );
    expect(valid.length).toBeGreaterThan(values.length * 0.3);
    expect(valid.length).toBeLessThan(values.length);
    // Not one shape repeated: a branch of each union is drawn.
    if (name !== "object_type") {
      expect(new Set(values.map((v) => (v as { type?: string; }).type)).size).toBeGreaterThan(5);
    }
  });
});
