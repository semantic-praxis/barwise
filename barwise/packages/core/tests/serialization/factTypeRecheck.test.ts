/**
 * The loader keeps every schema error the fact type decoder did not report,
 * on a fact type the decoder refused, and drops the whole-document errors in
 * that fact type's own region. The decoder is wrapped to forget one rule (an
 * unknown field), which is what a decoder that has drifted from the schema
 * looks like. Constraint errors stay the constraint merge's.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it, vi } from "vitest";
import type * as Decoder from "../../src/model/factTypeDecoder.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import type { SchemaError } from "../../src/serialization/SchemaValidator.js";

vi.mock("../../src/model/factTypeDecoder.js", async (importOriginal) => {
  const real = await importOriginal<typeof Decoder>();
  return {
    ...real,
    decodeFactTypes: (...args: Parameters<typeof real.decodeFactTypes>) =>
      Effect.map(real.decodeFactTypes(...args), (results) =>
        results.map((r) =>
          Result.isFailure(r)
            ? Result.fail({
              ...r.failure,
              problems: r.failure.problems.filter((p) => p.path[0] !== "colour"),
            })
            : r
        )),
  };
});

const YAML = `orm_version: "2.0"
model:
  name: Drift
  object_types:
    - {id: ot-p, name: Person, kind: entity, reference_mode: id}
  fact_types:
    - id: ft-1
      name: Person exists
      colour: red
      roles: [{id: r-1, player: ot-p, role_name: exists}]
      readings: []
      constraints:
        - {id: c-1, type: mandatory}
`;

describe("a fact type rule the decoder does not report", () => {
  it("is kept from the fact_type definition, beside the decoder's and the constraint's", () => {
    let errors: readonly SchemaError[] = [];
    try {
      new OrmYamlSerializer().deserialize(YAML);
    } catch (e) {
      errors = (e as DeserializationError).validationResult!.errors;
    }
    expect(errors.map((e) => [e.path, e.message])).toEqual([
      [
        "/model/fact_types/0/constraints/0/role",
        'Constraint "c-1" in Fact type "Person exists" is missing "role".',
      ],
      [
        "/model/fact_types/0/readings",
        'Fact type "Person exists" has an invalid readings: Expected a value with a length of at least 1.',
      ],
      [
        "/model/fact_types/0",
        'Fact type "Person exists" has an unknown field "colour".',
      ],
    ]);
  });
});
